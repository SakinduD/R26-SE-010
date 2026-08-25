import random
from datetime import date, datetime, timedelta

import pytest

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry, UserBadge
from app.services import blind_spot_service, gamification_service


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _add_session(
    db,
    user_id,
    session_id,
    *,
    days_ago=0,
    overall=None,
    speech_pace=None,
    clarity=None,
    volume=None,
    eye_contact=None,
    confidence=None,
    empathy=None,
    emotional_control=None,
):
    metric = AnalyticsSessionMetric(
        user_id=user_id,
        session_id=session_id,
        overall_score=overall,
        speech_pace_score=speech_pace,
        clarity_score=clarity,
        speech_volume_score=volume,
        eye_contact_score=eye_contact,
        confidence_score=confidence,
        empathy_score=empathy,
        emotional_control_score=emotional_control,
        created_at=datetime.utcnow() - timedelta(days=days_ago),
    )
    db.add(metric)
    db.commit()
    return metric


def _badge(result, key):
    return next(item for item in result.badges if item.badge_key == key)


# ---------------------------------------------------------------------------
# level maths
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "total_xp,expected_level,expected_into_level",
    [
        (0, 1, 0),
        (99, 1, 99),
        (100, 2, 0),      # L1->L2 costs 100
        (249, 2, 149),    # L2->L3 costs 150
        (250, 3, 0),
        (450, 4, 0),      # +200 for L3->L4
    ],
)
def test_resolve_level_follows_the_documented_curve(total_xp, expected_level, expected_into_level):
    level, into_level, _cost = gamification_service.resolve_level(
        total_xp, gamification_service.LEVEL_BASE_XP, gamification_service.LEVEL_GROWTH_XP
    )
    assert level == expected_level
    assert into_level == expected_into_level


def test_resolve_level_is_capped():
    level, _, _ = gamification_service.resolve_level(
        10_000_000, gamification_service.LEVEL_BASE_XP, gamification_service.LEVEL_GROWTH_XP
    )
    assert level == gamification_service.MAX_LEVEL


def test_best_consecutive_run_counts_only_unbroken_streaks():
    assert gamification_service._best_consecutive_run([70, 82, 85, 88, 60], 80.0) == 3
    assert gamification_service._best_consecutive_run([85, 60, 85, 85], 80.0) == 2
    assert gamification_service._best_consecutive_run([], 80.0) == 0


# ---------------------------------------------------------------------------
# XP awarding
# ---------------------------------------------------------------------------

def test_sync_awards_base_plus_performance_xp(db_session):
    user_id = "gam-xp-user"
    _add_session(db_session, user_id, "gam-xp-s1", overall=80)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    # base 10 + round(80 * 0.20) = 16 + streak bonus (1 day * 2) = 2  -> 28
    assert result.xp_gained == 28
    assert len(result.awards) == 1
    award = result.awards[0]
    assert award.base_xp == 10
    assert award.performance_xp == 16
    assert award.streak_bonus_xp == 2
    assert result.profile.level_progress.total_xp == 28
    assert result.profile.session_count == 1


def test_sync_is_idempotent(db_session):
    user_id = "gam-idempotent-user"
    _add_session(db_session, user_id, "gam-idem-s1", overall=70)

    first = gamification_service.sync_user_gamification(db_session, user_id)
    second = gamification_service.sync_user_gamification(db_session, user_id)

    assert first.xp_gained > 0
    assert second.xp_gained == 0
    assert second.awards == []
    assert second.profile.level_progress.total_xp == first.profile.level_progress.total_xp
    assert second.profile.session_count == 1


def test_session_without_overall_score_still_earns_participation_xp(db_session):
    user_id = "gam-noscore-user"
    _add_session(db_session, user_id, "gam-noscore-s1", confidence=55)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert result.awards[0].performance_xp == 0
    assert result.awards[0].base_xp == gamification_service.BASE_SESSION_XP


# ---------------------------------------------------------------------------
# streaks
# ---------------------------------------------------------------------------

def test_consecutive_days_build_a_streak(db_session):
    user_id = "gam-streak-user"
    _add_session(db_session, user_id, "gam-streak-s1", days_ago=2, overall=60)
    _add_session(db_session, user_id, "gam-streak-s2", days_ago=1, overall=60)
    _add_session(db_session, user_id, "gam-streak-s3", days_ago=0, overall=60)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert result.profile.streak.current_streak == 3
    assert result.profile.streak.longest_streak == 3
    assert result.profile.streak.total_learning_days == 3
    assert result.profile.streak.active_today is True


