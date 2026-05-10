from datetime import datetime

from sqlalchemy.orm import Session

from app.schemas.analytics import (
    BlindSpotDetectionResult,
    BlindSpotItem,
    BlindSpotSummary,
    FeedbackAlignmentItem,
)
from app.services import feedback_analysis_service


DETECTION_VERSION = "rule-based-v1"
MIN_BLIND_SPOT_GAP = 10.0
MEDIUM_BLIND_SPOT_GAP = 20.0
HIGH_BLIND_SPOT_GAP = 30.0

SKILL_LABELS = {
    "vocal_command": "Vocal Command",
    "speech_fluency": "Speech Fluency",
    "presence_engagement": "Presence & Engagement",
    "emotional_intelligence": "Emotional Intelligence",
    "overall": "Overall",
}


def _label(skill_area: str) -> str:
    return SKILL_LABELS.get(skill_area, skill_area.replace("_", " ").title())


def detect_session_blind_spots(db: Session, session_id: str) -> BlindSpotDetectionResult:
    analysis = feedback_analysis_service.analyze_session_feedback(db, session_id)
    return _build_result(
        scope="session",
        user_id=analysis.user_id,
        session_id=session_id,
        items=analysis.items,
    )


def detect_user_blind_spots(
    db: Session,
    user_id: str,
    limit: int = 100,
) -> BlindSpotDetectionResult:
    analysis = feedback_analysis_service.analyze_user_feedback(db, user_id, limit)
    return _build_result(
        scope="user",
        user_id=user_id,
        session_id=None,
        items=analysis.items,
    )


def _build_result(
    *,
    scope: str,
    user_id: str | None,
    session_id: str | None,
    items: list[FeedbackAlignmentItem],
) -> BlindSpotDetectionResult:
    blind_spots = sorted(
        [
            blind_spot
            for item in items
            if (blind_spot := _blind_spot_from_alignment(item)) is not None
        ],
        key=lambda item: (item.gap, item.confidence),
        reverse=True,
    )

    return BlindSpotDetectionResult(
        scope=scope,
        user_id=user_id,
        session_id=session_id,
        summary=_summarize(blind_spots),
        blind_spots=blind_spots,
        generated_at=datetime.utcnow(),
        detection_version=DETECTION_VERSION,
    )


def _blind_spot_from_alignment(item: FeedbackAlignmentItem) -> BlindSpotItem | None:
    if item.alignment not in {"self_overestimation", "self_underestimation"}:
        return None

    comparison_score, comparison_source, signed_gap = _best_comparison(item)
    if item.self_rating is None or comparison_score is None or signed_gap is None:
        return None

    gap = abs(signed_gap)
    if gap <= MIN_BLIND_SPOT_GAP:
        return None

    blind_spot_type = "overestimation" if signed_gap > 0 else "underestimation"
    severity = _severity(gap)

    return BlindSpotItem(
        skill_area=item.skill_area,
        blind_spot_type=blind_spot_type,
        severity=severity,
        self_rating=item.self_rating,
        comparison_score=comparison_score,
        comparison_source=comparison_source,
        gap=round(gap, 2),
        confidence=_confidence(gap, comparison_source),
        recommendation=_recommendation(item.skill_area, blind_spot_type, severity, comparison_source),
    )


def _best_comparison(
    item: FeedbackAlignmentItem,
) -> tuple[float | None, str, float | None]:
    if item.self_observed_gap is not None and item.observed_score is not None:
        return item.observed_score, "observed", item.self_observed_gap
    return item.peer_rating, "peer", item.self_peer_gap


def _summarize(blind_spots: list[BlindSpotItem]) -> BlindSpotSummary:
    return BlindSpotSummary(
        total_count=len(blind_spots),
        high_count=sum(1 for item in blind_spots if item.severity == "high"),
        medium_count=sum(1 for item in blind_spots if item.severity == "medium"),
        low_count=sum(1 for item in blind_spots if item.severity == "low"),
        strongest_blind_spot=blind_spots[0] if blind_spots else None,
    )


def _severity(gap: float) -> str:
    if gap >= HIGH_BLIND_SPOT_GAP:
        return "high"
    if gap >= MEDIUM_BLIND_SPOT_GAP:
        return "medium"
    return "low"


def _confidence(gap: float, comparison_source: str) -> float:
    source_bonus = 0.1 if comparison_source == "observed" else 0.0
    return round(min(1.0, 0.45 + (gap / 100) + source_bonus), 2)


def _recommendation(
    skill_area: str,
    blind_spot_type: str,
    severity: str,
    comparison_source: str,
) -> str:
    label = _label(skill_area)
    source_label = "observed performance" if comparison_source == "observed" else "external feedback"
    if blind_spot_type == "overestimation":
        return (
            f"Your self-rating for {label} is higher than {source_label}. "
            "Review evidence from the session and set one measurable improvement target."
        )
    return (
        f"Your self-rating for {label} is lower than {source_label}. "
        "Use the positive evidence to build confidence and maintain this behaviour."
    )
