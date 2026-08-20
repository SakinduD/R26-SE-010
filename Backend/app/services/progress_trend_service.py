from collections import defaultdict
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.schemas.analytics import (
    ProgressTrendPoint,
    ProgressTrendResult,
    ProgressTrendSummary,
    SkillTrendItem,
)


TREND_VERSION = "rule-based-v1"

# What a caller passes when it wants the learner's whole history rather than a
# page of it. Same reasoning as the constant of this name in
# data_aggregation_service: a summary that silently drops rows reports a number
# that is not about what its label says it is about.
FULL_HISTORY_LIMIT = 10_000
STABLE_DELTA_THRESHOLD = 5.0
STABLE_SLOPE_THRESHOLD = 2.0


# The four soft-skill dimensions tracked over time. "Overall" is intentionally
# excluded: it is a summary (the mean of these four skills), not a skill itself,
# so it must not appear as its own trend line or prediction.
TREND_SCORE_FIELDS = {
    "vocal_command": "speech_volume_score",
    "speech_fluency": "speech_pace_score",
    "presence_engagement": "eye_contact_score",
    "emotional_intelligence": "empathy_score",
}

FEEDBACK_SKILL_ALIASES = {
    "communication_clarity": {"communication_clarity", "clarity"},
    "active_listening": {"active_listening", "listening"},
}


def analyze_user_progress_trends(
    db: Session, user_id: str, session_id: str | None = None, limit: int = FULL_HISTORY_LIMIT
) -> ProgressTrendResult:
    """Trend lines for the four tracked skills.

    ``limit`` caps how many metric rows are considered (most recent first).

    It defaults to the learner's whole history, and has to. The default was 100,
    chosen for responsiveness, and it silently changed the answer: with 118
    sessions it dropped the oldest 18 — the ones that establish where the learner
    started — and two skills that were declining across the full history came
    back labelled "stable". A trend measured from an arbitrary point is not a
    trend, and the saving was 18 rows.
    """
    cutoff_id = _session_cutoff_id(db, user_id, session_id)
    metrics = _query_user_metrics(db, user_id, limit=limit, cutoff_id=cutoff_id)
    session_ids = {m.session_id for m in metrics} if cutoff_id is not None else None
    feedback = _query_user_feedback(db, user_id, limit=limit, session_ids=session_ids)
    trends = [
        _build_skill_trend(skill_area, field, metrics, feedback)
        for skill_area, field in TREND_SCORE_FIELDS.items()
    ]
    cutoff_metric = metrics[-1] if metrics and cutoff_id is not None else None
    return _build_result(user_id=user_id, trends=trends, cutoff_at=cutoff_metric.created_at if cutoff_metric else None)


def analyze_user_skill_trend(
    db: Session,
    user_id: str,
    skill_area: str,
    limit: int = FULL_HISTORY_LIMIT,
    session_id: str | None = None,
) -> SkillTrendItem:
    """One skill's trend line.

    The limit matches ``analyze_user_progress_trends`` and has to. When this
    defaulted to 100 and that one to the full history, the same skill came back
    "declining" from the all-skills endpoint and "stable" from the single-skill
    endpoint — 85 sessions of evidence against 76 — and the two risk levels
    disagreed on screen as a result.
    """
    normalized_skill = _normalize_skill_area(skill_area)
    if normalized_skill not in TREND_SCORE_FIELDS:
        return SkillTrendItem(
            skill_area=normalized_skill,
            trend_label="insufficient_data",
            session_count=0,
            points=[],
            recommendation=f"No supported score field exists for {normalized_skill}.",
        )

    cutoff_id = _session_cutoff_id(db, user_id, session_id)
    metrics = _query_user_metrics(db, user_id, limit, cutoff_id=cutoff_id)
    session_ids = {m.session_id for m in metrics} if cutoff_id is not None else None
    feedback = _query_user_feedback(db, user_id, limit, session_ids=session_ids)
    return _build_skill_trend(normalized_skill, TREND_SCORE_FIELDS[normalized_skill], metrics, feedback)


