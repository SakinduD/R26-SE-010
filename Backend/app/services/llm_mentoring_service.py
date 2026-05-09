import json
import logging
import re
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal
from app.models.analytics import MentoringRecommendation
from app.schemas.analytics import MentoringRecommendationItem, MentoringRecommendationResult
from app.services import (
    blind_spot_service,
    data_aggregation_service,
    feedback_analysis_service,
    predictive_modeling_service,
    progress_trend_service,
)


RECOMMENDATION_VERSION = "llm-mentoring-v1"
FALLBACK_MODEL_VERSION = "rule-based-mentoring-v1"
MAX_RECOMMENDATIONS = 6
PRIORITY_WEIGHT = {"high": 3, "medium": 2, "low": 1}
MIN_SCORE = 0.0
MAX_SCORE = 100.0
MAX_MENTORING_DELTA = 15.0
IMPOSSIBLE_NEXT_SCORE_PATTERN = re.compile(r"\bto\s+-\d+(?:\.\d+)?", re.IGNORECASE)
PEER_TEXT_REPLACEMENTS = (
    (re.compile(r"\bself\s*\+\s*peer\s+or\s+mentor\b", re.IGNORECASE), "self-reflection or mentor/system observation"),
    (re.compile(r"\bself\s+or\s+peer\b", re.IGNORECASE), "self-reflection or observed evidence"),
    (re.compile(r"\bpeer\s+or\s+mentor\b", re.IGNORECASE), "mentor or system observation"),
    (re.compile(r"\bask\s+a\s+peer\b", re.IGNORECASE), "ask a mentor or review system evidence"),
    (re.compile(r"\bpeer\s+feedback\b", re.IGNORECASE), "observer/system feedback"),
    (re.compile(r"\bpeer\s+rating\b", re.IGNORECASE), "observer/system rating"),
    (re.compile(r"\bpeer\s+review\b", re.IGNORECASE), "mentor/system review"),
    (re.compile(r"\bpeers\b", re.IGNORECASE), "mentors"),
    (re.compile(r"\bpeer\b", re.IGNORECASE), "observer"),
)


def generate_user_mentoring_recommendations(
    db: Session,
    user_id: str,
    limit: int = 100,
) -> MentoringRecommendationResult:
    evidence_bundle = _collect_evidence(db, user_id, limit)
    settings = get_settings()

    llm_items = _call_openai_mentoring(evidence_bundle) if settings.openai_api_key else None
    if llm_items:
        result = MentoringRecommendationResult(
            user_id=user_id,
            recommendations=llm_items[:MAX_RECOMMENDATIONS],
            evidence=evidence_bundle["summary"],
            generated_at=datetime.utcnow(),
            recommendation_version=RECOMMENDATION_VERSION,
            model_version=settings.openai_mentoring_model,
            source="llm",
            recommendation_type="overall_user",
        )
        # Save to database
        _save_recommendations_to_db(db, result)
        return result

    fallback_items = _build_rule_based_recommendations(evidence_bundle)
    result = MentoringRecommendationResult(
        user_id=user_id,
        recommendations=fallback_items[:MAX_RECOMMENDATIONS],
        evidence=evidence_bundle["summary"],
        generated_at=datetime.utcnow(),
        recommendation_version=RECOMMENDATION_VERSION,
        model_version=FALLBACK_MODEL_VERSION,
        source="rule_based",
        recommendation_type="overall_user",
    )
    # Save to database
    _save_recommendations_to_db(db, result)
    return result


