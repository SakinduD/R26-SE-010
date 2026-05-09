from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.schemas.analytics import (
    SkillScoreBreakdown,
    SkillScoreInputs,
    SkillScoreRequest,
    SkillScoreResult,
)


SCORING_VERSION = "rule-based-v1"


@dataclass(frozen=True)
class WeightedInput:
    field: str
    weight: float


SKILL_FORMULAS = {
    "confidence": [
        WeightedInput("confidence_score", 0.45),
        WeightedInput("eye_contact_score", 0.25),
        WeightedInput("speech_volume_score", 0.20),
        WeightedInput("peer_rating", 0.10),
    ],
    "communication_clarity": [
        WeightedInput("clarity_score", 0.35),
        WeightedInput("speech_pace_score", 0.20),
        WeightedInput("response_quality_score", 0.30),
        WeightedInput("peer_rating", 0.15),
    ],
    "empathy": [
        WeightedInput("empathy_score", 0.55),
        WeightedInput("peer_rating", 0.30),
        WeightedInput("self_rating", 0.15),
    ],
    "active_listening": [
        WeightedInput("listening_score", 0.70),
        WeightedInput("response_quality_score", 0.20),
        WeightedInput("peer_rating", 0.10),
    ],
    "adaptability": [
        WeightedInput("adaptability_score", 0.65),
        WeightedInput("response_quality_score", 0.20),
        WeightedInput("peer_rating", 0.15),
    ],
    "emotional_control": [
        WeightedInput("emotional_control_score", 0.70),
        WeightedInput("speech_pace_score", 0.15),
        WeightedInput("speech_volume_score", 0.15),
    ],
    "professionalism": [
        WeightedInput("professionalism_score", 0.55),
        WeightedInput("emotional_control_score", 0.25),
        WeightedInput("clarity_score", 0.20),
    ],
}


def calculate_skill_scores(request: SkillScoreRequest) -> SkillScoreResult:
    return _calculate_result(
        inputs=request.inputs,
        user_id=request.user_id,
        session_id=request.session_id,
    )


def calculate_session_skill_scores(db: Session, session_id: str) -> SkillScoreResult:
    metrics = (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.session_id == session_id)
        .order_by(AnalyticsSessionMetric.created_at.desc())
        .all()
    )
    feedback = (
        db.query(FeedbackEntry)
        .filter(FeedbackEntry.session_id == session_id)
        .order_by(FeedbackEntry.created_at.desc())
        .all()
    )

    user_id = _resolve_user_id(metrics, feedback)
    inputs = _build_inputs_from_session_data(metrics, feedback)
    return _calculate_result(inputs=inputs, user_id=user_id, session_id=session_id)


def _calculate_result(
    *,
    inputs: SkillScoreInputs,
    user_id: str | None,
    session_id: str | None,
) -> SkillScoreResult:
    skill_scores = {}
    breakdown = {}

    for skill_name, formula in SKILL_FORMULAS.items():
        score, input_names = _weighted_average(inputs, formula)
        skill_scores[skill_name] = score
        breakdown[skill_name] = SkillScoreBreakdown(
            score=score,
            inputs_used=input_names,
        )

    available_scores = [score for score in skill_scores.values() if score is not None]
    overall_score = round(sum(available_scores) / len(available_scores), 2) if available_scores else None

    return SkillScoreResult(
        user_id=user_id,
        session_id=session_id,
        skill_scores=skill_scores,
        breakdown=breakdown,
        overall_score=overall_score,
        completeness=round(len(available_scores) / len(SKILL_FORMULAS), 2),
        scoring_version=SCORING_VERSION,
    )


def _weighted_average(
    inputs: SkillScoreInputs,
    formula: list[WeightedInput],
) -> tuple[float | None, list[str]]:
    weighted_total = 0.0
    active_weight = 0.0
    input_names = []

    for item in formula:
        value = getattr(inputs, item.field)
        if value is None:
            continue
        weighted_total += value * item.weight
        active_weight += item.weight
        input_names.append(item.field)

    if active_weight == 0:
        return None, []

    return round(weighted_total / active_weight, 2), input_names


def _build_inputs_from_session_data(
    metrics: list[AnalyticsSessionMetric],
    feedback: list[FeedbackEntry],
) -> SkillScoreInputs:
    metric_values = {
        field: _average([getattr(metric, field) for metric in metrics])
        for field in SkillScoreInputs.model_fields
        if field not in {"self_rating", "peer_rating"}
    }

    metric_values["self_rating"] = _feedback_average(feedback, "self")
    metric_values["peer_rating"] = _feedback_average(feedback, "peer")
    return SkillScoreInputs(**metric_values)


def _average(values: list[float | None]) -> float | None:
    clean_values = [value for value in values if value is not None]
    if not clean_values:
        return None
    return round(sum(clean_values) / len(clean_values), 2)


def _feedback_average(feedback: list[FeedbackEntry], feedback_type: str) -> float | None:
    ratings = [
        entry.rating
        for entry in feedback
        if entry.feedback_type == feedback_type and entry.rating is not None
    ]
    return _average(ratings)


def _resolve_user_id(
    metrics: list[AnalyticsSessionMetric],
    feedback: list[FeedbackEntry],
) -> str | None:
    if metrics:
        return metrics[0].user_id
    if feedback:
        return feedback[0].user_id
    return None
