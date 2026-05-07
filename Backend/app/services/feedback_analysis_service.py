from collections import defaultdict
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.schemas.analytics import (
    FeedbackAlignmentItem,
    FeedbackAnalysisResult,
    FeedbackAnalysisSummary,
)


ANALYSIS_VERSION = "rule-based-v1"
ALIGNMENT_THRESHOLD = 10.0
MEDIUM_GAP_THRESHOLD = 20.0
HIGH_GAP_THRESHOLD = 30.0


OBSERVED_SCORE_FIELDS = {
    "confidence": "confidence_score",
    "communication_clarity": "clarity_score",
    "clarity": "clarity_score",
    "empathy": "empathy_score",
    "active_listening": "listening_score",
    "listening": "listening_score",
    "adaptability": "adaptability_score",
    "emotional_control": "emotional_control_score",
    "professionalism": "professionalism_score",
    "eye_contact": "eye_contact_score",
    "speech_pace": "speech_pace_score",
    "speech_volume": "speech_volume_score",
    "response_quality": "response_quality_score",
    "overall": "overall_score",
}


def analyze_session_feedback(db: Session, session_id: str) -> FeedbackAnalysisResult:
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
    return _build_result(
        scope="session",
        user_id=user_id,
        session_id=session_id,
        metrics=metrics,
        feedback=feedback,
    )


def analyze_user_feedback(db: Session, user_id: str, limit: int = 100) -> FeedbackAnalysisResult:
    metrics = (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .order_by(AnalyticsSessionMetric.created_at.desc())
        .limit(limit)
        .all()
    )
    feedback = (
        db.query(FeedbackEntry)
        .filter(FeedbackEntry.user_id == user_id)
        .order_by(FeedbackEntry.created_at.desc())
        .limit(limit)
        .all()
    )

    return _build_result(
        scope="user",
        user_id=user_id,
        session_id=None,
        metrics=metrics,
        feedback=feedback,
    )


def _build_result(
    *,
    scope: str,
    user_id: str | None,
    session_id: str | None,
    metrics: list[AnalyticsSessionMetric],
    feedback: list[FeedbackEntry],
) -> FeedbackAnalysisResult:
    observed_scores = _observed_scores(metrics)
    grouped_feedback = _group_feedback_by_skill(feedback)
    skill_areas = sorted(set(observed_scores) | set(grouped_feedback))

    items = [
        _analyze_skill_area(
            skill_area=skill_area,
            observed_score=observed_scores.get(skill_area),
            self_rating=_average(grouped_feedback.get(skill_area, {}).get("self", [])),
            peer_rating=_average(grouped_feedback.get(skill_area, {}).get("peer", [])),
        )
        for skill_area in skill_areas
    ]

    self_ratings = [
        entry.rating
        for entry in feedback
        if entry.feedback_type == "self" and entry.rating is not None
    ]
    peer_ratings = [
        entry.rating
        for entry in feedback
        if entry.feedback_type == "peer" and entry.rating is not None
    ]
    aligned_count = sum(1 for item in items if item.alignment == "aligned")
    blind_spot_count = sum(
        1 for item in items if item.alignment in {"self_overestimation", "self_underestimation"}
    )

    return FeedbackAnalysisResult(
        scope=scope,
        user_id=user_id,
        session_id=session_id,
        summary=FeedbackAnalysisSummary(
            self_feedback_count=len(self_ratings),
            peer_feedback_count=len(peer_ratings),
            analyzed_skill_count=len(items),
            aligned_count=aligned_count,
            blind_spot_count=blind_spot_count,
            average_self_rating=_average(self_ratings),
            average_peer_rating=_average(peer_ratings),
        ),
        items=items,
        generated_at=datetime.utcnow(),
        analysis_version=ANALYSIS_VERSION,
    )


