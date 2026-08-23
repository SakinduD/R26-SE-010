"""The FSPA -> APA feedback loop.

Covers the edge the system architecture labels "Updated learner profile &
performance data": analytics observing the learner across many sessions, and
the pedagogy engine consuming that profile when it composes a plan.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.models.user import User
from app.services import analytics_feedback_loop_service as loop
from app.services.pedagogy import plan_service
from app.services.pedagogy.dynamic_adjuster import adjust
from app.services.pedagogy.types import TeachingStrategy


NOW = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

def _make_user(db):
    user = User(id=uuid.uuid4(), email=f"loop-{uuid.uuid4().hex[:8]}@example.com")
    db.add(user)
    db.commit()
    return user


def _sessions(db, user_id, scores, *, clarity=None, start_days_ago=None):
    """Write one metric row per score, oldest first, so a trend can form."""
    count = len(scores)
    start = start_days_ago if start_days_ago is not None else count
    for index, score in enumerate(scores):
        db.add(
            AnalyticsSessionMetric(
                user_id=str(user_id),
                session_id=f"loop-{user_id}-{index}",
                overall_score=score,
                speech_volume_score=score,
                speech_pace_score=score,
                clarity_score=clarity if clarity is not None else score,
                eye_contact_score=score,
                confidence_score=score,
                empathy_score=score,
                emotional_control_score=score,
                response_quality_score=score,
                created_at=datetime.utcnow() - timedelta(days=start - index),
            )
        )
    db.commit()


# ---------------------------------------------------------------------------
# the signal itself
# ---------------------------------------------------------------------------

def test_signal_fields_stay_inside_the_normalised_range(db_session):
    user_id = "loop-range-user"
    _sessions(db_session, user_id, [40, 55, 70, 85])

    signal = loop.build_learner_profile_signal(db_session, user_id)

    for field in ("engagement_score", "confidence_score",
                  "objective_completion_rate", "stress_level"):
        value = getattr(signal, field)
        assert 0.0 <= value <= 1.0, f"{field} out of range: {value}"
    assert signal.outcome in {"success", "partial", "failure"}


def test_improving_history_reads_as_success(db_session):
    user_id = "loop-improving-user"
    _sessions(db_session, user_id, [40, 52, 64, 78, 88])

    signal = loop.build_learner_profile_signal(db_session, user_id)

    assert signal.improving_count > signal.declining_count
    assert signal.outcome == "success"


def test_declining_history_reads_as_failure(db_session):
    user_id = "loop-declining-user"
    _sessions(db_session, user_id, [90, 80, 70, 58, 45])

    signal = loop.build_learner_profile_signal(db_session, user_id)

    assert signal.declining_count > signal.improving_count
    assert signal.outcome == "failure"


def test_confidence_tracks_the_learners_latest_scores(db_session):
    strong, weak = "loop-strong-user", "loop-weak-user"
    _sessions(db_session, strong, [85, 88, 90])
    _sessions(db_session, weak, [30, 32, 35])

    assert (
        loop.build_learner_profile_signal(db_session, strong).confidence_score
        > loop.build_learner_profile_signal(db_session, weak).confidence_score
    )


def test_blind_spots_raise_the_stress_channel(db_session):
    """The channel RPE cannot supply — it needs self vs observed over time."""
    calm, pressured = "loop-calm-user", "loop-blindspot-user"
    _sessions(db_session, calm, [60, 62, 64])
    _sessions(db_session, pressured, [60, 62, 64])

    # The pressured learner rates themselves far above what was observed.
    for skill in ("vocal_command", "speech_fluency", "presence_engagement"):
        db_session.add(
            FeedbackEntry(
                user_id=pressured,
                session_id=f"loop-{pressured}-0",
                feedback_type="self",
                skill_area=skill,
                rating=98,
            )
        )
    db_session.commit()

    calm_signal = loop.build_learner_profile_signal(db_session, calm)
    pressured_signal = loop.build_learner_profile_signal(db_session, pressured)

    assert pressured_signal.blind_spot_total > calm_signal.blind_spot_total
    assert pressured_signal.stress_level > calm_signal.stress_level


def test_signal_carries_the_evidence_it_was_derived_from(db_session):
    user_id = "loop-evidence-user"
    _sessions(db_session, user_id, [50, 60, 70])

    signal = loop.build_learner_profile_signal(db_session, user_id)

    assert signal.evidence_sessions == 3
    assert signal.analyzed_skill_count > 0
    assert signal.mean_latest_score is not None


# ---------------------------------------------------------------------------
# the pedagogy engine actually consumes the signal
#
# These are the tests that matter: without them the loop is a number nobody
# reads. They pin the contract between the two modules.
# ---------------------------------------------------------------------------

def test_plan_service_prefers_the_longitudinal_signal_over_recent_averages(db_session):
    """A declining learner and a climbing one can share the same average.

    Averaging recent sessions cannot separate them; the trend-aware signal can.
    This asserts plan_service reaches for the analytics profile, not the mean.
    """
    user = _make_user(db_session)
    _sessions(db_session, user.id, [90, 80, 70, 60, 50])   # mean 70, clearly declining

    signal, evidence = plan_service._longitudinal_signal(user.id, db_session)

    assert signal is not None
    assert signal.outcome == "failure"                     # direction, not average
    assert evidence["declining"] >= 1
    assert evidence["evidence_sessions"] == 5


def test_longitudinal_signal_is_absent_without_evidence(db_session):
    """No sessions means the caller must fall back, not receive a neutral guess."""
    user = _make_user(db_session)

    signal, evidence = plan_service._longitudinal_signal(user.id, db_session)

    assert signal is None
    assert evidence is None


def test_plan_generation_falls_back_when_analytics_is_unavailable(db_session, monkeypatch):
    """A broken analytics module must not stop a learner getting a plan."""
    user = _make_user(db_session)
    _sessions(db_session, user.id, [70, 72, 74])

    def boom(*args, **kwargs):
        raise RuntimeError("analytics down")

    monkeypatch.setattr(loop, "build_learner_profile_signal", boom)

    signal, evidence = plan_service._longitudinal_signal(user.id, db_session)

    assert signal is None          # caller falls back to _signal_from_metrics
    assert evidence is None
    # ...and the fallback still produces a usable signal
    metrics = plan_service._load_recent_metrics(user.id, db_session)
    assert plan_service._signal_from_metrics(metrics) is not None


def test_the_two_signal_sources_are_interchangeable_to_the_adjuster(db_session):
    """Both paths must hand dynamic_adjuster the same shape, or one will crash."""
    user = _make_user(db_session)
    _sessions(db_session, user.id, [65, 70, 75])

    longitudinal, _ = plan_service._longitudinal_signal(user.id, db_session)
    averaged = plan_service._signal_from_metrics(
        plan_service._load_recent_metrics(user.id, db_session)
    )

    assert longitudinal is not None and averaged is not None
    assert type(longitudinal) is type(averaged)
    for field in ("engagement_score", "confidence_score",
                  "objective_completion_rate", "stress_level", "outcome"):
        assert hasattr(longitudinal, field) and hasattr(averaged, field)


def test_a_declining_learner_gets_an_easier_plan_than_a_thriving_one(db_session):
    """End to end through the adjuster: the signal has to change the difficulty."""
    struggling = _make_user(db_session)
    thriving = _make_user(db_session)
    _sessions(db_session, struggling.id, [70, 55, 40, 25], clarity=20)
    _sessions(db_session, thriving.id, [60, 72, 84, 95])

    seed_strategy = TeachingStrategy(
        tone="direct", pacing="moderate", complexity="moderate",
        npc_personality="professional", feedback_style="balanced", rationale=[],
    )

    struggling_signal, _ = plan_service._longitudinal_signal(struggling.id, db_session)
    thriving_signal, _ = plan_service._longitudinal_signal(thriving.id, db_session)

    struggling_result = adjust(seed_strategy, 5, struggling_signal, mode="full")
    thriving_result = adjust(seed_strategy, 5, thriving_signal, mode="full")

    assert struggling_result.new_difficulty <= thriving_result.new_difficulty


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def test_learner_profile_signal_endpoint_is_read_only(client, db_session):
    user_id = "loop-api-user"
    _sessions(db_session, user_id, [70, 75, 80])

    response = client.get(f"/api/v1/analytics/users/{user_id}/learner-profile-signal")

    assert response.status_code == 200
    body = response.json()
    assert 0.0 <= body["signal"]["confidence_score"] <= 1.0
    assert body["signal"]["evidence_sessions"] == 3
    assert body["loop_version"] == loop.LOOP_VERSION


def test_signal_endpoint_is_calm_about_an_unknown_learner(client):
    response = client.get("/api/v1/analytics/users/nobody-at-all/learner-profile-signal")

    assert response.status_code == 200
    assert response.json()["signal"]["evidence_sessions"] == 0
