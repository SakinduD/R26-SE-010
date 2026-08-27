from datetime import datetime

from sqlalchemy.orm import Session

from app.schemas.analytics import (
    AnalyticsAggregateSummary,
    BlindSpotDetectionResult,
    PostSessionActionItem,
    PostSessionReportResult,
    PostSessionReportSummary,
    SessionContext,
    SkillContextItem,
    SkillPredictionRead,
    SkillScoreBreakdown,
    SkillScoreResult,
)
from app.models.analytics import AnalyticsSessionMetric
from app.services import (
    blind_spot_service,
    data_aggregation_service,
    feedback_analysis_service,
    predictive_modeling_service,
    progress_trend_service,
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
        context=_session_in_context(db, user_id, session_id, skill_scores) if user_id else None,
        generated_at=datetime.utcnow(),
        report_version=REPORT_VERSION,
    )


def _session_in_context(
    db: Session,
    user_id: str,
    session_id: str,
    skill_scores: SkillScoreResult,
) -> SessionContext | None:
    """This session measured against every other session the learner has.

    A score out of 100 cannot be read on its own. 67 is a good session for
    someone who usually scores 60 and a poor one for someone who usually scores
    82, and the report had no way to say which - it opened with "Vocal Command
    held up" over this learner's worst result in weeks.

    Every average here excludes the session being reported on. Comparing a score
    against an average that contains it shrinks the difference being shown, and
    on a short history it erases it: with three sessions, a score sits a third of
    the way into its own comparison.
    """
    others = [
        float(score)
        for stored_session, score in db.query(
            AnalyticsSessionMetric.session_id, AnalyticsSessionMetric.overall_score
        )
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .filter(AnalyticsSessionMetric.overall_score.isnot(None))
        .all()
        if stored_session != session_id
    ]
    if not others:
        return None

    trends = progress_trend_service.analyze_user_progress_trends(db, user_id)
    skills: list[SkillContextItem] = []
    for trend in trends.trends:
        session_score = skill_scores.skill_scores.get(trend.skill_area)
        if session_score is None:
            continue
        previous = [point.score for point in trend.points if point.session_id != session_id]
        if not previous:
            continue
        average = round(sum(previous) / len(previous), 2)
        best = max(previous)
        skills.append(
            SkillContextItem(
                skill_area=trend.skill_area,
                session_score=round(float(session_score), 2),
                previous_average=average,
                delta=round(float(session_score) - average, 2),
                previous_best=best,
                is_personal_best=float(session_score) > best,
            )
        )

    overall = skill_scores.overall_score
    previous_overall = round(sum(others) / len(others), 2)
    return SessionContext(
        sessions_compared=len(others),
        overall_score=overall,
        previous_overall_average=previous_overall,
        overall_delta=round(overall - previous_overall, 2) if overall is not None else None,
        skills=skills,
    )