def test_gap_in_days_resets_the_current_streak_but_keeps_the_record(db_session):
    user_id = "gam-streak-reset-user"
    _add_session(db_session, user_id, "gam-reset-s1", days_ago=10, overall=60)
    _add_session(db_session, user_id, "gam-reset-s2", days_ago=9, overall=60)
    _add_session(db_session, user_id, "gam-reset-s3", days_ago=0, overall=60)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert result.profile.streak.current_streak == 1
    assert result.profile.streak.longest_streak == 2
    assert result.profile.streak.total_learning_days == 3


def test_stale_streak_is_reported_as_broken(db_session):
    user_id = "gam-stale-user"
    _add_session(db_session, user_id, "gam-stale-s1", days_ago=6, overall=60)
    _add_session(db_session, user_id, "gam-stale-s2", days_ago=5, overall=60)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    # Two consecutive days were earned, but the last one was days ago — the
    # learner's *current* streak is over even though the record stands.
    assert result.profile.streak.longest_streak == 2
    assert result.profile.streak.current_streak == 0
    assert result.profile.streak.active_today is False


def test_two_sessions_on_the_same_day_count_as_one_learning_day(db_session):
    user_id = "gam-sameday-user"
    _add_session(db_session, user_id, "gam-sameday-s1", days_ago=0, overall=60)
    _add_session(db_session, user_id, "gam-sameday-s2", days_ago=0, overall=60)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert result.profile.session_count == 2
    assert result.profile.streak.total_learning_days == 1
    assert result.profile.streak.current_streak == 1


# ---------------------------------------------------------------------------
# badges
# ---------------------------------------------------------------------------

def test_first_steps_badge_unlocks_on_first_session(db_session):
    user_id = "gam-badge-first-user"
    _add_session(db_session, user_id, "gam-badge-first-s1", overall=50)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert _badge(result.profile, "first_steps").earned is True
    assert "first_steps" in {badge.badge_key for badge in result.newly_earned_badges}


def test_badge_is_only_awarded_once(db_session):
    user_id = "gam-badge-once-user"
    _add_session(db_session, user_id, "gam-badge-once-s1", overall=50)

    gamification_service.sync_user_gamification(db_session, user_id)
    second = gamification_service.sync_user_gamification(db_session, user_id)

    assert second.newly_earned_badges == []
    rows = (
        db_session.query(UserBadge)
        .filter(UserBadge.user_id == user_id, UserBadge.badge_key == "first_steps")
        .count()
    )
    assert rows == 1


def test_communication_pro_needs_three_consecutive_qualifying_sessions(db_session):
    user_id = "gam-comm-pro-user"
    # speech_fluency = mean(speech_pace, clarity); two strong sessions is not enough.
    _add_session(db_session, user_id, "gam-comm-s1", days_ago=2, overall=85, speech_pace=86, clarity=86)
    _add_session(db_session, user_id, "gam-comm-s2", days_ago=1, overall=85, speech_pace=86, clarity=86)

    partial = gamification_service.sync_user_gamification(db_session, user_id)
    assert _badge(partial.profile, "communication_pro").earned is False
    assert _badge(partial.profile, "communication_pro").progress_percent == pytest.approx(66.67, abs=0.1)

    _add_session(db_session, user_id, "gam-comm-s3", days_ago=0, overall=85, speech_pace=86, clarity=86)
    complete = gamification_service.sync_user_gamification(db_session, user_id)

    assert _badge(complete.profile, "communication_pro").earned is True


def test_a_low_session_breaks_the_consecutive_badge_run(db_session):
    user_id = "gam-comm-break-user"
    _add_session(db_session, user_id, "gam-break-s1", days_ago=3, overall=85, speech_pace=86, clarity=86)
    _add_session(db_session, user_id, "gam-break-s2", days_ago=2, overall=40, speech_pace=40, clarity=40)
    _add_session(db_session, user_id, "gam-break-s3", days_ago=1, overall=85, speech_pace=86, clarity=86)
    _add_session(db_session, user_id, "gam-break-s4", days_ago=0, overall=85, speech_pace=86, clarity=86)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert _badge(result.profile, "communication_pro").earned is False


