"""Gamified progress tracking for the Feedback System & Predictive Analytics module.

Specific Objective 6 — motivate continuous soft-skill development with visible
progress indicators: XP, levels, learning streaks and achievement badges.

Design notes
------------
Every number here is *derived* from data the analytics module already stores
(``analytics_session_metrics`` and ``feedback_entries``). The two gamification
tables are a cache: deleting them and re-running :func:`sync_user_gamification`
reproduces the exact same state.

The whole profile is recomputed from the learner's complete history on every
sync rather than accumulated incrementally. That costs one extra pass over a few
dozen rows and buys four properties that matter:

* **Idempotent** — syncing twice can never inflate XP.
* **Order independent** — a backdated session that arrives late still produces
  the correct streaks, because streaks are derived from the full set of learning
  days rather than folded in one session at a time.
* **Concurrency safe** — two syncs racing converge on the same value instead of
  double-awarding.
* **Auditable** — the stored numbers always equal what an independent replay of
  the raw rows produces, which is what makes a badge defensible.

Calendar days are bucketed in the learner's local timezone (``app_timezone``),
not UTC. Timestamps are stored in UTC; only the day boundary is localised. In
Asia/Colombo (UTC+5:30) a session at 00:30 local is 19:00 UTC the previous day,
so bucketing on UTC would silently break streaks for anyone training at night.

All rules are deterministic and rule-based — no LLM is involved — so an award can
be reproduced and defended.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.analytics import (
    AnalyticsSessionMetric,
    FeedbackEntry,
    UserBadge,
    UserGamificationProfile,
)
from app.schemas.analytics import (
    GamificationBadgeItem,
    GamificationBadgeSummary,
    GamificationLevelProgress,
    GamificationProfileResult,
    GamificationRules,
    GamificationSkillLevel,
    GamificationStreak,
    GamificationSyncResult,
    GamificationXpAward,
)
from app.services import blind_spot_service, progress_trend_service


logger = logging.getLogger(__name__)

RULES_VERSION = "gamification-rules-v1"

# --- XP earned per completed session -----------------------------------------
# session_xp = BASE + round(overall_score * PERFORMANCE_FACTOR) + streak bonus
# Range: 10 XP (showed up, no score) .. 44 XP (perfect score on a 7-day streak).
BASE_SESSION_XP = 10
PERFORMANCE_XP_FACTOR = 0.20
STREAK_XP_PER_DAY = 2
MAX_STREAK_BONUS_DAYS = 7

# --- Overall level curve ------------------------------------------------------
# XP needed to go from level n to n+1 = LEVEL_BASE_XP + (n - 1) * LEVEL_GROWTH_XP
# L1->L2 = 100, L2->L3 = 150, L3->L4 = 200 ... each level costs a little more.
LEVEL_BASE_XP = 100
LEVEL_GROWTH_XP = 50

# --- Per-skill level curve (cheaper, so individual skills visibly move) -------
SKILL_LEVEL_BASE_XP = 50
SKILL_LEVEL_GROWTH_XP = 25
SKILL_BASE_XP = 5
SKILL_PERFORMANCE_XP_FACTOR = 0.15

MAX_LEVEL = 99

# The learner's full history is replayed on every sync, so the trend engine has
# to hand back every session rather than its default recent window.
FULL_HISTORY_LIMIT = 10_000

SKILL_LABELS = {
    "vocal_command": "Vocal Command",
    "speech_fluency": "Speech Fluency",
    "presence_engagement": "Presence & Engagement",
    "emotional_intelligence": "Emotional Intelligence",
}


# =============================================================================
# Calendar days in the learner's timezone
# =============================================================================

@lru_cache(maxsize=4)
def _zone(name: str) -> ZoneInfo | timezone:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("Unknown app_timezone %r — falling back to UTC for day bucketing", name)
        return timezone.utc


def _local_zone():
    return _zone(get_settings().app_timezone)


def local_day(moment: datetime) -> date:
    """Bucket a stored (UTC) timestamp into the learner's local calendar day."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(_local_zone()).date()


