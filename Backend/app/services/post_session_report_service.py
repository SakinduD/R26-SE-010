from datetime import datetime

from sqlalchemy.orm import Session

from app.schemas.analytics import (
    AnalyticsAggregateSummary,
    BlindSpotDetectionResult,
    PostSessionActionItem,
    PostSessionReportResult,
    PostSessionReportSummary,
    SkillPredictionRead,
    SkillScoreBreakdown,
    SkillScoreResult,
)
from app.services import (
    blind_spot_service,
    data_aggregation_service,
    feedback_analysis_service,
    predictive_modeling_service,
)


REPORT_VERSION = "rule-based-report-v1"
SKILL_LABELS = {
    "vocal_command": "Vocal Command",
    "speech_fluency": "Speech Fluency",
    "presence_engagement": "Presence & Engagement",
    "emotional_intelligence": "Emotional Intelligence",
    "overall": "Overall",
}

# Maps each composite MCA skill → the raw DB metric fields that contribute to it.
# Scores are averaged across whichever fields are present in the session aggregate.
COMPOSITE_SCORE_FIELDS: dict[str, list[str]] = {
    "vocal_command": ["speech_volume_score", "professionalism_score"],
    "speech_fluency": ["speech_pace_score", "clarity_score"],
    "presence_engagement": ["eye_contact_score", "confidence_score"],
    "emotional_intelligence": ["empathy_score", "emotional_control_score"],
}

MCA_WEIGHTS: dict[str, float] = {
    "emotional_intelligence": 0.30,
    "presence_engagement": 0.30,
    "vocal_command": 0.20,
    "speech_fluency": 0.20,
}


def generate_session_report(db: Session, session_id: str) -> PostSessionReportResult:
    aggregate = data_aggregation_service.get_session_aggregate(db, session_id)
    skill_scores = _compute_skill_scores(aggregate)
    feedback_analysis = feedback_analysis_service.analyze_session_feedback(db, session_id)
    blind_spots = blind_spot_service.detect_session_blind_spots(db, session_id)
    user_id = aggregate.user_id or feedback_analysis.user_id

    computed_predictions = []
    if user_id:
        try:
            pred_result = predictive_modeling_service.predict_user_skill_outcomes(
                db, user_id, session_id
            )
            computed_predictions = pred_result.predictions
        except Exception:
            pass

    return PostSessionReportResult(
        session_id=session_id,
        user_id=user_id,
        summary=_build_summary(aggregate, skill_scores, blind_spots),
        aggregate=aggregate,
        skill_scores=skill_scores,
        feedback_analysis=feedback_analysis,
        blind_spots=blind_spots,
        action_items=_build_action_items(skill_scores, blind_spots, aggregate.predictions.latest_predictions),
        computed_predictions=computed_predictions,
        generated_at=datetime.utcnow(),
        report_version=REPORT_VERSION,
    )


def _compute_skill_scores(aggregate: AnalyticsAggregateSummary) -> SkillScoreResult:
    """Build composite MCA skill scores from the session aggregate.

    Priority order (same as Analytics Dashboard):
    1. Average the raw DB metric fields that belong to each composite skill.
    2. If no metric fields are present, fall back to skill_rating_averages from feedback.
    Overall score uses the stored overall_score from the DB metric if available,
    so it matches the Dashboard exactly.
    """
    averages = aggregate.scores.averages
    feedback_avgs = aggregate.feedback.skill_rating_averages

    skill_scores: dict[str, float | None] = {}
    breakdown: dict[str, SkillScoreBreakdown] = {}
    available_scores: list[float] = []

    for skill_name, fields in COMPOSITE_SCORE_FIELDS.items():
        vals = [(f, averages[f]) for f in fields if f in averages and averages[f] is not None]
        if vals:
            score = round(sum(v for _, v in vals) / len(vals), 2)
            inputs_used = [f for f, _ in vals]
        elif skill_name in feedback_avgs and feedback_avgs[skill_name] is not None:
            # Fall back to overall feedback average for this skill (matches Dashboard)
            score = round(feedback_avgs[skill_name], 2)
            inputs_used = [f"feedback:{skill_name}"]
        else:
            score = None
            inputs_used = []

        skill_scores[skill_name] = score
        breakdown[skill_name] = SkillScoreBreakdown(score=score, inputs_used=inputs_used)
        if score is not None:
            available_scores.append(score)

    # Use the stored overall_score from the DB metric first (matches Dashboard)
    if "overall_score" in averages and averages["overall_score"] is not None:
        overall_score = round(averages["overall_score"], 2)
    else:
        weighted_sum = 0.0
        total_weight = 0.0
        for skill_key, weight in MCA_WEIGHTS.items():
            val = skill_scores.get(skill_key)
            if val is not None:
                weighted_sum += val * weight
                total_weight += weight
        if total_weight > 0:
            overall_score = round(weighted_sum / total_weight, 2)
        elif aggregate.feedback.average_rating is not None:
            overall_score = round(aggregate.feedback.average_rating, 2)
        else:
            overall_score = round(sum(available_scores) / len(available_scores), 2) if available_scores else None

    completeness = round(len(available_scores) / len(COMPOSITE_SCORE_FIELDS), 2)

    return SkillScoreResult(
        user_id=aggregate.user_id,
        session_id=aggregate.session_id,
        skill_scores=skill_scores,
        breakdown=breakdown,
        overall_score=overall_score,
        completeness=completeness,
        scoring_version="composite-from-aggregate-v1",
    )