def _query_user_metrics(
    db: Session,
    user_id: str,
    limit: int,
    cutoff_id: int | None = None,
) -> list[AnalyticsSessionMetric]:
    query = db.query(AnalyticsSessionMetric).filter(AnalyticsSessionMetric.user_id == user_id)
    if cutoff_id is not None:
        query = query.filter(AnalyticsSessionMetric.id <= cutoff_id)

    # Take the most recent `limit` rows, then put them back in chronological
    # order for the trend line.
    #
    # This previously ordered ascending before applying the limit, which kept the
    # OLDEST rows and silently dropped the newest — so once a learner passed the
    # limit, their latest sessions stopped appearing in trends and predictions
    # altogether, and "latest score" reported a session from weeks earlier.
    rows = (
        query
        .order_by(AnalyticsSessionMetric.id.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(rows))


def _query_user_feedback(
    db: Session,
    user_id: str,
    limit: int,
    session_ids: set[str] | None = None,
) -> list[FeedbackEntry]:
    query = db.query(FeedbackEntry).filter(FeedbackEntry.user_id == user_id)
    if session_ids is not None:
        query = query.filter(FeedbackEntry.session_id.in_(session_ids))

    # Newest first for the limit, then back into chronological order — same
    # reasoning as the metric query above.
    rows = query.order_by(FeedbackEntry.id.desc()).limit(limit).all()
    return list(reversed(rows))


def _session_cutoff_id(
    db: Session,
    user_id: str,
    session_id: str | None,
) -> int | None:
    """Return the analytics_session_metrics.id for the selected session.
    All metrics with id <= this value are included in the trend (session ordering).
    Using id (auto-increment, stable on upsert) instead of created_at avoids the
    bug where feedback re-creation pushes the cutoff timestamp to NOW() for every load.
    """
    if not session_id:
        return None

    metric = (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .filter(AnalyticsSessionMetric.session_id == session_id)
        .order_by(AnalyticsSessionMetric.id.asc())
        .first()
    )
    return metric.id if metric else None


def _build_result(user_id: str, trends: list[SkillTrendItem], cutoff_at: datetime | None = None) -> ProgressTrendResult:
    improving = [item for item in trends if item.trend_label == "improving"]
    stable = [item for item in trends if item.trend_label == "stable"]
    declining = [item for item in trends if item.trend_label == "declining"]
    insufficient = [item for item in trends if item.trend_label == "insufficient_data"]

    return ProgressTrendResult(
        user_id=user_id,
        summary=ProgressTrendSummary(
            analyzed_skill_count=len(trends),
            improving_count=len(improving),
            stable_count=len(stable),
            declining_count=len(declining),
            insufficient_data_count=len(insufficient),
            strongest_improvement=max(improving, key=lambda item: item.delta or 0, default=None),
            strongest_decline=min(declining, key=lambda item: item.delta or 0, default=None),
            cutoff_at=cutoff_at,
        ),
        trends=trends,
        generated_at=datetime.utcnow(),
        trend_version=TREND_VERSION,
    )


def _build_skill_trend(
    skill_area: str,
    field: str,
    metrics: list[AnalyticsSessionMetric],
    feedback: list[FeedbackEntry],
) -> SkillTrendItem:
    points = _points_for_field(metrics, field)
    if len(points) < 1:
        points = _feedback_points_for_skill(feedback, skill_area)
    
    session_count = len(points)

    if session_count < 1:
        return SkillTrendItem(
            skill_area=skill_area,
            trend_label="insufficient_data",
            first_score=None,
            latest_score=None,
            session_count=0,
            points=[],
            recommendation=f"Complete your first session to start tracking {skill_area}.",
        )

    if session_count == 1:
        score = points[0].score
        return SkillTrendItem(
            skill_area=skill_area,
            trend_label="stable",
            first_score=score,
            latest_score=score,
            delta=0.0,
            slope=0.0,
            session_count=1,
            points=points,
            recommendation=f"Baseline established for {skill_area}. Keep going to see your growth!",
        )

    first_score = points[0].score
    latest_score = points[-1].score
    delta = round(latest_score - first_score, 2)
    slope = _linear_slope([point.score for point in points])
    trend_label = _classify_trend(delta, slope)

    return SkillTrendItem(
        skill_area=skill_area,
        trend_label=trend_label,
        first_score=first_score,
        latest_score=latest_score,
        delta=delta,
        slope=slope,
        session_count=session_count,
        points=points,
        recommendation=_recommendation(skill_area, trend_label),
    )


def _points_for_field(
    metrics: list[AnalyticsSessionMetric],
    field: str,
) -> list[ProgressTrendPoint]:
    points_by_session = defaultdict(list)
    created_at_by_session = {}

    for metric in metrics:
        # Composite averages match the frontend radar computation exactly so that
        # Progress History "Latest" and the radar observed score are always the same.
        val = None
        if field == "speech_volume_score":  # vocal_command — single primary
            val = metric.speech_volume_score if metric.speech_volume_score is not None else metric.professionalism_score
        elif field == "speech_pace_score":  # speech_fluency — average pace + clarity
            sub = [v for v in [metric.speech_pace_score, metric.clarity_score] if v is not None]
            val = round(sum(sub) / len(sub), 2) if sub else None
        elif field == "eye_contact_score":  # presence_engagement — average eye_contact + confidence
            sub = [v for v in [metric.eye_contact_score, metric.confidence_score] if v is not None]
            val = round(sum(sub) / len(sub), 2) if sub else None
            if val is None:
                val = metric.adaptability_score
        elif field == "empathy_score":  # emotional_intelligence — average empathy + emotional_control
            sub = [v for v in [metric.empathy_score, metric.emotional_control_score] if v is not None]
            val = round(sum(sub) / len(sub), 2) if sub else None
            if val is None:
                val = metric.listening_score
        else:
            val = getattr(metric, field)

        if val is None:
            continue
        points_by_session[metric.session_id].append(val)
        created_at_by_session.setdefault(metric.session_id, metric.created_at)

    return sorted(
        [
            ProgressTrendPoint(
                session_id=session_id,
                score=round(sum(values) / len(values), 2),
                created_at=created_at_by_session[session_id],
            )
            for session_id, values in points_by_session.items()
        ],
        key=lambda point: point.created_at,
    )


def _feedback_points_for_skill(
    feedback: list[FeedbackEntry],
    skill_area: str,
) -> list[ProgressTrendPoint]:
    points_by_session = defaultdict(list)
    created_at_by_session = {}

    for entry in feedback:
        if entry.rating is None or not entry.session_id:
            continue
        if not _feedback_matches_skill(entry.skill_area, skill_area):
            continue
        points_by_session[entry.session_id].append(entry.rating)
        created_at_by_session.setdefault(entry.session_id, entry.created_at)

    return sorted(
        [
            ProgressTrendPoint(
                session_id=session_id,
                score=round(sum(values) / len(values), 2),
                created_at=created_at_by_session[session_id],
            )
            for session_id, values in points_by_session.items()
        ],
        key=lambda point: point.created_at,
    )


def _feedback_matches_skill(entry_skill: str | None, target_skill: str) -> bool:
    if not entry_skill:
        return False
    normalized_entry_skill = _normalize_skill_area(entry_skill)
    normalized_target_skill = _normalize_skill_area(target_skill)
    if normalized_entry_skill == normalized_target_skill:
        return True
    if normalized_target_skill == "overall" and normalized_entry_skill == "overall":
        return True
    aliases = FEEDBACK_SKILL_ALIASES.get(normalized_target_skill, {normalized_target_skill})
    return normalized_entry_skill in aliases


def _linear_slope(scores: list[float]) -> float:
    n = len(scores)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2
    y_mean = sum(scores) / n
    numerator = sum((index - x_mean) * (score - y_mean) for index, score in enumerate(scores))
    denominator = sum((index - x_mean) ** 2 for index in range(n))
    if denominator == 0:
        return 0.0
    return round(numerator / denominator, 2)


def _classify_trend(delta: float, slope: float) -> str:
    if abs(delta) <= STABLE_DELTA_THRESHOLD and abs(slope) <= STABLE_SLOPE_THRESHOLD:
        return "stable"
    if delta > 0 and slope > 0:
        return "improving"
    if delta < 0 and slope < 0:
        return "declining"
    return "stable"


# The learner reads these, not an instructor. They were written the other way
# round - "assign targeted practice" is an instruction to somebody else about
# them - and they printed the raw column name, so a learner was told
# "vocal_command is declining".
SKILL_LABELS = {
    "vocal_command": "voice",
    "speech_fluency": "fluency",
    "presence_engagement": "presence",
    "emotional_intelligence": "emotional read",
}


def _recommendation(skill_area: str, trend_label: str) -> str:
    label = SKILL_LABELS.get(skill_area, skill_area.replace("_", " "))
    if trend_label == "improving":
        return f"Your {label} is climbing. Whatever you changed, keep doing it."
    if trend_label == "declining":
        return f"Your {label} has been slipping. Worth making it the focus of your next session."
    if trend_label == "stable":
        return f"Your {label} is holding steady. Try a harder scenario to push it up."
    return f"A couple more sessions and we can tell which way your {label} is going."


def _normalize_skill_area(skill_area: str) -> str:
    return skill_area.strip().lower().replace(" ", "_").replace("-", "_")