def today_local() -> date:
    return datetime.now(timezone.utc).astimezone(_local_zone()).date()


# =============================================================================
# Level maths
# =============================================================================

def xp_cost_of_level(level: int, base: int, growth: int) -> int:
    """XP required to advance *from* ``level`` to ``level + 1``."""
    return base + max(0, level - 1) * growth


def resolve_level(total_xp: int, base: int, growth: int) -> tuple[int, int, int]:
    """Return ``(level, xp_into_current_level, xp_cost_of_current_level)``."""
    level = 1
    remaining = max(0, int(total_xp))

    while level < MAX_LEVEL:
        cost = xp_cost_of_level(level, base, growth)
        if remaining < cost:
            return level, remaining, cost
        remaining -= cost
        level += 1

    return MAX_LEVEL, 0, xp_cost_of_level(MAX_LEVEL, base, growth)


def _level_progress(total_xp: int) -> GamificationLevelProgress:
    level, into_level, cost = resolve_level(total_xp, LEVEL_BASE_XP, LEVEL_GROWTH_XP)
    return GamificationLevelProgress(
        level=level,
        total_xp=int(total_xp),
        xp_into_level=into_level,
        xp_for_next_level=cost,
        xp_to_next_level=max(0, cost - into_level),
        progress_percent=round(min(100.0, (into_level / cost) * 100), 2) if cost else 100.0,
    )


def _rules() -> GamificationRules:
    """The XP formula, published so the UI cannot drift from the engine."""
    return GamificationRules(
        base_session_xp=BASE_SESSION_XP,
        performance_xp_factor=PERFORMANCE_XP_FACTOR,
        max_performance_xp=round(100 * PERFORMANCE_XP_FACTOR),
        streak_xp_per_day=STREAK_XP_PER_DAY,
        max_streak_bonus_days=MAX_STREAK_BONUS_DAYS,
        max_streak_bonus_xp=STREAK_XP_PER_DAY * MAX_STREAK_BONUS_DAYS,
        level_base_xp=LEVEL_BASE_XP,
        level_growth_xp=LEVEL_GROWTH_XP,
        timezone=get_settings().app_timezone,
    )


# =============================================================================
# Badge rules
# =============================================================================

@dataclass(frozen=True)
class BadgeContext:
    """Everything a badge rule is allowed to look at."""

    session_count: int
    current_streak: int
    longest_streak: int
    total_learning_days: int
    level: int
    self_feedback_count: int
    # None means the blind-spot analysis could not be computed. Rules must treat
    # that as "unknown", never as "clean" — a badge is not awarded on a guess.
    high_blind_spot_count: int | None
    improving_skill_count: int
    # skill_area -> chronological list of that skill's session scores
    skill_series: dict[str, list[float]]


@dataclass(frozen=True)
class BadgeRule:
    key: str
    title: str
    description: str
    criteria: str
    tier: str
    evaluate: Callable[[BadgeContext], tuple[bool, float, str]]
    skill_area: str | None = None


def _ratio(current: float, target: float) -> float:
    if target <= 0:
        return 1.0
    return max(0.0, min(1.0, current / target))


def _threshold_rule(value_of: Callable[[BadgeContext], int], target: int, noun: str):
    """Simple 'reach N of something' rule."""

    def evaluate(ctx: BadgeContext) -> tuple[bool, float, str]:
        current = value_of(ctx)
        return current >= target, _ratio(current, target), f"{min(current, target)} / {target} {noun}"

    return evaluate


def _best_consecutive_run(scores: list[float], threshold: float) -> int:
    """Longest run of consecutive sessions scoring at or above ``threshold``."""
    best = 0
    run = 0
    for score in scores:
        if score is not None and score >= threshold:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best


