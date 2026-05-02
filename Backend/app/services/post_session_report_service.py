from datetime import datetime

from sqlalchemy.orm import Session

from app.schemas.analytics import (
    AnalyticsAggregateSummary,
    BlindSpotDetectionResult,
    PostSessionActionItem,
    PostSessionReportResult,
    PostSessionReportSummary,
    SkillPredictionRead,
    SkillScoreResult,
)
from app.services import (
    blind_spot_service,
    data_aggregation_service,
    feedback_analysis_service,
    skill_scoring_service,
)


REPORT_VERSION = "rule-based-report-v1"
SKILL_LABELS = {
    "confidence": "Confidence",
    "communication_clarity": "Communication clarity",
    "empathy": "Empathy",
    "active_listening": "Active listening",
    "adaptability": "Adaptability",
    "emotional_control": "Emotional control",
    "professionalism": "Professionalism",
    "overall": "Overall",
}


def generate_session_report(db: Session, session_id: str) -> PostSessionReportResult:
    aggregate = data_aggregation_service.get_session_aggregate(db, session_id)
    skill_scores = skill_scoring_service.calculate_session_skill_scores(db, session_id)
    feedback_analysis = feedback_analysis_service.analyze_session_feedback(db, session_id)
    blind_spots = blind_spot_service.detect_session_blind_spots(db, session_id)

    return PostSessionReportResult(
        session_id=session_id,
        user_id=aggregate.user_id or skill_scores.user_id or feedback_analysis.user_id,
        summary=_build_summary(aggregate, skill_scores, blind_spots),
        aggregate=aggregate,
        skill_scores=skill_scores,
        feedback_analysis=feedback_analysis,
        blind_spots=blind_spots,
        action_items=_build_action_items(skill_scores, blind_spots, aggregate.predictions.latest_predictions),
        generated_at=datetime.utcnow(),
        report_version=REPORT_VERSION,
    )


def _build_summary(
    aggregate: AnalyticsAggregateSummary,
    skill_scores: SkillScoreResult,
    blind_spots: BlindSpotDetectionResult,
) -> PostSessionReportSummary:
    strengths = _top_strengths(skill_scores)
    improvement_areas = _improvement_areas(skill_scores, blind_spots)
    completion_status = _completion_status(aggregate)

    if completion_status == "empty":
        headline = "No post-session analytics are available yet."
    elif blind_spots.summary.high_count:
        headline = "Session completed with high-priority blind spots to review."
    elif improvement_areas:
        headline = "Session completed with focused improvement areas."
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
        label = _label(item.skill_area)
        if label not in areas:
            areas.append(label)

    low_scores = sorted(
        [
            (skill_area, score)
            for skill_area, score in skill_scores.skill_scores.items()
            if score is not None and score < 70
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
        actions.append(
            PostSessionActionItem(
                priority=item.severity,
                skill_area=item.skill_area,
                title=f"Review {_label(item.skill_area)} blind spot",
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
