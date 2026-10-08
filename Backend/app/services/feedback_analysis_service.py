from collections import defaultdict
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.schemas.analytics import (
    FeedbackAlignmentItem,
    FeedbackAnalysisResult,
    FeedbackAnalysisSummary,
)

# A learner-wide analysis summarises their whole history, so this cap must never
# quietly act as a page size. At 100 it did: on the development account it read
# 100 of 392 feedback entries and reported the result as the learner's overall
# picture. Same reasoning as FULL_HISTORY_LIMIT in data_aggregation_service.
FULL_HISTORY_LIMIT = 10_000


ANALYSIS_VERSION = "rule-based-v1"
ALIGNMENT_THRESHOLD = 10.0
MEDIUM_GAP_THRESHOLD = 20.0
HIGH_GAP_THRESHOLD = 30.0


# Observed scores are compared against the learner's self-rating per skill.
# "Overall" is
# a summary (the mean of the four skills), not a skill, so it is excluded here —
# otherwise every session would surface an extra "Overall" alignment row and
# inflate the analyzed-skill count.
OBSERVED_SCORE_FIELDS: dict[str, list[str]] = {
    "vocal_command": ["speech_volume_score"],
    "speech_fluency": ["speech_pace_score", "clarity_score"],
    "presence_engagement": ["eye_contact_score", "confidence_score"],
    "emotional_intelligence": ["empathy_score", "emotional_control_score"],
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


def analyze_user_feedback(
    db: Session, user_id: str, limit: int = FULL_HISTORY_LIMIT
) -> FeedbackAnalysisResult:
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
        )
        for skill_area in skill_areas
    ]

    self_entries = [
        entry
        for entry in feedback
        if entry.feedback_type == "self" and entry.rating is not None
    ]
    self_ratings = [entry.rating for entry in self_entries]

    # A self-assessment is stored as one row per skill, so the row count answers
    # a different question in each scope - and the two screens reading this ask
    # different questions of it.
    #
    # Across a history: how many times did they sit down and rate themselves.
    # 42 assessments are 230 rows, and "Times you rated yourself" read 230.
    #
    # Within one session: how many skills did they rate. Not the row count
    # either, because a resubmitted form leaves several rows for the same skill -
    # one session here holds eighteen rows covering three skills.
    self_feedback_count = (
        len({_normalize_skill_area(entry.skill_area) for entry in self_entries})
        if scope == "session"
        else len({entry.session_id for entry in self_entries if entry.session_id})
    )

    aligned_count = sum(1 for item in items if item.alignment == "aligned")
    blind_spot_count = sum(
        1 for item in items if item.alignment in {"self_overestimation", "self_underestimation"}
    )

    # Only the skills where a comparison actually happened. A skill the session
    # measured but the learner never rated has nothing to be close to, and
    # counting it produced two visible contradictions on one screen: "Skills
    # checked 4" beside "Spot on 0" and "Gaps 3", and a measured average taken
    # over four skills sitting next to a self average taken over three.
    #
    # Both averages now cover the same skills, which is the only way the two
    # numbers beside each other can be subtracted. The session's own overall
    # score, over everything it measured, is on the dashboard.
    compared = [item for item in items if item.alignment != "insufficient_data"]
    observed_scores_list = [
        item.observed_score for item in compared if item.observed_score is not None
    ]

    return FeedbackAnalysisResult(
        scope=scope,
        user_id=user_id,
        session_id=session_id,
        summary=FeedbackAnalysisSummary(
            self_feedback_count=self_feedback_count,
            analyzed_skill_count=len(compared),
            aligned_count=aligned_count,
            blind_spot_count=blind_spot_count,
            # Averaged per skill, not per row, so that it is the same operation
            # as the observed average printed beside it. Those two numbers exist
            # to be compared, and a mean over rows is weighted by how often each
            # skill happened to be rated - this learner rated presence 65 times
            # and vocal command 38 - while the observed side gives each skill one
            # vote. Comparing them was comparing two different weightings.
            average_self_rating=_average(
                [item.self_rating for item in compared if item.self_rating is not None]
            ),
            average_observed_score=_average(observed_scores_list),
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
) -> FeedbackAlignmentItem:
    """Compare what the learner claims against what the session measured.

    Peer review was removed from the platform, so self-rating versus observed
    score is the only comparison available — and the only one this codebase
    should imply it can make.
    """
    self_observed_gap = _gap(self_rating, observed_score)

    alignment = _classify_alignment(
        self_rating=self_rating,
        observed_score=observed_score,
        self_observed_gap=self_observed_gap,
    )

    return FeedbackAlignmentItem(
        skill_area=skill_area,
        self_rating=self_rating,
        observed_score=observed_score,
        self_observed_gap=self_observed_gap,
        alignment=alignment,
        severity=_severity(abs(self_observed_gap) if self_observed_gap is not None else None, alignment),
        recommendation=_recommendation(skill_area, alignment),
    )


def _classify_alignment(
    *,
    self_rating: float | None,
    observed_score: float | None,
    self_observed_gap: float | None,
) -> str:
    if self_rating is None:
        return "insufficient_data"
    if self_observed_gap is not None and abs(self_observed_gap) > ALIGNMENT_THRESHOLD:
        return "self_overestimation" if self_observed_gap > 0 else "self_underestimation"
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
    return f"Add a self rating and observed performance metrics for {skill_area} to improve feedback analysis."


def _group_feedback_by_skill(feedback: list[FeedbackEntry]) -> dict[str, dict[str, list[float]]]:
    """One rating per skill per session, most recent kept.

    The form can be submitted more than once for the same session, and the rows
    accumulate rather than replace: this account holds 29 (session, skill) pairs
    with two or more rows, one of them six deep. Averaging all of them does two
    wrong things at once. A rating the learner changed stays in the average -
    presence on one session reads 75, 70, 70, 70, 70, and the 75 they corrected
    still counts - and a session that happened to be submitted six times carries
    six times the weight of one submitted once. Correcting both moves this
    account's presence figure by 2.45 points.

    Callers pass entries newest first, so the first one seen for a pair is the
    one that stands. An entry with no session id cannot be paired with anything
    and is kept as its own.
    """
    grouped = defaultdict(lambda: defaultdict(list))
    seen: set[tuple] = set()
    for entry in feedback:
        if entry.rating is None or entry.feedback_type != "self":
            continue
        skill_area = _normalize_skill_area(entry.skill_area)
        key = (entry.session_id, skill_area) if entry.session_id else ("", entry.id)
        if key in seen:
            continue
        seen.add(key)
        grouped[skill_area][entry.feedback_type].append(entry.rating)
    return grouped


def _observed_scores(metrics: list[AnalyticsSessionMetric]) -> dict[str, float]:
    scores = {}
    for skill_area, fields in OBSERVED_SCORE_FIELDS.items():
        all_values = [
            getattr(metric, field)
            for metric in metrics
            for field in fields
            if getattr(metric, field) is not None
        ]
        value = _average(all_values)
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