def _consecutive_skill_rule(skill_area: str, threshold: float, sessions: int):
    """'Score >= threshold in N consecutive sessions' — the Fig. 12 style rule."""

    def evaluate(ctx: BadgeContext) -> tuple[bool, float, str]:
        best = _best_consecutive_run(ctx.skill_series.get(skill_area, []), threshold)
        hint = f"best run {min(best, sessions)} / {sessions} sessions at {int(threshold)}+"
        return best >= sessions, _ratio(best, sessions), hint

    return evaluate


def _self_aware_rule(ctx: BadgeContext) -> tuple[bool, float, str]:
    """Self-assessment submitted and no high-severity blind spot left."""
    if ctx.self_feedback_count < 1:
        return False, 0.0, "submit a self-assessment first"
    if ctx.high_blind_spot_count is None:
        # Fail closed: an unavailable analysis is not evidence of being clean.
        return False, 0.5, "blind spot analysis unavailable — try again later"
    if ctx.high_blind_spot_count > 0:
        return False, 0.5, f"{ctx.high_blind_spot_count} high-severity blind spot(s) to close"
    return True, 1.0, "no high-severity blind spots"


BADGE_RULES: tuple[BadgeRule, ...] = (
    BadgeRule(
        key="first_steps",
        title="First Steps",
        description="Completed your first training session.",
        criteria="Complete 1 training session",
        tier="bronze",
        evaluate=_threshold_rule(lambda ctx: ctx.session_count, 1, "sessions"),
    ),
    BadgeRule(
        key="consistent_learner",
        title="Consistent Learner",
        description="Trained three days in a row.",
        criteria="Reach a 3-day learning streak",
        tier="bronze",
        evaluate=_threshold_rule(lambda ctx: ctx.longest_streak, 3, "days"),
    ),
    BadgeRule(
        key="week_warrior",
        title="Week Warrior",
        description="Trained every day for a full week.",
        criteria="Reach a 7-day learning streak",
        tier="silver",
        evaluate=_threshold_rule(lambda ctx: ctx.longest_streak, 7, "days"),
    ),
    BadgeRule(
        key="reflective_practitioner",
        title="Reflective Practitioner",
        description="Consistently reflects on your own performance.",
        criteria="Submit 5 self-assessments",
        tier="bronze",
        evaluate=_threshold_rule(lambda ctx: ctx.self_feedback_count, 5, "self-assessments"),
    ),
    BadgeRule(
        key="communication_pro",
        title="Communication Pro",
        description="Sustained clear, well-paced delivery.",
        criteria="Speech Fluency 80+ in 3 consecutive sessions",
        tier="gold",
        skill_area="speech_fluency",
        evaluate=_consecutive_skill_rule("speech_fluency", 80.0, 3),
    ),
    BadgeRule(
        key="vocal_command_master",
        title="Vocal Command",
        description="Held a strong, steady voice across sessions.",
        criteria="Vocal Command 80+ in 3 consecutive sessions",
        tier="gold",
        skill_area="vocal_command",
        evaluate=_consecutive_skill_rule("vocal_command", 80.0, 3),
    ),
    BadgeRule(
        key="confident_presence",
        title="Confident Presence",
        description="Maintained strong presence and engagement.",
        criteria="Presence & Engagement 80+ in 3 consecutive sessions",
        tier="gold",
        skill_area="presence_engagement",
        evaluate=_consecutive_skill_rule("presence_engagement", 80.0, 3),
    ),
    BadgeRule(
        key="active_listener",
        title="Active Listener",
        description="Read the room and responded with empathy.",
        criteria="Emotional Intelligence 75+ in 3 consecutive sessions",
        tier="silver",
        skill_area="emotional_intelligence",
        evaluate=_consecutive_skill_rule("emotional_intelligence", 75.0, 3),
    ),
    BadgeRule(
        key="self_aware",
        title="Self Aware",
        description="Your self-perception matches your observed performance.",
        criteria="Submit a self-assessment with no high-severity blind spots",
        tier="silver",
        evaluate=_self_aware_rule,
    ),
    BadgeRule(
        key="growth_mindset",
        title="Growth Mindset",
        description="Two or more skills are trending upward.",
        criteria="Have 2 skills labelled 'improving'",
        tier="silver",
        evaluate=_threshold_rule(lambda ctx: ctx.improving_skill_count, 2, "improving skills"),
    ),
    BadgeRule(
        key="milestone_achiever",
        title="Milestone Achiever",
        description="Reached level 5 on your soft-skill journey.",
        criteria="Reach overall level 5",
        tier="silver",
        evaluate=_threshold_rule(lambda ctx: ctx.level, 5, "levels"),
    ),
    BadgeRule(
        key="consistency_champion",
        title="Consistency Champion",
        description="Ten sessions of sustained practice.",
        criteria="Complete 10 training sessions",
        tier="gold",
        evaluate=_threshold_rule(lambda ctx: ctx.session_count, 10, "sessions"),
    ),
)

