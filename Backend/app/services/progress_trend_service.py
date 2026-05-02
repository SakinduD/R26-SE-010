from collections import defaultdict
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric
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
    "confidence": "confidence_score",
    "communication_clarity": "clarity_score",
    "empathy": "empathy_score",
    "active_listening": "listening_score",
    "adaptability": "adaptability_score",
    "emotional_control": "emotional_control_score",
    "professionalism": "professionalism_score",
    "eye_contact": "eye_contact_score",
    "speech_pace": "speech_pace_score",
    "speech_volume": "speech_volume_score",
    "response_quality": "response_quality_score",
    "overall": "overall_score",
}


def analyze_user_progress_trends(
    db: Session,
    user_id: str,
    limit: int = 100,
) -> ProgressTrendResult:
    metrics = _query_user_metrics(db, user_id, limit)
    trends = [_build_skill_trend(skill_area, field, metrics) for skill_area, field in TREND_SCORE_FIELDS.items()]
    return _build_result(user_id=user_id, trends=trends)


def analyze_user_skill_trend(
    db: Session,
    user_id: str,
    skill_area: str,
    limit: int = 100,
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

    metrics = _query_user_metrics(db, user_id, limit)
    return _build_skill_trend(normalized_skill, TREND_SCORE_FIELDS[normalized_skill], metrics)


def _query_user_metrics(
    db: Session,
    user_id: str,
    limit: int,
) -> list[AnalyticsSessionMetric]:
    return (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .order_by(AnalyticsSessionMetric.created_at.asc(), AnalyticsSessionMetric.id.asc())
        .limit(limit)
        .all()
    )


def _build_result(user_id: str, trends: list[SkillTrendItem]) -> ProgressTrendResult:
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
        ),
        trends=trends,
        generated_at=datetime.utcnow(),
        trend_version=TREND_VERSION,
    )


def _build_skill_trend(
    skill_area: str,
    field: str,
    metrics: list[AnalyticsSessionMetric],
) -> SkillTrendItem:
    points = _points_for_field(metrics, field)
    session_count = len(points)

    if session_count < 2:
        return SkillTrendItem(
            skill_area=skill_area,
            trend_label="insufficient_data",
            first_score=points[0].score if points else None,
            latest_score=points[-1].score if points else None,
            session_count=session_count,
            points=points,
            recommendation=f"Collect at least two sessions to analyze {skill_area} progress.",
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
        value = getattr(metric, field)
        if value is None:
            continue
        points_by_session[metric.session_id].append(value)
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


def _linear_slope(scores: list[float]) -> float:
    n = len(scores)
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