def _analyze_skill_area(
    *,
    skill_area: str,
    observed_score: float | None,
    self_rating: float | None,
    peer_rating: float | None,
) -> FeedbackAlignmentItem:
    self_peer_gap = _gap(self_rating, peer_rating)
    self_observed_gap = _gap(self_rating, observed_score)
    peer_observed_gap = _gap(peer_rating, observed_score)
    gaps = [abs(gap) for gap in [self_peer_gap, self_observed_gap, peer_observed_gap] if gap is not None]

    alignment = _classify_alignment(
        self_rating=self_rating,
        peer_rating=peer_rating,
        observed_score=observed_score,
        self_observed_gap=self_observed_gap,
        self_peer_gap=self_peer_gap,
    )

    return FeedbackAlignmentItem(
        skill_area=skill_area,
        self_rating=self_rating,
        peer_rating=peer_rating,
        observed_score=observed_score,
        self_peer_gap=self_peer_gap,
        self_observed_gap=self_observed_gap,
        peer_observed_gap=peer_observed_gap,
        alignment=alignment,
        severity=_severity(max(gaps) if gaps else None, alignment),
        recommendation=_recommendation(skill_area, alignment),
    )


def _classify_alignment(
    *,
    self_rating: float | None,
    peer_rating: float | None,
    observed_score: float | None,
    self_observed_gap: float | None,
    self_peer_gap: float | None,
) -> str:
    if self_rating is None and peer_rating is None:
        return "insufficient_data"
    if self_observed_gap is not None and abs(self_observed_gap) > ALIGNMENT_THRESHOLD:
        return "self_overestimation" if self_observed_gap > 0 else "self_underestimation"
    if self_peer_gap is not None and abs(self_peer_gap) > ALIGNMENT_THRESHOLD:
        return "self_overestimation" if self_peer_gap > 0 else "self_underestimation"
    if peer_rating is not None and observed_score is not None and abs(peer_rating - observed_score) > ALIGNMENT_THRESHOLD:
        return "peer_misalignment"
    return "aligned"


def _severity(max_gap: float | None, alignment: str) -> str:
    if alignment == "aligned":
        return "none"
    if max_gap is None:
        return "low"
    if max_gap >= HIGH_GAP_THRESHOLD:
        return "high"
    if max_gap >= MEDIUM_GAP_THRESHOLD:
        return "medium"
    return "low"


def _recommendation(skill_area: str, alignment: str) -> str:
    if alignment == "aligned":
        return f"{skill_area} feedback is aligned. Keep reinforcing this behaviour."
    if alignment == "self_overestimation":
        return f"Review {skill_area} examples carefully; your self-rating is higher than external evidence."
    if alignment == "self_underestimation":
        return f"Your {skill_area} performance appears stronger than your self-rating. Build confidence with evidence."
    if alignment == "peer_misalignment":
        return f"External feedback for {skill_area} differs from observed performance. Collect more system evidence."
    return f"Add self ratings and observed performance metrics for {skill_area} to improve feedback analysis."


def _group_feedback_by_skill(feedback: list[FeedbackEntry]) -> dict[str, dict[str, list[float]]]:
    grouped = defaultdict(lambda: defaultdict(list))
    for entry in feedback:
        if entry.rating is None or entry.feedback_type not in {"self", "peer"}:
            continue
        grouped[_normalize_skill_area(entry.skill_area)][entry.feedback_type].append(entry.rating)
    return grouped


def _observed_scores(metrics: list[AnalyticsSessionMetric]) -> dict[str, float]:
    scores = {}
    for skill_area, field in OBSERVED_SCORE_FIELDS.items():
        value = _average([getattr(metric, field) for metric in metrics])
        if value is not None:
            scores[skill_area] = value
    return scores


def _normalize_skill_area(skill_area: str | None) -> str:
    if not skill_area:
        return "overall"
    return skill_area.strip().lower().replace(" ", "_").replace("-", "_")


def _average(values: list[float | None]) -> float | None:
    clean_values = [value for value in values if value is not None]
    if not clean_values:
        return None
    return round(sum(clean_values) / len(clean_values), 2)


def _gap(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return None
    return round(left - right, 2)


def _resolve_user_id(
    metrics: list[AnalyticsSessionMetric],
    feedback: list[FeedbackEntry],
) -> str | None:
    if metrics:
        return metrics[0].user_id
    if feedback:
        return feedback[0].user_id
    return None