BADGE_RULES_BY_KEY = {rule.key: rule for rule in BADGE_RULES}


# =============================================================================
# Reading the learner's history
# =============================================================================

@dataclass(frozen=True)
class SessionSummary:
    session_id: str
    occurred_at: datetime
    day: date
    overall_score: float | None


def _session_summaries(db: Session, user_id: str) -> list[SessionSummary]:
    """One entry per distinct session, oldest first.

    A session can produce several metric rows (one per component that reports in),
    so they are collapsed: earliest timestamp wins, scores are averaged. No row
    limit — XP must reflect the learner's entire history.
    """
    metrics = (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .order_by(AnalyticsSessionMetric.created_at.asc())
        .all()
    )

    first_seen: dict[str, datetime] = {}
    scores: dict[str, list[float]] = defaultdict(list)

    for metric in metrics:
        session_id = metric.session_id
        if session_id not in first_seen:
            first_seen[session_id] = metric.created_at
        if metric.overall_score is not None:
            scores[session_id].append(metric.overall_score)

    summaries = [
        SessionSummary(
            session_id=session_id,
            occurred_at=occurred_at,
            day=local_day(occurred_at),
            overall_score=(
                round(sum(scores[session_id]) / len(scores[session_id]), 2)
                if scores.get(session_id)
                else None
            ),
        )
        for session_id, occurred_at in first_seen.items()
    ]
    summaries.sort(key=lambda item: (item.occurred_at, item.session_id))
    return summaries


def _skill_series(
    db: Session, user_id: str
) -> tuple[dict[str, list[float]], dict[str, dict[str, float]], int]:
    """Per-skill score history, reusing the trend engine so numbers always agree.

    Returns ``(series, score_by_skill_and_session, improving_skill_count)``.
    """
    trends = progress_trend_service.analyze_user_progress_trends(
        db, user_id, limit=FULL_HISTORY_LIMIT
    )

    series: dict[str, list[float]] = {}
    by_session: dict[str, dict[str, float]] = {}
    improving = 0

    for trend in trends.trends:
        points = [point for point in (trend.points or []) if point.score is not None]
        series[trend.skill_area] = [point.score for point in points]
        by_session[trend.skill_area] = {point.session_id: point.score for point in points}
        if trend.trend_label == "improving":
            improving += 1

    return series, by_session, improving


def _self_feedback_count(db: Session, user_id: str) -> int:
    return (
        db.query(FeedbackEntry)
        .filter(
            FeedbackEntry.user_id == user_id,
            FeedbackEntry.feedback_type == "self",
        )
        .count()
    )


