"""Whole-history views must not repeat the mistake they exist to fix.

The "All Sessions" dashboard used to answer every question with a lifetime mean.
These tests pin the two properties that make the replacement different: latest
and average are reported side by side, and self-assessment gaps are counted
rather than averaged.
"""

import pytest

from app.services import learner_history_service


def _metric(client, user_id, session_id, value):
    """One session where all four tracked skills score the same."""
    return client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": user_id,
            "session_id": session_id,
            "speech_volume_score": value,
            "speech_pace_score": value,
            "clarity_score": value,
            "eye_contact_score": value,
            "confidence_score": value,
            "empathy_score": value,
            "emotional_control_score": value,
            "overall_score": value,
        },
    )


def _self_rating(client, user_id, session_id, skill, rating):
    return client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": user_id,
            "session_id": session_id,
            "feedback_type": "self",
            "skill_area": skill,
            "rating": rating,
        },
    )


def test_history_reports_latest_and_average_separately(client, db_session):
    """The number that broke the dashboard was an average labelled as "now"."""
    for index, value in enumerate([90, 90, 90, 30], start=1):
        _metric(client, "history-user", f"history-session-{index}", value)

    summary = learner_history_service.summarise_skill_history(db_session, "history-user")
    skills = {item.skill_area: item for item in summary.skills}
    vocal = skills["vocal_command"]

    assert vocal.latest_score == 30
    assert vocal.first_score == 90
    assert vocal.best_score == 90
    assert vocal.worst_score == 30
    assert vocal.average_score == 75
    # 75 is true and 30 is true. Reporting only the first is what let a collapse
    # read as "Great job".
    assert vocal.latest_score < vocal.average_score
    assert vocal.session_count == 4


def test_history_reports_how_much_the_learner_varies(client, db_session):
    """A comfortable average over wildly different sessions describes nothing."""
    for index, value in enumerate([20, 100, 20, 100], start=1):
        _metric(client, "swingy-user", f"swingy-session-{index}", value)

    summary = learner_history_service.summarise_skill_history(db_session, "swingy-user")
    vocal = {item.skill_area: item for item in summary.skills}["vocal_command"]

    assert vocal.average_score == 60
    assert vocal.consistency is not None and vocal.consistency > 30


def test_a_gap_in_both_directions_is_not_reported_as_accuracy(client, db_session):
    """The finding averaging destroys.

    Rated 30 above in one session and 30 below in the next, the mean gap is zero
    and the learner looks perfectly self-aware. They were wrong every time.
    """
    for index, (observed, rated) in enumerate(
        [(50, 80), (50, 20), (50, 80), (50, 20)], start=1
    ):
        session_id = f"swing-session-{index}"
        _metric(client, "swing-user", session_id, observed)
        _self_rating(client, "swing-user", session_id, "vocal_command", rated)

    result = learner_history_service.detect_recurring_blind_spots(db_session, "swing-user")
    item = {entry.skill_area: entry for entry in result.items}["vocal_command"]

    assert item.mean_signed_gap == pytest.approx(0, abs=0.01)
    assert item.sessions_rated == 4
    assert item.sessions_with_gap == 4
    assert item.pattern == "inconsistent"
    # The signed mean is zero; the magnitude that matters is not.
    assert item.typical_gap == 30
    assert "sometimes high, sometimes low" in item.recommendation


def test_a_consistent_direction_is_named_as_a_habit(client, db_session):
    for index in range(1, 5):
        session_id = f"habit-session-{index}"
        _metric(client, "habit-user", session_id, 50)
        _self_rating(client, "habit-user", session_id, "emotional_intelligence", 78)

    result = learner_history_service.detect_recurring_blind_spots(db_session, "habit-user")
    item = {entry.skill_area: entry for entry in result.items}["emotional_intelligence"]

    assert item.pattern == "consistent_overestimation"
    assert item.gap_rate == 1.0
    assert item.mean_signed_gap == 28
    assert "habit rather than an off day" in item.recommendation
    assert result.strongest_pattern.skill_area == "emotional_intelligence"


def test_agreement_session_after_session_is_reported_as_a_strength(client, db_session):
    for index in range(1, 5):
        session_id = f"aligned-session-{index}"
        _metric(client, "aligned-user", session_id, 70)
        _self_rating(client, "aligned-user", session_id, "speech_fluency", 72)

    result = learner_history_service.detect_recurring_blind_spots(db_session, "aligned-user")
    item = {entry.skill_area: entry for entry in result.items}["speech_fluency"]

    assert item.pattern == "aligned"
    assert item.sessions_with_gap == 0
    assert item.severity == "none"
    assert result.strongest_pattern is None


def test_too_few_sessions_produces_no_pattern(client, db_session):
    """Two sessions cannot distinguish a habit from a coincidence."""
    for index in range(1, 3):
        session_id = f"sparse-session-{index}"
        _metric(client, "sparse-user", session_id, 50)
        _self_rating(client, "sparse-user", session_id, "vocal_command", 90)

    result = learner_history_service.detect_recurring_blind_spots(db_session, "sparse-user")

    assert result.items == []


def test_endpoints_are_reachable(client):
    for path in (
        "/api/v1/analytics/users/unknown-history-user/skill-history",
        "/api/v1/analytics/users/unknown-history-user/recurring-blind-spots",
    ):
        response = client.get(path)
        assert response.status_code == 200