def generate_session_mentoring_recommendations(
    db: Session,
    session_id: str,
) -> MentoringRecommendationResult:
    """Generate session-specific recommendations after a single session."""
    from uuid import UUID
    
    evidence_bundle = _collect_session_evidence(db, session_id)
    settings = get_settings()

    llm_items = _call_openai_session_mentoring(evidence_bundle) if settings.openai_api_key else None
    if llm_items:
        result = MentoringRecommendationResult(
            user_id=evidence_bundle.get("user_id", "unknown"),
            session_id=session_id,
            recommendations=llm_items[:MAX_RECOMMENDATIONS],
            evidence=evidence_bundle["summary"],
            generated_at=datetime.utcnow(),
            recommendation_version=RECOMMENDATION_VERSION,
            model_version=settings.openai_mentoring_model,
            source="llm",
            recommendation_type="session_specific",
        )
        # Save to database
        _save_recommendations_to_db(db, result)
        return result

    fallback_items = _build_session_rule_based_recommendations(evidence_bundle)
    result = MentoringRecommendationResult(
        user_id=evidence_bundle.get("user_id", "unknown"),
        session_id=session_id,
        recommendations=fallback_items[:MAX_RECOMMENDATIONS],
        evidence=evidence_bundle["summary"],
        generated_at=datetime.utcnow(),
        recommendation_version=RECOMMENDATION_VERSION,
        model_version=FALLBACK_MODEL_VERSION,
        source="rule_based",
        recommendation_type="session_specific",
    )
    # Save to database
    _save_recommendations_to_db(db, result)
    return result


def _collect_evidence(db: Session, user_id: str, limit: int) -> dict[str, Any]:
    try:
        aggregate = data_aggregation_service.get_user_aggregate(db, user_id, limit)
    except Exception:
        aggregate = None
    
    try:
        feedback_analysis = feedback_analysis_service.analyze_user_feedback(db, user_id, limit)
    except Exception:
        feedback_analysis = None
    
    try:
        blind_spots = blind_spot_service.detect_user_blind_spots(db, user_id, limit)
    except Exception:
        blind_spots = None
    
    try:
        trends = progress_trend_service.analyze_user_progress_trends(db, user_id, limit)
    except Exception:
        trends = None
    
    try:
        predictions = predictive_modeling_service.predict_user_skill_outcomes(db, user_id, limit)
    except Exception:
        predictions = None

    return {
        "user_id": user_id,
        "summary": {
            "session_count": aggregate.scores.metric_count if aggregate else 0,
            "feedback_count": aggregate.feedback.total_count if aggregate else 0,
            "average_feedback_rating": aggregate.feedback.average_rating if aggregate else None,
            "blind_spot_count": blind_spots.summary.total_count if blind_spots else 0,
            "high_blind_spot_count": blind_spots.summary.high_count if blind_spots else 0,
            "prediction_count": predictions.summary.predicted_count if predictions else 0,
            "high_risk_prediction_count": predictions.summary.high_risk_count if predictions else 0,
            "medium_risk_prediction_count": predictions.summary.medium_risk_count if predictions else 0,
            "improving_count": trends.summary.improving_count if trends else 0,
            "declining_count": trends.summary.declining_count if trends else 0,
            "sentiment_positive_count": aggregate.feedback.sentiment_counts.get("positive", 0) if aggregate else 0,
            "sentiment_negative_count": aggregate.feedback.sentiment_counts.get("negative", 0) if aggregate else 0,
        },
        "scores": aggregate.scores.averages if aggregate else {},
        "latest_feedback": [
            _compact_feedback(entry.model_dump(mode="json"))
            for entry in (aggregate.feedback.latest_entries[:5] if aggregate else [])
        ],
        "feedback_alignment": [
            item.model_dump(mode="json")
            for item in (_rank_feedback_items(feedback_analysis.items)[:6] if feedback_analysis else [])
        ],
        "blind_spots": [
            item.model_dump(mode="json")
            for item in (blind_spots.blind_spots[:6] if blind_spots else [])
        ],
        "trends": [
            _compact_trend(item.model_dump(mode="json"))
            for item in (_rank_trends(trends.trends)[:7] if trends else [])
        ],
        "predictions": [
            _compact_prediction(item.model_dump(mode="json"))
            for item in (_rank_predictions(predictions.predictions)[:7] if predictions else [])
        ],
    }