def test_reflective_practitioner_counts_self_assessments(db_session):
    user_id = "gam-reflective-user"
    _add_session(db_session, user_id, "gam-reflective-s1", overall=60)
    for index in range(5):
        db_session.add(
            FeedbackEntry(
                user_id=user_id,
                session_id="gam-reflective-s1",
                feedback_type="self",
                skill_area="communication_clarity",
                rating=70,
            )
        )
    db_session.commit()

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert _badge(result.profile, "reflective_practitioner").earned is True


def test_locked_badges_report_progress_and_a_hint(db_session):
    user_id = "gam-progress-user"
    _add_session(db_session, user_id, "gam-progress-s1", overall=60)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    champion = _badge(result.profile, "consistency_champion")
    assert champion.earned is False
    assert champion.progress_percent == 10.0  # 1 of 10 sessions
    assert champion.progress_hint == "1 / 10 sessions"
    assert champion.criteria == "Complete 10 training sessions"


def test_every_badge_exposes_its_criteria(db_session):
    result = gamification_service.get_user_gamification(db_session, "gam-empty-user")

    assert len(result.badges) == len(gamification_service.BADGE_RULES)
    assert all(badge.criteria for badge in result.badges)
    assert result.badge_summary.total_count == len(gamification_service.BADGE_RULES)


# ---------------------------------------------------------------------------
# skill levels
# ---------------------------------------------------------------------------

def test_skill_xp_accumulates_per_skill(db_session):
    user_id = "gam-skill-user"
    _add_session(db_session, user_id, "gam-skill-s1", overall=80, speech_pace=80, clarity=80, volume=90)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    by_area = {level.skill_area: level for level in result.profile.skill_levels}
    # speech_fluency = 80 -> 5 + round(80 * 0.15) = 17
    assert by_area["speech_fluency"].xp == 17
    # vocal_command = 90 -> 5 + round(90 * 0.15) = 19
    assert by_area["vocal_command"].xp == 19
    # no empathy/emotional_control reported, so nothing earned there
    assert by_area["emotional_intelligence"].xp == 0
    assert by_area["emotional_intelligence"].level == 1


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def test_get_gamification_endpoint_returns_empty_profile_for_new_user(client):
    response = client.get("/api/v1/analytics/users/gam-api-new/gamification")

    assert response.status_code == 200
    body = response.json()
    assert body["level_progress"]["level"] == 1
    assert body["level_progress"]["total_xp"] == 0
    assert body["session_count"] == 0
    assert body["badge_summary"]["earned_count"] == 0
    assert len(body["skill_levels"]) == 4


def test_get_gamification_endpoint_does_not_write(client, db_session):
    client.get("/api/v1/analytics/users/gam-api-readonly/gamification")

    assert (
        db_session.query(UserBadge).filter(UserBadge.user_id == "gam-api-readonly").count() == 0
    )


def test_sync_endpoint_awards_xp(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={"user_id": "gam-api-sync", "session_id": "gam-api-sync-s1", "overall_score": 90},
    )

    response = client.post("/api/v1/analytics/users/gam-api-sync/gamification/sync")

    assert response.status_code == 200
    body = response.json()
    assert body["xp_gained"] > 0
    assert body["profile"]["session_count"] == 1
    assert "first_steps" in {badge["badge_key"] for badge in body["newly_earned_badges"]}


def test_session_integration_awards_gamification_automatically(client):
    payload = {
        "user_id": "gam-integration-user",
        "session_id": "gam-integration-s1",
        "mca_overall_score": 75,
    }

    integration = client.post("/api/v1/analytics/integrations/session-complete", json=payload)
    assert integration.status_code == 201

    gamification = client.get("/api/v1/analytics/users/gam-integration-user/gamification")
    assert gamification.status_code == 200
    assert gamification.json()["session_count"] == 1
    assert gamification.json()["level_progress"]["total_xp"] > 0


# ---------------------------------------------------------------------------
# calendar days use the learner's local timezone, not UTC
# ---------------------------------------------------------------------------

def _add_session_at(db, user_id, session_id, when, **scores):
    metric = AnalyticsSessionMetric(
        user_id=user_id, session_id=session_id, created_at=when, **scores
    )
    db.add(metric)
    db.commit()
    return metric