def _high_blind_spot_count(db: Session, user_id: str) -> int | None:
    """High-severity blind spots, or None when the analysis could not be run.

    Returning None rather than 0 matters: the Self Aware badge is awarded for
    having *no* high-severity blind spots, so a failure that looked like 0 would
    hand out the badge on no evidence at all.
    """
    try:
        return blind_spot_service.detect_user_blind_spots(db, user_id).summary.high_count
    except Exception:
        logger.exception("Blind spot analysis failed for user %s — treating as unknown", user_id)
        return None


# =============================================================================
# Derived state — pure functions of the history
# =============================================================================

def _streak_by_day(days: set[date]) -> dict[date, int]:
    """Length of the consecutive-day run ending on each learning day.

    Deriving this from the complete day set (rather than folding one session in
    at a time) is what makes a late-arriving backdated session produce the right
    answer.
    """
    result: dict[date, int] = {}
    run = 0
    previous: date | None = None

    for day in sorted(days):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        result[day] = run
        previous = day

    return result


def _session_xp(overall_score: float | None, streak_on_that_day: int) -> tuple[int, int, int]:
    """``(base, performance, streak_bonus)`` for one session."""
    performance = (
        int(round(overall_score * PERFORMANCE_XP_FACTOR)) if overall_score is not None else 0
    )
    bonus = min(streak_on_that_day, MAX_STREAK_BONUS_DAYS) * STREAK_XP_PER_DAY
    return BASE_SESSION_XP, performance, bonus


@dataclass(frozen=True)
class ComputedProgress:
    total_xp: int
    level: int
    session_count: int
    learning_days: set[date]
    streak_by_day: dict[date, int]
    current_streak: int
    longest_streak: int
    last_activity_day: date | None
    skill_xp: dict[str, int]
    awards: list[GamificationXpAward]


def compute_progress(
    sessions: list[SessionSummary],
    skill_by_session: dict[str, dict[str, float]],
) -> ComputedProgress:
    """Recompute the learner's entire gamification state from their history.

    Pure — same inputs always give the same outputs, in any order.
    """
    days = {session.day for session in sessions}
    streak_by_day = _streak_by_day(days)

    total_xp = 0
    awards: list[GamificationXpAward] = []

    for session in sessions:
        base, performance, bonus = _session_xp(session.overall_score, streak_by_day[session.day])
        total_xp += base + performance + bonus
        awards.append(
            GamificationXpAward(
                session_id=session.session_id,
                base_xp=base,
                performance_xp=performance,
                streak_bonus_xp=bonus,
                total_xp_awarded=base + performance + bonus,
                overall_score=session.overall_score,
            )
        )

    scored_session_ids = {session.session_id for session in sessions}
    skill_xp: dict[str, int] = {}
    for skill_area, per_session in skill_by_session.items():
        earned = 0
        for session_id, score in per_session.items():
            if session_id not in scored_session_ids or score is None:
                continue
            earned += SKILL_BASE_XP + int(round(score * SKILL_PERFORMANCE_XP_FACTOR))
        skill_xp[skill_area] = earned

    last_day = max(days) if days else None
    return ComputedProgress(
        total_xp=total_xp,
        level=resolve_level(total_xp, LEVEL_BASE_XP, LEVEL_GROWTH_XP)[0],
        session_count=len(sessions),
        learning_days=days,
        streak_by_day=streak_by_day,
        current_streak=streak_by_day[last_day] if last_day else 0,
        longest_streak=max(streak_by_day.values()) if streak_by_day else 0,
        last_activity_day=last_day,
        skill_xp=skill_xp,
        awards=awards,
    )


# =============================================================================
# Badge evaluation
# =============================================================================