def _build_summary(
    aggregate: AnalyticsAggregateSummary,
    skill_scores: SkillScoreResult,
    blind_spots: BlindSpotDetectionResult,
) -> PostSessionReportSummary:
    strengths = _top_strengths(skill_scores)
    improvement_areas = _improvement_areas(skill_scores, blind_spots)
    completion_status = _completion_status(aggregate)

    overestimation_count = sum(
        1 for item in blind_spots.blind_spots if item.blind_spot_type == "overestimation"
    )
    if completion_status == "empty":
        headline = "No post-session analytics are available yet."
    elif overestimation_count > 0 and blind_spots.summary.high_count:
        headline = "Session completed with high-priority blind spots to review."
    elif improvement_areas:
        headline = "Session completed with focused improvement areas."
    elif any(item.blind_spot_type == "underestimation" for item in blind_spots.blind_spots):
        headline = "Session completed with strong performance — build on your confidence."
    else:
        headline = "Session completed with steady skill performance."

    return PostSessionReportSummary(
        headline=headline,
        strengths=strengths,
        improvement_areas=improvement_areas,
        completion_status=completion_status,
    )


def _top_strengths(skill_scores: SkillScoreResult) -> list[str]:
    ranked_scores = sorted(
        [
            (skill_area, score)
            for skill_area, score in skill_scores.skill_scores.items()
            if score is not None and score >= 75
        ],
        key=lambda item: item[1],
        reverse=True,
    )
    return [_label(skill_area) for skill_area, _score in ranked_scores[:3]]


def _improvement_areas(
    skill_scores: SkillScoreResult,
    blind_spots: BlindSpotDetectionResult,
) -> list[str]:
    areas = []
    for item in blind_spots.blind_spots:
        if item.blind_spot_type != "overestimation":
            continue
        label = _label(item.skill_area)
        if label not in areas:
            areas.append(label)

    low_scores = sorted(
        [
            (skill_area, score)
            for skill_area, score in skill_scores.skill_scores.items()
            if score is not None and score < 75
        ],
        key=lambda item: item[1],
    )
    for skill_area, _score in low_scores:
        label = _label(skill_area)
        if label not in areas:
            areas.append(label)

    return areas[:4]


def _completion_status(aggregate: AnalyticsAggregateSummary) -> str:
    completeness = aggregate.data_completeness
    completed_parts = sum(
        [
            completeness.has_session_metrics,
            completeness.has_feedback,
            completeness.has_predictions,
        ]
    )
    if completed_parts == 3:
        return "complete"
    if completed_parts == 0:
        return "empty"
    return "partial"


def _build_action_items(
    skill_scores: SkillScoreResult,
    blind_spots: BlindSpotDetectionResult,
    predictions: list[SkillPredictionRead],
) -> list[PostSessionActionItem]:
    actions: list[PostSessionActionItem] = []

    for item in blind_spots.blind_spots[:3]:
        if item.blind_spot_type == "overestimation":
            title = f"Review {_label(item.skill_area)} blind spot"
            priority = item.severity
        else:
            title = f"Build confidence in {_label(item.skill_area)}"
            priority = "low"
        actions.append(
            PostSessionActionItem(
                priority=priority,
                skill_area=item.skill_area,
                title=title,
                detail=item.recommendation,
            )
        )

    for skill_area, score in _lowest_scores(skill_scores):
        if _has_action_for_skill(actions, skill_area):
            continue
        actions.append(
            PostSessionActionItem(
                priority="medium" if score < 60 else "low",
                skill_area=skill_area,
                title=f"Practice {_label(skill_area)}",
                detail=(
                    f"Current score is {round(score)}. Add one focused exercise for "
                    f"{_label(skill_area).lower()} before the next role-play session."
                ),
            )
        )

    for prediction in predictions:
        if prediction.risk_level != "high" or _has_action_for_skill(actions, prediction.predicted_skill):
            continue
        actions.append(
            PostSessionActionItem(
                priority="high",
                skill_area=prediction.predicted_skill,
                title=f"Reduce {_label(prediction.predicted_skill)} risk",
                detail=prediction.recommendation or "Review this risk before the next session.",
            )
        )

    if not actions:
        actions.append(
            PostSessionActionItem(
                priority="low",
                skill_area=None,
                title="Maintain current progress",
                detail="Continue practicing with the same scenario difficulty and review feedback after each session.",
            )
        )

    return actions[:6]


def _lowest_scores(skill_scores: SkillScoreResult) -> list[tuple[str, float]]:
    return sorted(
        [
            (skill_area, score)
            for skill_area, score in skill_scores.skill_scores.items()
            if score is not None and score < 72
        ],
        key=lambda item: item[1],
    )[:3]


def _has_action_for_skill(actions: list[PostSessionActionItem], skill_area: str) -> bool:
    return any(action.skill_area == skill_area for action in actions)


def _label(skill_area: str) -> str:
    return SKILL_LABELS.get(skill_area, skill_area.replace("_", " ").title())