def test_a_stored_utc_timestamp_is_bucketed_into_the_local_day():
    # Asia/Colombo is UTC+5:30, so 20:00 UTC is already 01:30 the next morning.
    assert gamification_service.local_day(datetime(2026, 3, 1, 20, 0)) == date(2026, 3, 2)
    assert gamification_service.local_day(datetime(2026, 3, 1, 6, 0)) == date(2026, 3, 1)


def test_two_late_night_sessions_on_one_local_day_count_as_one_learning_day(db_session):
    """Guards the timezone fix.

    20:00 and next-morning 06:00 UTC fall on two different UTC days but the same
    Colombo day, so this must be one learning day with a streak of 1. Bucketing
    on UTC would report two days and a streak of 2.
    """
    user_id = "gam-tz-user"
    _add_session_at(db_session, user_id, "gam-tz-s1", datetime(2026, 3, 1, 20, 0), overall_score=60)
    _add_session_at(db_session, user_id, "gam-tz-s2", datetime(2026, 3, 2, 6, 0), overall_score=60)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    assert result.profile.streak.total_learning_days == 1
    assert result.profile.streak.longest_streak == 1
    assert result.profile.session_count == 2


# ---------------------------------------------------------------------------
# recompute: order independence and backdated sessions
# ---------------------------------------------------------------------------

def test_compute_progress_is_independent_of_input_order():
    sessions = [
        gamification_service.SessionSummary(f"s{i}", datetime(2026, 3, i, 9, 0),
                                            date(2026, 3, i), 70.0)
        for i in range(1, 6)
    ]
    expected = gamification_service.compute_progress(sessions, {})

    shuffled = sessions[:]
    random.Random(7).shuffle(shuffled)
    actual = gamification_service.compute_progress(shuffled, {})

    assert actual.total_xp == expected.total_xp
    assert actual.longest_streak == expected.longest_streak
    assert actual.learning_days == expected.learning_days


def test_a_backdated_session_repairs_the_streak(db_session):
    """A session that arrives late but happened earlier must be folded in properly.

    Days 1 and 3 alone are not a streak. When the day-2 session shows up
    afterwards the three days become a run of 3 — an incremental counter would
    have missed this entirely.
    """
    user_id = "gam-backdate-user"
    _add_session_at(db_session, user_id, "gam-bd-s1", datetime(2026, 4, 1, 9, 0), overall_score=60)
    _add_session_at(db_session, user_id, "gam-bd-s3", datetime(2026, 4, 3, 9, 0), overall_score=60)

    before = gamification_service.sync_user_gamification(db_session, user_id)
    assert before.profile.streak.longest_streak == 1

    # the missing middle day is integrated afterwards
    _add_session_at(db_session, user_id, "gam-bd-s2", datetime(2026, 4, 2, 9, 0), overall_score=60)
    after = gamification_service.sync_user_gamification(db_session, user_id)

    assert after.profile.streak.longest_streak == 3
    assert after.profile.streak.total_learning_days == 3


def test_repeated_sync_converges_instead_of_accumulating(db_session):
    user_id = "gam-converge-user"
    for day in (1, 2, 3):
        _add_session_at(db_session, user_id, f"gam-cv-s{day}",
                        datetime(2026, 5, day, 9, 0), overall_score=75)

    totals = [
        gamification_service.sync_user_gamification(db_session, user_id)
        .profile.level_progress.total_xp
        for _ in range(3)
    ]

    assert totals[0] == totals[1] == totals[2]


def test_stored_profile_equals_an_independent_recompute(db_session):
    """The cache must never drift from the derivation it claims to cache."""
    user_id = "gam-audit-user"
    for day in (1, 2, 4):
        _add_session_at(db_session, user_id, f"gam-au-s{day}",
                        datetime(2026, 6, day, 9, 0), overall_score=80)

    stored = gamification_service.sync_user_gamification(db_session, user_id).profile

    sessions = gamification_service._session_summaries(db_session, user_id)
    _, skill_by_session, _ = gamification_service._skill_series(db_session, user_id)
    replay = gamification_service.compute_progress(sessions, skill_by_session)

    assert stored.level_progress.total_xp == replay.total_xp
    assert stored.level_progress.level == replay.level
    assert stored.session_count == replay.session_count
    assert stored.streak.longest_streak == replay.longest_streak


# ---------------------------------------------------------------------------
# badges fail closed
# ---------------------------------------------------------------------------