def _collect_session_evidence(db: Session, session_id: str) -> dict[str, Any]:
    """Collect evidence specific to a single session."""
    try:
        aggregate = data_aggregation_service.get_session_aggregate(db, session_id)
    except Exception:
        aggregate = None
    
    try:
        feedback_analysis = feedback_analysis_service.analyze_session_feedback(db, session_id)
    except Exception:
        feedback_analysis = None
    
    try:
        blind_spots = blind_spot_service.detect_session_blind_spots(db, session_id)
    except Exception:
        blind_spots = None

    user_id = aggregate.user_id if aggregate and aggregate.user_id else "unknown"

    summary_data = {
        "session_id": session_id,
        "user_id": user_id,
        "feedback_count": aggregate.feedback.total_count if aggregate else 0,
        "average_feedback_rating": aggregate.feedback.average_rating if aggregate else None,
        "blind_spot_count": blind_spots.summary.total_count if blind_spots else 0,
        "high_blind_spot_count": blind_spots.summary.high_count if blind_spots else 0,
    }

    return {
        "user_id": user_id,
        "session_id": session_id,
        "summary": summary_data,
        "scores": aggregate.scores.averages if aggregate and aggregate.scores else {},
        "latest_feedback": [
            _compact_feedback(entry.model_dump(mode="json"))
            for entry in (aggregate.feedback.latest_entries[:3] if aggregate else [])
        ],
        "feedback_alignment": [
            item.model_dump(mode="json")
            for item in (feedback_analysis.items[:3] if feedback_analysis else [])
        ],
        "blind_spots": [
            item.model_dump(mode="json")
            for item in (blind_spots.blind_spots[:3] if blind_spots else [])
        ],
    }