def _evaluate_badges(
    db: Session,
    user_id: str,
    context: BadgeContext,
    persist: bool,
) -> tuple[list[GamificationBadgeItem], list[GamificationBadgeItem]]:
    """Return ``(all_badges, newly_earned)``.

    With ``persist`` false nothing is written and a badge is only reported as
    earned if it is already recorded — a read must never claim an award that
    does not exist yet.
    """
    existing = {
        badge.badge_key: badge
        for badge in db.query(UserBadge).filter(UserBadge.user_id == user_id).all()
    }

    items: list[GamificationBadgeItem] = []
    newly_earned: list[GamificationBadgeItem] = []

    for rule in BADGE_RULES:
        already = existing.get(rule.key)
        if already is not None:
            items.append(
                _badge_item(rule, earned=True, earned_at=already.earned_at, progress=1.0, hint=None)
            )
            continue

        qualifies, progress, hint = rule.evaluate(context)

        if qualifies and persist:
            record = UserBadge(
                user_id=user_id,
                badge_key=rule.key,
                badge_tier=rule.tier,
                skill_area=rule.skill_area,
                criteria=rule.criteria,
                evidence={"hint": hint, "rules_version": RULES_VERSION},
                rules_version=RULES_VERSION,
            )
            db.add(record)
            db.flush()
            item = _badge_item(rule, earned=True, earned_at=record.earned_at, progress=1.0, hint=None)
            items.append(item)
            newly_earned.append(item)
            continue

        items.append(
            _badge_item(
                rule,
                earned=False,
                earned_at=None,
                progress=1.0 if qualifies else progress,
                hint="unlocks on your next sync" if qualifies else hint,
            )
        )

    return items, newly_earned


def _badge_item(
    rule: BadgeRule,
    *,
    earned: bool,
    earned_at: datetime | None,
    progress: float,
    hint: str | None,
) -> GamificationBadgeItem:
    return GamificationBadgeItem(
        badge_key=rule.key,
        title=rule.title,
        description=rule.description,
        criteria=rule.criteria,
        tier=rule.tier,
        skill_area=rule.skill_area,
        earned=earned,
        earned_at=earned_at,
        progress_percent=round(max(0.0, min(1.0, progress)) * 100, 2),
        progress_hint=None if earned else hint,
    )


# =============================================================================
# Result assembly
# =============================================================================

def _week_activity(learning_days: set[date], today: date) -> list[bool]:
    """Mon..Sun flags for the current local calendar week."""
    monday = today - timedelta(days=today.weekday())
    return [(monday + timedelta(days=offset)) in learning_days for offset in range(7)]


def _build_streak(progress: ComputedProgress, today: date) -> GamificationStreak:
    last = progress.last_activity_day
    # A streak only survives if the learner trained today or yesterday.
    broken = last is None or (today - last) > timedelta(days=1)
    return GamificationStreak(
        current_streak=0 if broken else progress.current_streak,
        longest_streak=progress.longest_streak,
        total_learning_days=len(progress.learning_days),
        last_activity_date=last,
        active_today=last == today,
        week_activity=_week_activity(progress.learning_days, today),
    )


def _build_skill_levels(
    skill_xp: dict[str, int],
    skill_series: dict[str, list[float]],
) -> list[GamificationSkillLevel]:
    levels = []

    for skill_area, label in SKILL_LABELS.items():
        xp = int(skill_xp.get(skill_area, 0))
        level, into_level, cost = resolve_level(xp, SKILL_LEVEL_BASE_XP, SKILL_LEVEL_GROWTH_XP)
        scores = skill_series.get(skill_area) or []
        levels.append(
            GamificationSkillLevel(
                skill_area=skill_area,
                label=label,
                xp=xp,
                level=level,
                latest_score=scores[-1] if scores else None,
                progress_percent=round(min(100.0, (into_level / cost) * 100), 2) if cost else 100.0,
                xp_to_next_level=max(0, cost - into_level),
            )
        )

    return levels


def _build_context(
    db: Session,
    user_id: str,
    progress: ComputedProgress,
    skill_series: dict[str, list[float]],
    improving_skill_count: int,
    today: date,
) -> BadgeContext:
    streak = _build_streak(progress, today)
    return BadgeContext(
        session_count=progress.session_count,
        current_streak=streak.current_streak,
        longest_streak=progress.longest_streak,
        total_learning_days=len(progress.learning_days),
        level=progress.level,
        self_feedback_count=_self_feedback_count(db, user_id),
        high_blind_spot_count=_high_blind_spot_count(db, user_id),
        improving_skill_count=improving_skill_count,
        skill_series=skill_series,
    )