def test_self_aware_is_not_awarded_when_blind_spot_analysis_fails(db_session, monkeypatch):
    """An unavailable analysis is not evidence of being clean."""
    user_id = "gam-failclosed-user"
    _add_session_at(db_session, user_id, "gam-fc-s1", datetime(2026, 7, 1, 9, 0), overall_score=70)
    db_session.add(FeedbackEntry(user_id=user_id, session_id="gam-fc-s1",
                                 feedback_type="self", skill_area="speech_fluency", rating=70))
    db_session.commit()

    def boom(*args, **kwargs):
        raise RuntimeError("blind spot engine unavailable")

    monkeypatch.setattr(blind_spot_service, "detect_user_blind_spots", boom)

    result = gamification_service.sync_user_gamification(db_session, user_id)

    badge = _badge(result.profile, "self_aware")
    assert badge.earned is False
    assert "unavailable" in badge.progress_hint
    assert db_session.query(UserBadge).filter(
        UserBadge.user_id == user_id, UserBadge.badge_key == "self_aware"
    ).count() == 0


def test_high_blind_spot_count_reports_unknown_rather_than_zero(db_session, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("down")

    monkeypatch.setattr(blind_spot_service, "detect_user_blind_spots", boom)
    assert gamification_service._high_blind_spot_count(db_session, "anyone") is None


# ---------------------------------------------------------------------------
# skill XP covers the full history
# ---------------------------------------------------------------------------

def test_skill_xp_counts_sessions_beyond_the_trend_pages_window(db_session):
    """Skill XP must not be capped by the Trends page's 100-row read window."""
    user_id = "gam-window-user"
    total = 105
    for i in range(total):
        db_session.add(AnalyticsSessionMetric(
            user_id=user_id, session_id=f"gam-win-s{i}",
            overall_score=80, speech_pace_score=80, clarity_score=80,
            created_at=datetime(2026, 1, 1) + timedelta(hours=i),
        ))
    db_session.commit()

    result = gamification_service.sync_user_gamification(db_session, user_id)

    by_area = {level.skill_area: level for level in result.profile.skill_levels}
    # speech_fluency = mean(80, 80) = 80  ->  5 + round(80 * 0.15) = 17 XP per session
    assert result.profile.session_count == total
    assert by_area["speech_fluency"].xp == total * 17   # 1785, not the capped 1700


# ---------------------------------------------------------------------------
# reads never claim an award that was not persisted
# ---------------------------------------------------------------------------

def test_read_does_not_claim_a_badge_that_was_never_persisted(db_session):
    user_id = "gam-readonly-badge-user"
    _add_session_at(db_session, user_id, "gam-rb-s1", datetime(2026, 7, 5, 9, 0), overall_score=70)

    profile = gamification_service.get_user_gamification(db_session, user_id)

    badge = _badge(profile, "first_steps")
    assert badge.earned is False
    assert badge.progress_percent == 100.0
    assert badge.progress_hint == "unlocks on your next sync"
    assert badge.earned_at is None

    # ...and a sync then actually awards it
    synced = gamification_service.sync_user_gamification(db_session, user_id)
    assert _badge(synced.profile, "first_steps").earned is True


# ---------------------------------------------------------------------------
# the published formula matches the engine
# ---------------------------------------------------------------------------

def test_rules_published_in_the_response_match_the_engine_constants(db_session):
    rules = gamification_service.get_user_gamification(db_session, "gam-rules-user").rules

    assert rules.base_session_xp == gamification_service.BASE_SESSION_XP
    assert rules.performance_xp_factor == gamification_service.PERFORMANCE_XP_FACTOR
    assert rules.streak_xp_per_day == gamification_service.STREAK_XP_PER_DAY
    assert rules.max_streak_bonus_days == gamification_service.MAX_STREAK_BONUS_DAYS
    assert rules.max_streak_bonus_xp == (
        gamification_service.STREAK_XP_PER_DAY * gamification_service.MAX_STREAK_BONUS_DAYS
    )
    assert rules.level_base_xp == gamification_service.LEVEL_BASE_XP
    assert rules.level_growth_xp == gamification_service.LEVEL_GROWTH_XP
    assert rules.timezone


def test_api_exposes_rules(client):
    body = client.get("/api/v1/analytics/users/gam-api-rules/gamification").json()
    assert body["rules"]["base_session_xp"] == 10
    assert body["rules"]["max_performance_xp"] == 20
    assert body["rules"]["max_streak_bonus_xp"] == 14