def _call_openai_session_mentoring(evidence_bundle: dict[str, Any]) -> list[MentoringRecommendationItem] | None:
    settings = get_settings()
    schema = _recommendation_json_schema()
    prompt = (
        "Generate immediate post-session mentoring feedback for a Gen Z workplace soft-skills learner. "
        "Focus only on what happened in this specific session. "
        "Use only the analytics evidence provided. "
        "Return concise, actionable coaching advice for their next attempt. "
        "Prioritize blind spots and low feedback ratings. "
        "Do not invent session details or private user facts. "
        "All score values are normalized to 0-100. "
        "Do not ask the learner to collect peer feedback or peer ratings. "
        "Use terms such as observed performance evidence or system evidence instead."
    )
    payload = {
        "model": settings.openai_mentoring_model,
        "reasoning": {"effort": "low"},
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    "Session analytics evidence JSON:\n"
                    f"{json.dumps(evidence_bundle, ensure_ascii=True)}"
                ),
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "mentoring_recommendations",
                "schema": schema,
                "strict": True,
            }
        },
    }

    try:
        with httpx.Client(timeout=settings.llm_mentoring_timeout_s) as client:
            response = client.post(
                f"{settings.openai_base_url.rstrip('/')}/responses",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
        parsed = _parse_openai_json(response.json())
        items = parsed.get("recommendations", []) if isinstance(parsed, dict) else []
        return _coerce_recommendations(items, source="llm")
    except Exception:
        return None


def _build_session_rule_based_recommendations(evidence_bundle: dict[str, Any]) -> list[MentoringRecommendationItem]:
    """Build rule-based recommendations for a single session."""
    items: list[MentoringRecommendationItem] = []

    # Prioritize blind spots from this session
    for blind_spot in evidence_bundle.get("blind_spots", []):
        skill = blind_spot["skill_area"]
        items.append(
            _recommendation(
                priority=blind_spot["severity"],
                skill_area=skill,
                title=f"Work on {_label(skill)} in next session",
                reason=f"This session showed a {blind_spot['blind_spot_type']} gap in {_label(skill)}.",
                detail=f"You rated yourself {blind_spot['self_rating']} but observed performance was {blind_spot['observed_rating']}. "
                       f"Practice this skill specifically before your next session.",
                next_action=f"Focus on {_label(skill)} during your next practice session. Ask for feedback on this specific area.",
                evidence_sources=["blind_spot_detection", "session_feedback"],
            )
        )

    # Add feedback-based recommendations if average is low
    if evidence_bundle["summary"]["feedback_count"] > 0:
        avg_rating = evidence_bundle["summary"]["average_feedback_rating"]
        if avg_rating and float(avg_rating) < 70:
            items.append(
                _recommendation(
                    priority="high" if float(avg_rating) < 60 else "medium",
                    skill_area="overall",
                    title="Session performance feedback below target",
                    reason=f"Your session feedback rating was {round(float(avg_rating), 1)}/100.",
                    detail="Review the specific feedback provided and identify the key areas to improve for your next session.",
                    next_action="Read through all session feedback carefully and select one key action to practice before your next session.",
                    evidence_sources=["session_feedback"],
                )
            )

    # If no recommendations were generated, provide default suggestions
    if not items:
        items.append(
            _recommendation(
                priority="low",
                skill_area="overall",
                title="Session complete - continue your practice",
                reason="No critical issues detected in this session.",
                detail="Keep practicing at your current level and focus on consistent improvement.",
                next_action="Schedule your next practice session soon to build on today's progress.",
                evidence_sources=["session_summary"],
            )
        )

    return items


def _call_openai_mentoring(evidence_bundle: dict[str, Any]) -> list[MentoringRecommendationItem] | None:
    settings = get_settings()
    schema = _recommendation_json_schema()
    prompt = (
        "Generate personalized mentoring recommendations for a Gen Z workplace "
        "soft-skills learner. Use only the analytics evidence provided. "
        "Return concise, actionable, non-clinical coaching advice. "
        "Prioritize high-risk predictions, blind spots, declining trends, and low scores. "
        "Do not invent sessions, scores, diagnoses, or private user facts. "
        "All score values in the evidence are already normalized to the 0-100 range. "
        "Never write negative skill scores or a future score outside 0-100. "
        "When discussing a trend, describe it as a point change, not as a predicted score. "
        "Do not ask the learner to collect peer feedback or peer ratings. "
        "This system uses self-reflection feedback plus observed performance evidence from adaptive pedagogy, "
        "role-play, and multimodal analysis components. Use terms such as observed performance evidence, "
        "mentor check, or system evidence instead of peer feedback."
    )
    payload = {
        "model": settings.openai_mentoring_model,
        "reasoning": {"effort": "low"},
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    "Analytics evidence JSON:\n"
                    f"{json.dumps(evidence_bundle, ensure_ascii=True)}"
                ),
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "mentoring_recommendations",
                "schema": schema,
                "strict": True,
            }
        },
    }

    try:
        with httpx.Client(timeout=settings.llm_mentoring_timeout_s) as client:
            response = client.post(
                f"{settings.openai_base_url.rstrip('/')}/responses",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
        parsed = _parse_openai_json(response.json())
        items = parsed.get("recommendations", []) if isinstance(parsed, dict) else []
        return _coerce_recommendations(items, source="llm")
    except Exception:
        return None


def _parse_openai_json(response_data: dict[str, Any]) -> dict[str, Any]:
    if response_data.get("output_text"):
        return json.loads(response_data["output_text"])

    for output in response_data.get("output", []):
        for content in output.get("content", []):
            text = content.get("text")
            if text:
                return json.loads(text)
    return {}


def _build_rule_based_recommendations(evidence_bundle: dict[str, Any]) -> list[MentoringRecommendationItem]:
    items: list[MentoringRecommendationItem] = []

    for blind_spot in evidence_bundle["blind_spots"]:
        skill = blind_spot["skill_area"]
        items.append(
            _recommendation(
                priority=blind_spot["severity"],
                skill_area=skill,
                title=f"Review {_label(skill)} blind spot",
                reason=f"{_label(skill)} shows a {blind_spot['blind_spot_type']} gap of {blind_spot['gap']} points.",
                detail=blind_spot["recommendation"],
                next_action=f"Compare one self-rating with observed performance evidence before the next {_label(skill)} practice.",
                evidence_sources=["blind_spot_detection", "feedback_analysis"],
            )
        )

    for prediction in evidence_bundle["predictions"]:
        if prediction["risk_level"] == "low":
            continue
        skill = prediction["predicted_skill"]
        items.append(
            _recommendation(
                priority=prediction["risk_level"],
                skill_area=skill,
                title=f"Reduce {_label(skill)} risk",
                reason=f"The predictive model estimates {prediction['risk_level']} next-session risk.",
                detail=prediction["recommendation"],
                next_action=f"Add one targeted {_label(skill)} exercise to the next role-play plan.",
                evidence_sources=["predictive_model", "progress_trends"],
            )
        )

    for trend in evidence_bundle["trends"]:
        if trend["trend_label"] != "declining":
            continue
        skill = trend["skill_area"]
        items.append(
            _recommendation(
                priority="medium",
                skill_area=skill,
                title=f"Reverse {_label(skill)} decline",
                reason=f"{_label(skill)} changed by {trend.get('delta')} points across {trend.get('session_count')} sessions.",
                detail=trend["recommendation"],
                next_action=f"Review the last session and write one specific {_label(skill)} improvement goal.",
                evidence_sources=["progress_trends"],
            )
        )

    for skill, score in _low_scores(evidence_bundle["scores"]):
        items.append(
            _recommendation(
                priority="high" if score < 60 else "medium",
                skill_area=skill,
                title=f"Practice {_label(skill)}",
                reason=f"Average {_label(skill)} score is {round(score)}.",
                detail=f"{_label(skill)} is below the expected soft-skill benchmark.",
                next_action=f"Complete one focused drill and compare it with the next observed {_label(skill)} score.",
                evidence_sources=["skill_twin_scores"],
            )
        )

    items = _dedupe(items)
    if not items and evidence_bundle["summary"]["session_count"]:
        items.append(
            _recommendation(
                priority="low",
                skill_area="overall",
                title="Maintain current progress",
                reason="No urgent blind spot, prediction risk, or declining trend was detected.",
                detail="Continue the current training strategy and review feedback after each session.",
                next_action="Complete one more role-play session and compare the new scores with this baseline.",
                evidence_sources=["analytics_summary"],
            )
        )

    return sorted(items, key=lambda item: PRIORITY_WEIGHT[item.priority], reverse=True)


def _coerce_recommendations(
    raw_items: list[dict[str, Any]],
    source: str,
) -> list[MentoringRecommendationItem]:
    items: list[MentoringRecommendationItem] = []
    for raw in raw_items:
        priority = str(raw.get("priority", "medium")).lower()
        if priority not in PRIORITY_WEIGHT:
            priority = "medium"
        title = _sanitize_mentoring_text(str(raw.get("title") or "").strip())
        detail = _sanitize_mentoring_text(str(raw.get("detail") or "").strip())
        next_action = _sanitize_mentoring_text(str(raw.get("next_action") or "").strip())
        if not title or not detail or not next_action:
            continue
        reason = _sanitize_mentoring_text(str(raw.get("reason") or detail).strip())
        if _contains_impossible_score_text(title, reason, detail, next_action):
            continue
        items.append(
            MentoringRecommendationItem(
                priority=priority,
                skill_area=raw.get("skill_area"),
                title=title,
                reason=reason,
                detail=detail,
                next_action=next_action,
                source=source,
                evidence_sources=[
                    str(value)
                    for value in raw.get("evidence_sources", [])
                    if value is not None
                ],
            )
        )
    return sorted(_dedupe(items), key=lambda item: PRIORITY_WEIGHT[item.priority], reverse=True)


def _recommendation(
    *,
    priority: str,
    skill_area: str | None,
    title: str,
    reason: str,
    detail: str,
    next_action: str,
    evidence_sources: list[str],
) -> MentoringRecommendationItem:
    normalized_priority = priority if priority in PRIORITY_WEIGHT else "medium"
    return MentoringRecommendationItem(
        priority=normalized_priority,
        skill_area=skill_area,
        title=title,
        reason=reason,
        detail=detail,
        next_action=next_action,
        source="rule_based",
        evidence_sources=evidence_sources,
    )


def _dedupe(items: list[MentoringRecommendationItem]) -> list[MentoringRecommendationItem]:
    deduped = []
    seen = set()
    for item in items:
        key = (item.priority, item.skill_area, item.title.lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _rank_feedback_items(items):
    severity = {"high": 3, "medium": 2, "low": 1, "none": 0}
    return sorted(items, key=lambda item: severity[item.severity], reverse=True)


def _rank_trends(items):
    weight = {"declining": 3, "improving": 2, "stable": 1, "insufficient_data": 0}
    return sorted(items, key=lambda item: (weight[item.trend_label], abs(item.delta or 0)), reverse=True)


def _rank_predictions(items):
    return sorted(items, key=lambda item: PRIORITY_WEIGHT[item.risk_level], reverse=True)


def _compact_feedback(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "feedback_type": entry.get("feedback_type"),
        "skill_area": entry.get("skill_area"),
        "rating": entry.get("rating"),
        "sentiment": entry.get("sentiment"),
        "comment": entry.get("comment"),
    }


def _compact_trend(item: dict[str, Any]) -> dict[str, Any]:
    first_score = _score_or_none(item.get("first_score"))
    latest_score = _score_or_none(item.get("latest_score"))
    delta = _score_delta(first_score, latest_score)
    return {
        "skill_area": item.get("skill_area"),
        "trend_label": item.get("trend_label"),
        "first_score": first_score,
        "latest_score": latest_score,
        "delta": delta,
        "slope_per_session": _bounded_number(item.get("slope"), -MAX_MENTORING_DELTA, MAX_MENTORING_DELTA),
        "session_count": item.get("session_count"),
        "recommendation": item.get("recommendation"),
    }


def _compact_prediction(item: dict[str, Any]) -> dict[str, Any]:
    current_score = _score_or_none(item.get("current_score"))
    predicted_score = _score_or_none(item.get("predicted_score"))
    if current_score is not None and predicted_score is not None:
        predicted_score = _bounded_prediction(current_score, predicted_score)
    projected_delta = _score_delta(current_score, predicted_score)

    return {
        "predicted_skill": item.get("predicted_skill"),
        "current_score": current_score,
        "predicted_score": predicted_score,
        "projected_delta": projected_delta,
        "trend_label": item.get("trend_label"),
        "risk_level": item.get("risk_level"),
        "confidence": _bounded_number(item.get("confidence"), 0.0, 1.0),
        "evidence_points": item.get("evidence_points"),
        "recommendation": item.get("recommendation"),
    }


def _contains_impossible_score_text(*values: str) -> bool:
    text = " ".join(value for value in values if value)
    return bool(IMPOSSIBLE_NEXT_SCORE_PATTERN.search(text))


def _sanitize_mentoring_text(value: str) -> str:
    sanitized = value
    for pattern, replacement in PEER_TEXT_REPLACEMENTS:
        sanitized = pattern.sub(replacement, sanitized)
    return sanitized.strip()


def _bounded_prediction(current_score: float, predicted_score: float) -> float:
    lower_bound = current_score - MAX_MENTORING_DELTA
    upper_bound = current_score + MAX_MENTORING_DELTA
    return round(_bounded_number(predicted_score, lower_bound, upper_bound), 2)


def _score_delta(first_score: float | None, latest_score: float | None) -> float | None:
    if first_score is None or latest_score is None:
        return None
    return round(latest_score - first_score, 2)


def _score_or_none(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return round(_bounded_number(value, MIN_SCORE, MAX_SCORE), 2)


def _bounded_number(value: Any, minimum: float, maximum: float) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return max(minimum, min(maximum, float(value)))


def _low_scores(scores: dict[str, float]) -> list[tuple[str, float]]:
    field_to_skill = {
        "confidence_score": "confidence",
        "clarity_score": "communication_clarity",
        "empathy_score": "empathy",
        "listening_score": "active_listening",
        "adaptability_score": "adaptability",
        "emotional_control_score": "emotional_control",
        "professionalism_score": "professionalism",
    }
    low = []
    for field, skill in field_to_skill.items():
        score = scores.get(field)
        if isinstance(score, (int, float)) and 0 < score < 70:
            low.append((skill, float(score)))
    return sorted(low, key=lambda item: item[1])


def _label(value: str | None) -> str:
    if not value:
        return "Overall"
    return value.replace("_", " ").replace("-", " ").title()


def _recommendation_json_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "recommendations": {
                "type": "array",
                "maxItems": MAX_RECOMMENDATIONS,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                        "skill_area": {"type": ["string", "null"]},
                        "title": {"type": "string"},
                        "reason": {"type": "string"},
                        "detail": {"type": "string"},
                        "next_action": {"type": "string"},
                        "evidence_sources": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": [
                        "priority",
                        "skill_area",
                        "title",
                        "reason",
                        "detail",
                        "next_action",
                        "evidence_sources",
                    ],
                },
            }
        },
        "required": ["recommendations"],
    }


