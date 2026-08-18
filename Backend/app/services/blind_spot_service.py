from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics import FeedbackEntry
from app.schemas.analytics import (
    BlindSpotDetectionResult,
    BlindSpotItem,
    BlindSpotSummary,
    FeedbackAlignmentItem,
    SentimentBlindSpotItem,
)
from app.services import feedback_analysis_service


DETECTION_VERSION = "rule-based-v1"
MIN_BLIND_SPOT_GAP = 10.0
MEDIUM_BLIND_SPOT_GAP = 20.0
HIGH_BLIND_SPOT_GAP = 30.0

# A sentiment gap is only reported when the model was reasonably sure of its
# reading. The classifier is trained on general-domain text, so on workplace
# wording it sometimes lands near a coin toss - telling a learner they have a
# blind spot on the strength of a 0.51 prediction would be inventing a finding.
MIN_SENTIMENT_CONFIDENCE = 0.60

# Opposite poles disagree more than either does with "neutral".
_OPPOSITE_POLES = {frozenset({"positive", "negative"})}

COMMENT_EXCERPT_LENGTH = 160

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
        sentiment_gaps=_detect_sentiment_gaps(db, session_id=session_id),
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
        sentiment_gaps=_detect_sentiment_gaps(db, user_id=user_id, limit=limit),
    )


def _detect_sentiment_gaps(
    db: Session,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    limit: int = 100,
) -> list[SentimentBlindSpotItem]:
    """Where the learner's stated sentiment disagrees with their own wording.

    Only entries the NLP model actually judged are considered - a rule-derived
    label carries no independent reading to disagree with.
    """
    query = db.query(FeedbackEntry).filter(
        FeedbackEntry.sentiment_source == "model",
        FeedbackEntry.declared_sentiment.isnot(None),
        FeedbackEntry.sentiment.isnot(None),
    )
    if session_id is not None:
        query = query.filter(FeedbackEntry.session_id == session_id)
    if user_id is not None:
        query = query.filter(FeedbackEntry.user_id == user_id)

    entries = query.order_by(FeedbackEntry.created_at.desc()).limit(limit).all()

    gaps = [
        gap
        for entry in entries
        if (gap := _sentiment_gap_from_entry(entry)) is not None
    ]
    gaps.sort(key=lambda item: (item.severity == "high", item.confidence), reverse=True)
    return gaps


def _sentiment_gap_from_entry(entry: FeedbackEntry) -> SentimentBlindSpotItem | None:
    if entry.sentiment == entry.declared_sentiment:
        return None

    confidence = entry.sentiment_confidence or 0.0
    if confidence < MIN_SENTIMENT_CONFIDENCE:
        return None

    severity = (
        "high"
        if frozenset({entry.sentiment, entry.declared_sentiment}) in _OPPOSITE_POLES
        else "medium"
    )
    comment = (entry.comment or "").strip()
    excerpt = comment[:COMMENT_EXCERPT_LENGTH]
    if len(comment) > COMMENT_EXCERPT_LENGTH:
        excerpt += "..."

    return SentimentBlindSpotItem(
        session_id=entry.session_id,
        declared_sentiment=entry.declared_sentiment,
        detected_sentiment=entry.sentiment,
        severity=severity,
        confidence=round(confidence, 2),
        comment_excerpt=excerpt,
        model_version=entry.sentiment_model_version,
        recommendation=_sentiment_recommendation(
            entry.declared_sentiment, entry.sentiment, severity
        ),
        created_at=entry.created_at,
    )


def _sentiment_recommendation(declared: str, detected: str, severity: str) -> str:
    if declared == "positive" and detected == "negative":
        return (
            "You rated the session positively, but your own description reads as "
            "negative. Re-read what you wrote - the difficulty you described may "
            "be worth working on."
        )
    if declared == "negative" and detected == "positive":
        return (
            "You rated the session negatively, but your description reads as "
            "positive. You may be judging yourself more harshly than your own "
            "account supports."
        )
    if severity == "high":
        return (
            "Your rating and your written reflection point in opposite "
            "directions. Review both."
        )
    return (
        f"You marked the session {declared} while the wording reads as "
        f"{detected}. A small gap, but worth noticing."
    )


def _build_result(
    *,
    scope: str,
    user_id: str | None,
    session_id: str | None,
    items: list[FeedbackAlignmentItem],
    sentiment_gaps: list[SentimentBlindSpotItem] | None = None,
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
        summary=_summarize(blind_spots, sentiment_gaps or []),
        blind_spots=blind_spots,
        sentiment_gaps=sentiment_gaps or [],
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
    """What the learner's self-rating is measured against.

    Observed session performance is the only comparison the platform has: peer
    review was removed, so there is no second human opinion to fall back on.
    """
    if item.self_observed_gap is not None and item.observed_score is not None:
        return item.observed_score, "observed", item.self_observed_gap
    return None, "observed", None


def _summarize(
    blind_spots: list[BlindSpotItem],
    sentiment_gaps: list[SentimentBlindSpotItem],
) -> BlindSpotSummary:
    return BlindSpotSummary(
        total_count=len(blind_spots),
        high_count=sum(1 for item in blind_spots if item.severity == "high"),
        medium_count=sum(1 for item in blind_spots if item.severity == "medium"),
        low_count=sum(1 for item in blind_spots if item.severity == "low"),
        strongest_blind_spot=blind_spots[0] if blind_spots else None,
        sentiment_gap_count=len(sentiment_gaps),
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
