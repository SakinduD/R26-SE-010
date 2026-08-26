"""Whole-history views: what a learner looks like across every session.

Why this is separate from the per-session analytics
---------------------------------------------------
The dashboard has two modes and was answering both with the same panels. Pick a
session and it shows that session's numbers, which is right. Pick "All Sessions"
and it showed lifetime averages in the same layout, under the same labels - and
an average answers a different question from the one those labels ask.

On the development account the skill cards read 88 / 89 / 83 / 77 while the same
screen's prediction panel read 72 / 72 / 70 / 50 for the same four skills. Both
were correct: the first was the mean of 118 sessions, the second was the latest
one. Neither label said which. The learner's recent sessions had fallen in every
skill, and the page reported it as "Great job! Keep it up!".

Two things are built here, and both exist because averaging is the wrong
operation for a history:

``summarise_skill_history``
    Latest, first, best, worst and average together, plus how much the learner
    varies between sessions. Any one of those alone misleads. The latest score is
    a single session and may be a bad day; the average conceals direction; the
    best is encouraging but says nothing about now.

``detect_recurring_blind_spots``
    Counts the sessions in which a self-assessment gap appeared, instead of
    averaging the gaps. This is the difference between a habit and a bad day, and
    averaging cannot express it. On the development account:

        emotional_intelligence   21 of 21 sessions   mean gap +25.4
        vocal_command            21 of 33 sessions   mean gap  -5.1

    The mean says vocal_command is the learner's accurate skill. The count says
    they were wrong about it in two sessions out of three - sometimes high,
    sometimes low, cancelling out to near zero. That inconsistency is a finding.
    The average erases it.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.schemas.analytics import (
    LearnerHistorySummary,
    RecurringBlindSpotItem,
    RecurringBlindSpotResult,
    SkillHistoryItem,
)
from app.services import blind_spot_service, progress_trend_service

HISTORY_VERSION = "learner-history-v1"
RECURRING_VERSION = "recurring-blind-spot-v1"

# Reused rather than redefined: a gap means the same thing here as it does in the
# per-session detector, or the two views would disagree about the same session.
MIN_GAP = blind_spot_service.MIN_BLIND_SPOT_GAP

# A pattern is called consistent when this share of its gaps point the same way.
# Below it, the learner is wrong in both directions and the direction itself is
# not the finding - the unreliability is.
CONSISTENT_DIRECTION_SHARE = 0.70

# How often a gap has to appear before it is a habit rather than an off day.
HABIT_GAP_RATE = 0.50

# Sessions needed before any of this is worth reporting.
MIN_SESSIONS_FOR_PATTERN = 3


def summarise_skill_history(db: Session, user_id: str) -> LearnerHistorySummary:
    trends = progress_trend_service.analyze_user_progress_trends(
        db, user_id, limit=progress_trend_service.FULL_HISTORY_LIMIT
    )

    skills: list[SkillHistoryItem] = []
    first_at: datetime | None = None
    latest_at: datetime | None = None
    session_ids: set[str] = set()

    for trend in trends.trends:
        scores = [point.score for point in trend.points]
        for point in trend.points:
            session_ids.add(point.session_id)
            if first_at is None or point.created_at < first_at:
                first_at = point.created_at
            if latest_at is None or point.created_at > latest_at:
                latest_at = point.created_at

        skills.append(
            SkillHistoryItem(
                skill_area=trend.skill_area,
                latest_score=trend.latest_score,
                first_score=trend.first_score,
                best_score=max(scores) if scores else None,
                worst_score=min(scores) if scores else None,
                average_score=round(statistics.fmean(scores), 2) if scores else None,
                delta=trend.delta,
                trend_label=trend.trend_label,
                session_count=trend.session_count,
                # Standard deviation, not range: one outlier session should not
                # make a steady learner look erratic.
                consistency=(
                    round(statistics.pstdev(scores), 2) if len(scores) > 1 else None
                ),
            )
        )

    ranked = [item for item in skills if item.latest_score is not None]
    return LearnerHistorySummary(
        user_id=user_id,
        session_count=len(session_ids),
        first_session_at=first_at,
        latest_session_at=latest_at,
        skills=skills,
        overall=_overall_history(db, user_id),
        improving_count=sum(1 for item in skills if item.trend_label == "improving"),
        declining_count=sum(1 for item in skills if item.trend_label == "declining"),
        strongest_skill=max(ranked, key=lambda item: item.latest_score, default=None),
        weakest_skill=min(ranked, key=lambda item: item.latest_score, default=None),
        generated_at=datetime.utcnow(),
        history_version=HISTORY_VERSION,
    )


def _overall_history(db: Session, user_id: str) -> SkillHistoryItem | None:
    """The engine's own overall score across every session, in skill shape.

    Read from the stored `overall_score` column rather than averaged out of the
    four composites. Those are two different numbers: the multimodal engine
    weights its dimensions its own way, and across this account's history the two
    disagree on 37 of 99 sessions, by as much as 13.5 points. Showing the mean
    while calling it the session's overall score reports a figure the session
    never produced.

    Built here rather than through progress_trend_service on purpose. That module
    excludes overall by design, because a trend line and a prediction belong to a
    skill and overall is not one. This is the summary view, where it is wanted.
    """
    rows = (
        db.query(AnalyticsSessionMetric.session_id, AnalyticsSessionMetric.overall_score)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .filter(AnalyticsSessionMetric.overall_score.isnot(None))
        .order_by(AnalyticsSessionMetric.created_at.asc(), AnalyticsSessionMetric.id.asc())
        .all()
    )
    # One score per session; a session with more than one row keeps its first.
    by_session: dict[str, float] = {}
    for session_id, score in rows:
        by_session.setdefault(session_id, float(score))
    scores = list(by_session.values())
    if not scores:
        return None

    first_score, latest_score = scores[0], scores[-1]
    delta = round(latest_score - first_score, 2)
    slope = progress_trend_service._linear_slope(scores)
    return SkillHistoryItem(
        skill_area="overall",
        latest_score=latest_score,
        first_score=first_score,
        best_score=max(scores),
        worst_score=min(scores),
        average_score=round(statistics.fmean(scores), 2),
        delta=delta,
        trend_label=(
            "stable" if len(scores) == 1 else progress_trend_service._classify_trend(delta, slope)
        ),
        session_count=len(scores),
        consistency=round(statistics.pstdev(scores), 2) if len(scores) > 1 else None,
    )


def detect_recurring_blind_spots(db: Session, user_id: str) -> RecurringBlindSpotResult:
    observed = _observed_by_skill_and_session(db, user_id)
    self_ratings = _self_ratings_by_skill_and_session(db, user_id)

    items: list[RecurringBlindSpotItem] = []
    for skill_area, ratings in sorted(self_ratings.items()):
        session_scores = observed.get(skill_area, {})
        # Signed: positive means the learner rated themselves above what was
        # measured. The sign is what makes a pattern readable.
        gaps = [
            round(rating - session_scores[session_id], 2)
            for session_id, rating in ratings.items()
            if session_id in session_scores
        ]
        if len(gaps) < MIN_SESSIONS_FOR_PATTERN:
            continue

        item = _build_item(skill_area, gaps)
        if item is not None:
            items.append(item)

    items.sort(key=lambda item: (item.gap_rate, abs(item.mean_signed_gap or 0)), reverse=True)
    flagged = [item for item in items if item.pattern != "aligned"]

    return RecurringBlindSpotResult(
        user_id=user_id,
        minimum_gap=MIN_GAP,
        items=items,
        strongest_pattern=flagged[0] if flagged else None,
        generated_at=datetime.utcnow(),
        detection_version=RECURRING_VERSION,
    )


def _build_item(skill_area: str, gaps: list[float]) -> RecurringBlindSpotItem | None:
    gapped = [gap for gap in gaps if abs(gap) >= MIN_GAP]
    gap_rate = len(gapped) / len(gaps)
    mean_signed = round(statistics.fmean(gaps), 2)

    if not gapped:
        return RecurringBlindSpotItem(
            skill_area=skill_area,
            sessions_rated=len(gaps),
            sessions_with_gap=0,
            gap_rate=0.0,
            pattern="aligned",
            mean_signed_gap=mean_signed,
            typical_gap=None,
            severity="none",
            recommendation=(
                f"Your sense of your own {_label(skill_area)} matches what was "
                "measured, session after session. That is a skill in itself."
            ),
        )

    above = sum(1 for gap in gapped if gap > 0)
    share_above = above / len(gapped)
    if share_above >= CONSISTENT_DIRECTION_SHARE:
        pattern = "consistent_overestimation"
    elif (1 - share_above) >= CONSISTENT_DIRECTION_SHARE:
        pattern = "consistent_underestimation"
    else:
        pattern = "inconsistent"

    # The size of a typical gap, ignoring direction. For an inconsistent pattern
    # this is the only honest magnitude: the signed mean cancels to near zero
    # while the learner is being wrong by a lot in both directions.
    typical = round(statistics.median(abs(gap) for gap in gapped), 2)

    return RecurringBlindSpotItem(
        skill_area=skill_area,
        sessions_rated=len(gaps),
        sessions_with_gap=len(gapped),
        gap_rate=round(gap_rate, 2),
        pattern=pattern,
        mean_signed_gap=mean_signed,
        typical_gap=typical,
        severity=_severity(gap_rate, typical),
        recommendation=_recommendation(skill_area, pattern, len(gapped), len(gaps), typical),
    )


def _severity(gap_rate: float, typical_gap: float) -> str:
    """How often it happens, weighed with how far off it is.

    A large gap that appeared once is an off day. A modest gap in every session
    is the thing worth working on, so frequency carries at least as much weight
    as size.
    """
    if gap_rate >= HABIT_GAP_RATE and typical_gap >= blind_spot_service.HIGH_BLIND_SPOT_GAP:
        return "high"
    if gap_rate >= HABIT_GAP_RATE and typical_gap >= blind_spot_service.MEDIUM_BLIND_SPOT_GAP:
        return "medium"
    if gap_rate >= HABIT_GAP_RATE:
        return "low"
    return "low" if typical_gap >= blind_spot_service.HIGH_BLIND_SPOT_GAP else "none"


def _recommendation(
    skill_area: str, pattern: str, gapped: int, rated: int, typical: float
) -> str:
    label = _label(skill_area)
    frequency = f"{gapped} of your {rated} rated sessions"

    if pattern == "consistent_overestimation":
        return (
            f"In {frequency} you rated your {label} about {typical:.0f} points above "
            "what was measured, and almost always in that direction. This is a "
            "habit rather than an off day - worth watching a recording before "
            "rating yourself next time."
        )
    if pattern == "consistent_underestimation":
        return (
            f"In {frequency} you rated your {label} about {typical:.0f} points below "
            "what was measured, and almost always in that direction. You are "
            "harder on yourself here than the evidence supports."
        )
    return (
        f"In {frequency} your {label} rating was about {typical:.0f} points away from "
        "what was measured - sometimes high, sometimes low. Averaged out these "
        "cancel and look like accuracy, but you cannot yet predict this skill in "
        "yourself, which is its own thing to work on."
    )


def _label(skill_area: str) -> str:
    return blind_spot_service.SKILL_LABELS.get(skill_area, skill_area.replace("_", " "))


def _observed_by_skill_and_session(
    db: Session, user_id: str
) -> dict[str, dict[str, float]]:
    """Measured score per skill per session.

    Read from the trend service rather than recomputed, so the composite formula
    for each skill exists in exactly one place.
    """
    trends = progress_trend_service.analyze_user_progress_trends(
        db, user_id, limit=progress_trend_service.FULL_HISTORY_LIMIT
    )
    return {
        trend.skill_area: {point.session_id: point.score for point in trend.points}
        for trend in trends.trends
    }


def _self_ratings_by_skill_and_session(
    db: Session, user_id: str
) -> dict[str, dict[str, float]]:
    rows = (
        db.query(FeedbackEntry)
        .filter(
            FeedbackEntry.user_id == user_id,
            FeedbackEntry.feedback_type == "self",
            FeedbackEntry.rating.isnot(None),
            FeedbackEntry.session_id.isnot(None),
        )
        .order_by(FeedbackEntry.id.asc())
        .all()
    )

    ratings: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        skill = progress_trend_service._normalize_skill_area(row.skill_area or "")
        if skill in progress_trend_service.TREND_SCORE_FIELDS:
            ratings[skill][row.session_id].append(float(row.rating))

    # A learner can rate the same skill twice in one session; that is one opinion
    # about that session, not two, so it is averaged before any counting starts.
    return {
        skill: {
            session_id: round(statistics.fmean(values), 2)
            for session_id, values in sessions.items()
        }
        for skill, sessions in ratings.items()
    }
