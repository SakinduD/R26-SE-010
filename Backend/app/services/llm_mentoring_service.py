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

logger = logging.getLogger(__name__)


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


def _has_usable_evidence(evidence_bundle: dict[str, Any]) -> bool:
    """Is there anything here to give advice about?

    A learner with no sessions still produces a bundle: four trends, all labelled
    insufficient_data with a session_count of zero. The model sees four skill
    names in that and writes confident, specific advice about each - "record a
    60-90 second speaking clip focused on voice" - for somebody it knows nothing
    about. It reads as personalised and is not, which is the one thing coaching
    advice must never be.

    It is also the prompt's own rule ("only for skills the evidence actually says
    something about") being broken by evidence that looks fuller than it is. The
    fix belongs here rather than in the prompt: do not ask a question there is no
    material to answer.
    """
    summary = evidence_bundle.get("summary") or {}
    if summary.get("session_count") or summary.get("feedback_count"):
        return True
    if evidence_bundle.get("scores"):
        return True
    return any(
        evidence_bundle.get(key)
        for key in ("blind_spots", "feedback_alignment", "latest_feedback")
    )


def generate_user_mentoring_recommendations(
    db: Session,
    user_id: str,
    limit: int = data_aggregation_service.FULL_HISTORY_LIMIT,
) -> MentoringRecommendationResult:
    """Advice for a learner, drawn from everything they have done.

    ``limit`` is passed straight through to the four services this reads, so at
    100 it truncated all of them at once: the advice was composed from 100 of
    118 sessions and 100 of 392 feedback entries, and the trend it reasoned
    about was not the trend the Trends page showed. Recommendations built on a
    different history than the one the learner can see are worse than none.
    """
    evidence_bundle = _collect_evidence(db, user_id, limit)
    settings = get_settings()

    llm_items = (
        _call_openai_mentoring(evidence_bundle)
        if settings.openai_api_key and _has_usable_evidence(evidence_bundle)
        else None
    )
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

    llm_items = (
        _call_openai_session_mentoring(evidence_bundle)
        if settings.openai_api_key and _has_usable_evidence(evidence_bundle)
        else None
    )
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


# Mirrors TREND_SCORE_FIELDS: each tracked skill and the columns it is built
# from. Kept in this shape so the model is given the same four skills, under the
# same names, as every screen the learner looks at.
_TRACKED_SKILL_COLUMNS = {
    "vocal_command": ["speech_volume_score"],
    "speech_fluency": ["speech_pace_score", "clarity_score"],
    "presence_engagement": ["eye_contact_score", "confidence_score"],
    "emotional_intelligence": ["empathy_score", "emotional_control_score"],
}


