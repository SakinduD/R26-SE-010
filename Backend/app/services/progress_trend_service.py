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
STABLE_DELTA_THRESHOLD = 5.0
STABLE_SLOPE_THRESHOLD = 2.0


TREND_SCORE_FIELDS = {
    "vocal_command": "speech_volume_score",
    "speech_fluency": "speech_pace_score",
    "presence_engagement": "eye_contact_score",
    "emotional_intelligence": "empathy_score",
    "overall": "overall_score",
}

FEEDBACK_SKILL_ALIASES = {
    "communication_clarity": {"communication_clarity", "clarity"},
    "active_listening": {"active_listening", "listening"},
}


def analyze_user_progress_trends(
    db: Session, user_id: str, session_id: str | None = None
) -> ProgressTrendResult:
    print(f"--- ANALYZE TRENDS: user={user_id} session={session_id} ---")
    cutoff_at = _session_cutoff_at(db, user_id, session_id)
    print(f"--- CUTOFF CALCULATED: {cutoff_at} ---")
    
    metrics = _query_user_metrics(db, user_id, limit=100, cutoff_at=cutoff_at)
    feedback = _query_user_feedback(db, user_id, limit=100, cutoff_at=cutoff_at)
    print(f"--- DATA FOUND: metrics={len(metrics)} feedback={len(feedback)} ---")
    trends = [
        _build_skill_trend(skill_area, field, metrics, feedback)
        for skill_area, field in TREND_SCORE_FIELDS.items()
    ]
    return _build_result(user_id=user_id, trends=trends, cutoff_at=cutoff_at)


def analyze_user_skill_trend(
    db: Session,
    user_id: str,
    skill_area: str,
    limit: int = 100,
    session_id: str | None = None,
) -> SkillTrendItem:
    normalized_skill = _normalize_skill_area(skill_area)
    if normalized_skill not in TREND_SCORE_FIELDS:
        return SkillTrendItem(
            skill_area=normalized_skill,
            trend_label="insufficient_data",
            session_count=0,
            points=[],
            recommendation=f"No supported score field exists for {normalized_skill}.",
        )

    cutoff_at = _session_cutoff_at(db, user_id, session_id)
    metrics = _query_user_metrics(db, user_id, limit, cutoff_at)
    feedback = _query_user_feedback(db, user_id, limit, cutoff_at)
    return _build_skill_trend(normalized_skill, TREND_SCORE_FIELDS[normalized_skill], metrics, feedback)


def _query_user_metrics(
    db: Session,
    user_id: str,
    limit: int,
    cutoff_at: datetime | None = None,
) -> list[AnalyticsSessionMetric]:
    query = db.query(AnalyticsSessionMetric).filter(AnalyticsSessionMetric.user_id == user_id)
    if cutoff_at is not None:
        query = query.filter(AnalyticsSessionMetric.created_at <= cutoff_at)

    return (
        query
        .order_by(AnalyticsSessionMetric.created_at.asc(), AnalyticsSessionMetric.id.asc())
        .limit(limit)
        .all()
    )


def _query_user_feedback(
    db: Session,
    user_id: str,
    limit: int,
    cutoff_at: datetime | None = None,
) -> list[FeedbackEntry]:
    query = db.query(FeedbackEntry).filter(FeedbackEntry.user_id == user_id)
    if cutoff_at is not None:
        query = query.filter(FeedbackEntry.created_at <= cutoff_at)

    return query.order_by(FeedbackEntry.created_at.asc(), FeedbackEntry.id.asc()).limit(limit).all()


def _session_cutoff_at(
    db: Session,
    user_id: str,
    session_id: str | None,
) -> datetime | None:
    if not session_id:
        return None

    print(f"DEBUG: Calculating cutoff for user={user_id} session={session_id}")
    metric = (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .filter(AnalyticsSessionMetric.session_id == session_id)
        .order_by(AnalyticsSessionMetric.created_at.desc(), AnalyticsSessionMetric.id.desc())
        .first()
    )
    feedback = (
        db.query(FeedbackEntry)
        .filter(FeedbackEntry.user_id == user_id)
        .filter(FeedbackEntry.session_id == session_id)
        .order_by(FeedbackEntry.created_at.desc(), FeedbackEntry.id.desc())
        .first()
    )
    
    timestamps = []
    if metric and metric.created_at: 
        timestamps.append(metric.created_at)
        print(f"DEBUG: Found metric at {metric.created_at}")
    if feedback and feedback.created_at: 
        timestamps.append(feedback.created_at)
        print(f"DEBUG: Found feedback at {feedback.created_at}")
        
    res = max(timestamps) if timestamps else None
    print(f"DEBUG: Resulting cutoff_at={res}")
    return res


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
        # Priority mapping for MCA skills to ensure consistency with frontend
        val = None
        if field == "speech_volume_score": # vocal_command
            val = metric.speech_volume_score if metric.speech_volume_score is not None else metric.professionalism_score
        elif field == "speech_pace_score": # speech_fluency
            val = metric.speech_pace_score if metric.speech_pace_score is not None else metric.clarity_score
        elif field == "eye_contact_score": # presence_engagement
            val = metric.eye_contact_score if metric.eye_contact_score is not None else (metric.confidence_score if metric.confidence_score is not None else metric.adaptability_score)
        elif field == "empathy_score": # emotional_intelligence
            val = metric.empathy_score if metric.empathy_score is not None else (metric.emotional_control_score if metric.emotional_control_score is not None else metric.listening_score)
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


def _recommendation(skill_area: str, trend_label: str) -> str:
    if trend_label == "improving":
        return f"{skill_area} is improving. Continue the current practice pattern."
    if trend_label == "declining":
        return f"{skill_area} is declining. Review recent sessions and assign targeted practice."
    if trend_label == "stable":
        return f"{skill_area} is stable. Add a stretch goal to create measurable growth."
    return f"More session data is needed to identify a reliable {skill_area} trend."


def _normalize_skill_area(skill_area: str) -> str:
    return skill_area.strip().lower().replace(" ", "_").replace("-", "_")