_svc_logger = logging.getLogger(__name__)


def _save_recommendations_to_db(
    _unused_db: Session,
    result: MentoringRecommendationResult,
) -> None:
    """Save generated recommendations using a fresh session to avoid stale-connection failures after long LLM calls."""
    save_db = SessionLocal()
    try:
        _svc_logger.info(
            "Saving %d recommendations for user %s session %s",
            len(result.recommendations), result.user_id, result.session_id,
        )

        evidence_data = result.evidence if isinstance(result.evidence, dict) else {}

        if result.session_id:
            deleted = save_db.query(MentoringRecommendation).filter(
                MentoringRecommendation.user_id == result.user_id,
                MentoringRecommendation.session_id == result.session_id,
                MentoringRecommendation.recommendation_type == "session_specific",
            ).delete(synchronize_session=False)
        else:
            deleted = save_db.query(MentoringRecommendation).filter(
                MentoringRecommendation.user_id == result.user_id,
                MentoringRecommendation.session_id.is_(None),
                MentoringRecommendation.recommendation_type == "overall_user",
            ).delete(synchronize_session=False)

        _svc_logger.info("Deleted %d old recommendations", deleted)

        rec_type = result.recommendation_type or "overall_user"
        source = result.source or "llm"
        model_ver = (result.model_version or RECOMMENDATION_VERSION)[:40]

        for rec in result.recommendations:
            save_db.add(MentoringRecommendation(
                user_id=result.user_id,
                session_id=result.session_id,
                recommendation_type=rec_type,
                title=(rec.title or "Untitled")[:255],
                description=rec.reason or "",
                reason=rec.reason,
                detail=rec.detail,
                next_action=rec.next_action,
                priority=rec.priority or "medium",
                skill_area=rec.skill_area,
                confidence=None,
                evidence=evidence_data,
                source=source,
                model_version=model_ver,
            ))

        save_db.commit()
        _svc_logger.info("Saved %d recommendations to database", len(result.recommendations))
    except Exception as exc:
        save_db.rollback()
        _svc_logger.error("Failed to save recommendations: %s", exc, exc_info=True)
    finally:
        save_db.close()