def _compute_skill_scores(aggregate: AnalyticsAggregateSummary) -> SkillScoreResult:
    """Build composite MCA skill scores from the session aggregate.

    Priority order (same as Analytics Dashboard):
    1. Average the raw DB metric fields that belong to each composite skill.
    2. If no metric fields are present, fall back to skill_rating_averages from feedback.

    Overall is the multimodal engine's own score, read from the stored
    `overall_score`, not the mean of the four composites. It used to be that mean,
    which made the report internally tidy - Overall always equalled the average of
    the four boxes beside it - and made it disagree with the number the session
    itself produced. The engine weights its dimensions its own way; on this
    account the two differ on 37 of 99 sessions, by up to 13.5 points. A report
    about a session has to show the session's score.

    The mean is still the fallback, for a session that stored no overall of its
    own, and feedback average after that.
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

    stored_overall = averages.get("overall_score")
    if stored_overall is not None:
        overall_score = round(float(stored_overall), 2)
    elif available_scores:
        overall_score = round(sum(available_scores) / len(available_scores), 2)
    elif aggregate.feedback.average_rating is not None:
        overall_score = round(aggregate.feedback.average_rating, 2)
    else:
        overall_score = None

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
    # The headline is the one line somebody reads before deciding whether to read
    # the rest. It used to describe the report ("Session completed with focused
    # improvement areas") rather than the session, which told the learner nothing
    # they could not see from the panel titles.
    if completion_status == "empty":
        headline = "No results were recorded for this session."
    elif improvement_areas and strengths:
        headline = f"{strengths[0]} held up. {improvement_areas[0]} is the one to work on."
    elif improvement_areas:
        headline = f"{improvement_areas[0]} needs the most attention from this session."
    elif overestimation_count and blind_spots.summary.high_count:
        headline = "Solid scores, but your own read of them was some way off."
    elif strengths:
        headline = f"A strong session — {strengths[0]} led the way."
    else:
        headline = "Session recorded. Complete another to see how it compares."

    return PostSessionReportSummary(
        headline=headline,
        strengths=strengths,
        improvement_areas=improvement_areas,
        completion_status=completion_status,
    )


# Where a score stops being a worry and starts being something to build on.
#
# There used to be one line at 75: at or above it a skill was a strength, below
# it an improvement area, and nothing was allowed to be simply fine. A learner
# scoring 72, 72, 70 and 50 was told they had no strengths at all and four areas
# needing work - which is both untrue and useless, because when everything needs
# work nothing is prioritised. Two points either side of one number decided
# whether a skill was praised or flagged.
STRENGTH_SCORE = 70.0
CONCERN_SCORE = 60.0

# A report that names everything names nothing.
MAX_LISTED = 3


def _top_strengths(skill_scores: SkillScoreResult) -> list[str]:
    """The skills worth building on, best first."""
    ranked = sorted(
        (
            (skill_area, score)
            for skill_area, score in skill_scores.skill_scores.items()
            if score is not None and score >= STRENGTH_SCORE
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    return [_label(skill_area) for skill_area, _ in ranked[:MAX_LISTED]]


def _improvement_areas(
    skill_scores: SkillScoreResult,
    blind_spots: BlindSpotDetectionResult,
) -> list[str]:
    """The skills that actually need work, weakest first.

    Deliberately not the same thing as a blind spot. A blind spot says the
    learner read themselves wrong; it says nothing about whether the skill is
    weak, and somebody can misjudge a skill they are good at. Listing blind
    spots here as well put a 70-scoring skill in the "needs work" column purely
    because the learner had rated it 85 - while the panel immediately to the
    right of it was already reporting exactly that gap.
    """
    ranked = sorted(
        (
            (skill_area, score)
            for skill_area, score in skill_scores.skill_scores.items()
            if score is not None and score < STRENGTH_SCORE
        ),
        key=lambda item: item[1],
    )
    return [_label(skill_area) for skill_area, _ in ranked[:MAX_LISTED]]


def _steady_areas(skill_scores: SkillScoreResult) -> list[str]:
    """Neither a strength nor a worry - the middle band that used to not exist."""
    return [
        _label(skill_area)
        for skill_area, score in sorted(
            skill_scores.skill_scores.items(), key=lambda item: item[1] or 0, reverse=True
        )
        if score is not None and CONCERN_SCORE <= score < STRENGTH_SCORE
    ]


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
                # "before the next role-play session" - role-play is a separate
                # module and nothing in this component reports on it. The
                # sessions this report is about are multimodal ones.
                detail=(
                    f"Current score is {round(score)}. Add one focused exercise for "
                    f"{_label(skill_area).lower()} before your next session."
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
    """The skills weak enough to earn a practice item.

    Bounded by STRENGTH_SCORE, not by a number of its own. It used to cut at 72
    while _top_strengths kept everything from 70 up, so a skill scoring 70 or 71
    was a strength and a weakness at once - this session listed Presence &
    Engagement at 70 under "held up well" and then told the learner to practise
    it, two panels apart on the same screen.
    """
    return sorted(
        [
            (skill_area, score)
            for skill_area, score in skill_scores.skill_scores.items()
            if score is not None and score < STRENGTH_SCORE
        ],
        key=lambda item: item[1],
    )[:3]


def _has_action_for_skill(actions: list[PostSessionActionItem], skill_area: str) -> bool:
    return any(action.skill_area == skill_area for action in actions)


def _label(skill_area: str) -> str:
    return SKILL_LABELS.get(skill_area, skill_area.replace("_", " ").title())