def _build_profile_result(
    user_id: str,
    progress: ComputedProgress,
    skill_series: dict[str, list[float]],
    badges: list[GamificationBadgeItem],
    today: date,
) -> GamificationProfileResult:
    earned = [badge for badge in badges if badge.earned]
    latest = max(
        (badge for badge in earned if badge.earned_at is not None),
        key=lambda badge: badge.earned_at,
        default=None,
    )

    return GamificationProfileResult(
        user_id=user_id,
        level_progress=_level_progress(progress.total_xp),
        streak=_build_streak(progress, today),
        session_count=progress.session_count,
        skill_levels=_build_skill_levels(progress.skill_xp, skill_series),
        badges=badges,
        badge_summary=GamificationBadgeSummary(
            earned_count=len(earned),
            total_count=len(BADGE_RULES),
            latest_badge=latest,
        ),
        rules=_rules(),
        generated_at=datetime.utcnow(),
        rules_version=RULES_VERSION,
    )


def _load_progress(db: Session, user_id: str):
    """Shared read path: history in, fully derived progress out."""
    sessions = _session_summaries(db, user_id)
    skill_series, skill_by_session, improving = _skill_series(db, user_id)
    progress = compute_progress(sessions, skill_by_session)
    return progress, skill_series, improving


# =============================================================================
# Public API
# =============================================================================

def get_user_gamification(db: Session, user_id: str) -> GamificationProfileResult:
    """Read the learner's current gamification state. No writes."""
    progress, skill_series, improving = _load_progress(db, user_id)
    today = today_local()
    context = _build_context(db, user_id, progress, skill_series, improving, today)
    badges, _ = _evaluate_badges(db, user_id, context, persist=False)
    return _build_profile_result(user_id, progress, skill_series, badges, today)


def sync_user_gamification(db: Session, user_id: str) -> GamificationSyncResult:
    """Recompute the profile from the learner's full history and persist it.

    Idempotent by construction: the stored values are a pure function of the
    recorded sessions, so repeating this — or racing two of them — converges on
    the same numbers rather than accumulating.
    """
    progress, skill_series, improving = _load_progress(db, user_id)
    today = today_local()

    profile = (
        db.query(UserGamificationProfile)
        .filter(UserGamificationProfile.user_id == user_id)
        .one_or_none()
    )
    if profile is None:
        profile = UserGamificationProfile(user_id=user_id)
        db.add(profile)

    previously_scored = set(profile.scored_session_ids or [])
    all_session_ids = [award.session_id for award in progress.awards]
    new_awards = [award for award in progress.awards if award.session_id not in previously_scored]

    streak = _build_streak(progress, today)
    profile.total_xp = progress.total_xp
    profile.level = progress.level
    profile.session_count = progress.session_count
    profile.current_streak = streak.current_streak
    profile.longest_streak = progress.longest_streak
    profile.total_learning_days = len(progress.learning_days)
    profile.last_activity_date = progress.last_activity_day
    profile.skill_xp = dict(progress.skill_xp)
    profile.scored_session_ids = all_session_ids
    profile.rules_version = RULES_VERSION

    context = _build_context(db, user_id, progress, skill_series, improving, today)
    badges, newly_earned = _evaluate_badges(db, user_id, context, persist=True)

    db.commit()

    return GamificationSyncResult(
        user_id=user_id,
        profile=_build_profile_result(user_id, progress, skill_series, badges, today),
        awards=new_awards,
        newly_earned_badges=newly_earned,
        xp_gained=sum(award.total_xp_awarded for award in new_awards),
    )
