import json
import re
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
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


def generate_user_mentoring_recommendations(
    db: Session,
    user_id: str,
    limit: int = 100,
) -> MentoringRecommendationResult:
    evidence_bundle = _collect_evidence(db, user_id, limit)
    settings = get_settings()

    llm_items = _call_openai_mentoring(evidence_bundle) if settings.openai_api_key else None
    if llm_items:
        return MentoringRecommendationResult(
            user_id=user_id,
            recommendations=llm_items[:MAX_RECOMMENDATIONS],
            evidence=evidence_bundle["summary"],
            generated_at=datetime.utcnow(),
            recommendation_version=RECOMMENDATION_VERSION,
            model_version=settings.openai_mentoring_model,
            source="llm",
        )

    fallback_items = _build_rule_based_recommendations(evidence_bundle)
    return MentoringRecommendationResult(
        user_id=user_id,
        recommendations=fallback_items[:MAX_RECOMMENDATIONS],
        evidence=evidence_bundle["summary"],
        generated_at=datetime.utcnow(),
        recommendation_version=RECOMMENDATION_VERSION,
        model_version=FALLBACK_MODEL_VERSION,
        source="rule_based",
    )


def _collect_evidence(db: Session, user_id: str, limit: int) -> dict[str, Any]:
    aggregate = data_aggregation_service.get_user_aggregate(db, user_id, limit)
    feedback_analysis = feedback_analysis_service.analyze_user_feedback(db, user_id, limit)
    blind_spots = blind_spot_service.detect_user_blind_spots(db, user_id, limit)
    trends = progress_trend_service.analyze_user_progress_trends(db, user_id, limit)
    predictions = predictive_modeling_service.predict_user_skill_outcomes(db, user_id, limit)

    return {
        "user_id": user_id,
        "summary": {
            "session_count": aggregate.scores.metric_count,
            "feedback_count": aggregate.feedback.total_count,
            "average_feedback_rating": aggregate.feedback.average_rating,
            "blind_spot_count": blind_spots.summary.total_count,
            "high_blind_spot_count": blind_spots.summary.high_count,
            "prediction_count": predictions.summary.predicted_count,
            "high_risk_prediction_count": predictions.summary.high_risk_count,
            "medium_risk_prediction_count": predictions.summary.medium_risk_count,
            "improving_count": trends.summary.improving_count,
            "declining_count": trends.summary.declining_count,
            "sentiment_positive_count": aggregate.feedback.sentiment_counts.get("positive", 0),
            "sentiment_negative_count": aggregate.feedback.sentiment_counts.get("negative", 0),
        },
        "scores": aggregate.scores.averages,
        "latest_feedback": [
            _compact_feedback(entry.model_dump(mode="json"))
            for entry in aggregate.feedback.latest_entries[:5]
        ],
        "feedback_alignment": [
            item.model_dump(mode="json")
            for item in _rank_feedback_items(feedback_analysis.items)[:6]
        ],
        "blind_spots": [
            item.model_dump(mode="json")
            for item in blind_spots.blind_spots[:6]
        ],
        "trends": [
            _compact_trend(item.model_dump(mode="json"))
            for item in _rank_trends(trends.trends)[:7]
        ],
        "predictions": [
            _compact_prediction(item.model_dump(mode="json"))
            for item in _rank_predictions(predictions.predictions)[:7]
        ],
    }


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
        "When discussing a trend, describe it as a point change, not as a predicted score."
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
        title = str(raw.get("title") or "").strip()
        detail = str(raw.get("detail") or "").strip()
        next_action = str(raw.get("next_action") or "").strip()
        if not title or not detail or not next_action:
            continue
        reason = str(raw.get("reason") or detail).strip()
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