def _tracked_skill_scores(averages: dict[str, float]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for skill, columns in _TRACKED_SKILL_COLUMNS.items():
        values = [averages[column] for column in columns if averages.get(column) is not None]
        if values:
            scores[skill] = round(sum(values) / len(values), 2)
    if averages.get("overall_score") is not None:
        scores["overall"] = round(averages["overall_score"], 2)
    return scores


def _collect_evidence(db: Session, user_id: str, limit: int) -> dict[str, Any]:
    try:
        aggregate = data_aggregation_service.get_user_aggregate(db, user_id, limit)
    except Exception:
        logger.exception("Could not read aggregate for mentoring evidence (user %s)", user_id)
        db.rollback()
        aggregate = None
    
    try:
        feedback_analysis = feedback_analysis_service.analyze_user_feedback(db, user_id, limit)
    except Exception:
        logger.exception("Could not read feedback_analysis for mentoring evidence (user %s)", user_id)
        db.rollback()
        feedback_analysis = None
    
    try:
        blind_spots = blind_spot_service.detect_user_blind_spots(db, user_id, limit)
    except Exception:
        logger.exception("Could not read blind_spots for mentoring evidence (user %s)", user_id)
        db.rollback()
        blind_spots = None
    
    # Both of these take session_id third, not limit. Passing the limit
    # positionally sent 10000 in as a session id, Postgres refused to compare a
    # varchar against an integer, and the bare except swallowed it - so the model
    # was asked for advice with no trend and no forecast in front of it. Worse,
    # the failed statement aborted the transaction, which took the prediction
    # call down with it. The single most important thing this learner's data says
    # - three skills slipping - never reached the prompt.
    try:
        trends = progress_trend_service.analyze_user_progress_trends(db, user_id, limit=limit)
    except Exception:
        logger.exception("Could not read trends for mentoring evidence (user %s)", user_id)
        db.rollback()
        trends = None

    try:
        predictions = predictive_modeling_service.predict_user_skill_outcomes(db, user_id)
    except Exception:
        logger.exception("Could not read predictions for mentoring evidence (user %s)", user_id)
        db.rollback()
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
        # The four skills this product actually tracks, not the raw metric
        # columns behind them. Sending the columns meant the model wrote advice
        # about "professionalism" (20.2) and "response_quality" (47.3) - names
        # the learner has never seen, on a dashboard that shows four different
        # ones. Advice about a skill nobody can find is worse than no advice.
        "scores": _tracked_skill_scores(aggregate.scores.averages if aggregate else {}),
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


# Everything both prompts share: what the evidence means, what a good
# recommendation looks like, and the lines this system does not cross.
#
# Written once because it was written twice and drifted. The session prompt had
# lost "non-clinical", the ban on diagnoses, and the score-range guard while the
# user prompt kept all three. A safety rule with two copies has none.

# What the JSON fields actually mean.
#
# Without this the model infers the semantics from field names, and the sign of
# a gap is the one it cannot afford to get backwards: telling a learner who
# consistently underrates themselves that they are overconfident is worse than
# saying nothing. It read the evidence correctly in testing, but "it guessed
# right" is not a property to rely on.
_EVIDENCE_GLOSSARY = (
    "How to read the evidence. "
    "scores: the learner's average for each tracked skill, 0-100. "
    "feedback_alignment and blind_spots: the learner rated themselves after a "
    "session, and that rating is compared with what was measured. A NEGATIVE gap "
    "means they rated themselves LOWER than measured - they are underselling "
    "themselves. A POSITIVE gap means they rated themselves HIGHER than measured. "
    "trends: delta is the change from their first session to their latest, and "
    "slope_per_session is the direction across all of them; when the two "
    "disagree, trust the slope, because delta compares two single sessions. "
    "predictions: where a skill lands next session if nothing changes, with "
    "risk_level ranking how much that matters. "
    "latest_feedback: the learner's own words, with sentiment as the model read "
    "them - 'mixed' means the reflection holds a positive and a negative "
    "judgement at once, which is not the same as neutral."
)

# What separates a recommendation worth reading from filler.
_QUALITY_RULES = (
    "Each recommendation must name one thing to change and one way to practise "
    "it in a single upcoming session. Prefer a specific, observable action - "
    "'pause for one breath before answering' - over a general one - 'work on "
    "your listening'. Say what the evidence shows and let the learner draw the "
    "conclusion; do not tell them how they feel. "
    # Cover every measured skill, but do not manufacture a fault to fill the slot.
    #
    # This used to read "only for skills the evidence actually says something
    # about", which produced three cards where the learner knows they have four
    # skills - and a missing card reads as a question, not as reassurance.
    # Forcing a fourth was worse: asked to cover a skill whose self-rating
    # already matched the measurement, the model wrote "aligned; it's adequate
    # but can be tightened to improve clarity" - a sentence that could be said
    # about anything, at any time, and means nothing.
    #
    # So: one card per measured skill, and where there is no gap the finding IS
    # the absence of one. Rating yourself accurately is a real result, and saying
    # so is information rather than praise.
    "Give exactly one recommendation for each skill the evidence has a score for, "
    "and never more than one per skill. "
    "Where a skill shows a genuine problem - a gap between rating and "
    "measurement, a low score, a declining trend - say what to change. "
    "Where a skill shows no problem, do not invent one and do not pad. Say "
    "plainly that it is on track, name the evidence that shows it - an accurate "
    "self-rating is itself worth reporting - and give one small thing that keeps "
    "it there or stretches it. Mark those 'low'. "
    "Use priority 'high' only where the evidence is strong: a high risk_level, a "
    "high-severity blind spot, or a clearly declining trend."
)

# The lines this system does not cross.
_BOUNDARY_RULES = (
    "Use only the evidence provided. Do not invent sessions, scores, diagnoses, "
    "or private facts about the learner. "
    "All scores are already on a 0-100 scale; never write a negative score or "
    "one above 100. "
    "The only skills this system tracks are vocal_command, speech_fluency, "
    "presence_engagement and emotional_intelligence. Use skill_area values from "
    "that list only, or null for advice that spans all of them. Never name any "
    "other skill - the learner has no screen where a fifth skill exists. "
    # The evidence carries the learner's own written reflections, so their words
    # reach this model. Coaching a personal disclosure is neither what this
    # system is for nor something it is qualified to do. The boundary is practice
    # technique; anything past it is left for a person.
    "The evidence may contain the learner's own written reflections. Comment only "
    "on their practice technique. If a reflection mentions distress, anxiety, "
    "burnout, health, or their personal life, do not respond to it, do not quote "
    "it, and do not offer reassurance, therapy, counselling or wellbeing advice. "
    "Give no advice at all on that subject. "
    "Do not ask the learner to collect peer feedback or peer ratings - this "
    "system has none. Say 'observed performance evidence' or 'system evidence' "
    "rather than naming internal components."
)

# How the words should land.
_VOICE_RULES = (
    "Write to the learner as 'you'. They are early in their career, not a "
    "beginner at being an adult: be direct and practical, never congratulatory "
    "for its own sake and never patronising. Keep every field to one or two "
    "short sentences. Titles are imperative and specific - 'Hold eye contact "
    "through your first answer', not 'Presence improvement'."
)

_SHARED_PROMPT_RULES = (
    _EVIDENCE_GLOSSARY + " " + _QUALITY_RULES + " " + _BOUNDARY_RULES + " " + _VOICE_RULES
)


def _collect_session_evidence(db: Session, session_id: str) -> dict[str, Any]:
    """Collect evidence specific to a single session."""
    try:
        aggregate = data_aggregation_service.get_session_aggregate(db, session_id)
    except Exception:
        logger.exception("Could not read aggregate for session %s", session_id)
        db.rollback()
        aggregate = None
    
    try:
        feedback_analysis = feedback_analysis_service.analyze_session_feedback(db, session_id)
    except Exception:
        logger.exception("Could not read feedback_analysis for session %s", session_id)
        db.rollback()
        feedback_analysis = None
    
    try:
        blind_spots = blind_spot_service.detect_session_blind_spots(db, session_id)
    except Exception:
        logger.exception("Could not read blind_spots for session %s", session_id)
        db.rollback()
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
        # Same reasoning as the user-scope collector: the four skills the
        # learner sees, not the metric columns underneath them. Left as raw
        # columns here, the model wrote session advice about "listening",
        # "empathy" and "emotional control" - three names that appear on no
        # screen in this product.
        "scores": _tracked_skill_scores(
            aggregate.scores.averages if aggregate and aggregate.scores else {}
        ),
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
        "You are a soft-skills practice coach. The learner has just finished one "
        "practice session and is looking at their results. Tell them what to do "
        "differently in their next attempt. "
        "Everything here is about this one session - do not describe long-term "
        "progress or trends, because a single session cannot show either. "
        "Lead with the widest gap between what they thought and what was "
        "measured, then the lowest scores. "
        + _SHARED_PROMPT_RULES
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
                # The field is comparison_score. It was written as
                # observed_rating, which does not exist, so this whole branch
                # raised KeyError - and because it is the fallback, it only ran
                # when the LLM was already unavailable. A path that exists to
                # catch a failure cannot itself be broken; it had never been
                # executed once in production.
                detail=f"You rated yourself {blind_spot['self_rating']} but the "
                       f"session measured {blind_spot.get('comparison_score')}. "
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
        "You are a soft-skills practice coach. The learner has been practising "
        "for a while and wants to know where to put their effort next. Work from "
        "the whole history, not the most recent session. "
        "Lead with what is getting worse over time, then high-risk predictions, "
        "then patterns in how they rate themselves. A skill that is merely low "
        "but steady matters less than one that is falling. "
        "Describe a trend as a change in points across sessions, never as a "
        "predicted future score. "
        + _SHARED_PROMPT_RULES
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


# Every metric column that feeds a tracked skill, mapped to the skill a learner
# would recognise. The model is given only the four names now, but it is a
# language model reading evidence full of blind spots and feedback entries, and
# it will occasionally answer with something it saw in there. This is the last
# gate: a recommendation is filed under a skill the product actually shows, or
# under nothing at all.
_SKILL_ALIASES = {
    "speech_volume": "vocal_command", "speech_volume_score": "vocal_command",
    "professionalism": "vocal_command", "volume": "vocal_command",
    "voice": "vocal_command", "vocal": "vocal_command",
    "speech_pace": "speech_fluency", "pace": "speech_fluency",
    "clarity": "speech_fluency", "communication_clarity": "speech_fluency",
    "fluency": "speech_fluency", "response_quality": "speech_fluency",
    "eye_contact": "presence_engagement", "confidence": "presence_engagement",
    "presence": "presence_engagement", "engagement": "presence_engagement",
    "adaptability": "presence_engagement",
    "empathy": "emotional_intelligence", "listening": "emotional_intelligence",
    "active_listening": "emotional_intelligence",
    "emotional_control": "emotional_intelligence",
    "emotional_regulation": "emotional_intelligence",
}
_TRACKED_SKILLS = frozenset(_TRACKED_SKILL_COLUMNS)


def _normalise_skill_area(value: Any) -> str | None:
    """The learner's four skills, or None. Never an invented fifth."""
    if not value:
        return None
    key = str(value).strip().lower().replace(" ", "_").replace("-", "_")
    if key in _TRACKED_SKILLS:
        return key
    if key == "overall":
        return "overall"
    mapped = _SKILL_ALIASES.get(key) or _SKILL_ALIASES.get(key.removesuffix("_score"))
    if mapped:
        logger.info("Mentoring skill_area %r mapped to %r", value, mapped)
        return mapped
    # Unrecognised. Filed against no skill rather than shown under a name the
    # learner cannot find anywhere else in the product.
    logger.warning("Mentoring skill_area %r is not a tracked skill; dropping it", value)
    return None


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
                skill_area=_normalise_skill_area(raw.get("skill_area")),
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
                        # Constrained rather than free text. The prompt asks for
                    # these four; the schema is what makes it impossible to
                    # answer with a fifth, and _normalise_skill_area is the last
                    # net under both. A recommendation filed under a skill the
                    # learner cannot find on any screen is not usable advice.
                    "skill_area": {
                        "type": ["string", "null"],
                        "enum": [*sorted(_TRACKED_SKILL_COLUMNS), "overall", None],
                    },
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
