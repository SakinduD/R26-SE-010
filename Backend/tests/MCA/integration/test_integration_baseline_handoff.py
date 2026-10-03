"""MCA -> pedagogy handoff: a finished MCA session becoming the learner's baseline.

The MCA session is produced through the real MCA API (start -> end), so the
baseline endpoint receives exactly what MCA stores: 0-100 integer skill scores
and MCA's emotion labels. Only training-plan generation (Gemini / RPE) is mocked.

The xfail(strict=True) tests are acceptance tests for pedagogy-side fixes listed
in Backend/docs/MCA_Pedagogy_Integration_Issues.pdf. They fail today by design;
when the fix lands they XPASS, strict mode turns that into a failure, and the
marker should be removed.
"""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.models.baseline_snapshot import BaselineSnapshot
from app.models.personality_profile import PersonalityProfile
from app.services.pedagogy.baseline_summarizer import summarize
from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import OceanScores

pytestmark = pytest.mark.integration

_BASELINE = "/apa/baseline/complete"
_QUIET = {"message": "A bit quiet. Projecting helps engagement.", "category": "volume", "severity": "warning"}
_MID_OCEAN = OceanScores(openness=50, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=50)


@pytest.fixture(autouse=True)
def _mock_plan_generation():
    with patch("app.services.pedagogy.orchestrator.generate_training_plan",
               new=AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4()))) as mock:
        yield mock


@pytest.fixture
def learner(make_user, db_session):
    """A user who has completed the personality survey (required by the baseline endpoint)."""
    user = make_user("baseline")
    now = datetime.now(timezone.utc)
    db_session.add(PersonalityProfile(
        user_id=user.id, openness=50.0, conscientiousness=50.0, extraversion=50.0,
        agreeableness=50.0, neuroticism=50.0, raw_responses={}, created_at=now, updated_at=now,
    ))
    db_session.commit()
    return user


@pytest.fixture
def finish_mca_session(api, start_session):
    """Run a real AI-mode MCA session through the MCA API and return the ended session JSON."""
    def _finish(user, observation_log, emotion_distribution=None) -> dict:
        sid = start_session(user, "ai")["id"]
        resp = api(user, "post", f"/mca/sessions/{sid}/end", json={
            "observation_log": observation_log,
            **({"emotion_distribution": emotion_distribution} if emotion_distribution is not None else {}),
        })
        assert resp.status_code == 200, resp.text
        return resp.json()
    return _finish


def _speaking(n=40, quiet_every=None, emotion="neutral"):
    return [
        {"elapsed_seconds": 3 * i, "speaking": True, "face_visible": True, "emotion": emotion, "confidence": 0.9,
         "detections": [_QUIET] if quiet_every and i % quiet_every else []}
        for i in range(n)
    ]


def _baseline_summary(db_session, user):
    db_session.expire_all()
    snap = db_session.query(BaselineSnapshot).filter(BaselineSnapshot.user_id == user.id).one()
    return summarize(snap)


# Contract: what MCA produces is accepted and stored unchanged

class TestBaselineHandoffPositive:
    def test_completed_mca_session_becomes_baseline(self, api, learner, finish_mca_session, db_session):
        session = finish_mca_session(learner, _speaking(), {"neutral": 0.7, "happy": 0.3})

        resp = api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]})
        assert resp.status_code == 201, resp.text
        baseline = resp.json()["baseline"]
        assert baseline["mca_session_id"] == session["id"]
        assert baseline["skill_scores"] == session["skill_scores"]          # MCA's 0-100 scores, unchanged
        assert baseline["emotion_distribution"] == session["emotion_distribution"]
        assert baseline["overall_score"] == pytest.approx(session["overall_score"])
        assert "plan_id" in resp.json()

    def test_newer_baseline_session_replaces_older(self, api, learner, finish_mca_session, db_session):
        first = finish_mca_session(learner, _speaking())
        second = finish_mca_session(learner, _speaking(quiet_every=2))
        api(learner, "post", _BASELINE, json={"mca_session_id": first["id"]})
        api(learner, "post", _BASELINE, json={"mca_session_id": second["id"]})

        db_session.expire_all()
        rows = db_session.query(BaselineSnapshot).filter(BaselineSnapshot.user_id == learner.id).all()
        assert len(rows) == 1
        assert rows[0].mca_session_id == second["id"]

    def test_baseline_triggers_plan_generation(self, api, learner, finish_mca_session, _mock_plan_generation):
        session = finish_mca_session(learner, _speaking())
        api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]})
        _mock_plan_generation.assert_awaited_once()


class TestBaselineHandoffNegative:
    def test_active_session_cannot_be_baseline(self, api, learner, start_session):
        # NEGATIVE: an MCA session that hasn't ended has no scores yet, so it
        # must not be used as a baseline.
        sid = start_session(learner, "ai")["id"]
        assert api(learner, "post", _BASELINE, json={"mca_session_id": sid}).status_code == 400

    def test_discarded_session_cannot_be_baseline(self, api, learner, start_session):
        # NEGATIVE: an early-stopped (discarded) MCA session is deleted, so it
        # can't be found to use as a baseline.
        sid = start_session(learner, "ai")["id"]
        api(learner, "delete", f"/mca/sessions/{sid}")
        assert api(learner, "post", _BASELINE, json={"mca_session_id": sid}).status_code == 404

    def test_other_users_session_cannot_be_baseline(self, api, learner, make_user, finish_mca_session):
        # NEGATIVE: a learner must not adopt someone else's MCA results as their baseline.
        other = make_user("other")
        session = finish_mca_session(other, _speaking())
        assert api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]}).status_code == 403

    def test_learner_without_survey_is_rejected(self, api, make_user, finish_mca_session):
        # NEGATIVE: pedagogy needs the personality profile to build a plan, so
        # the baseline is refused until the survey is done.
        user = make_user("nosurvey")
        session = finish_mca_session(user, _speaking())
        assert api(user, "post", _BASELINE, json={"mca_session_id": session["id"]}).status_code == 404

    def test_malformed_session_id_is_422(self, api, learner):
        # NEGATIVE: the session id must be a UUID.
        assert api(learner, "post", _BASELINE, json={"mca_session_id": "MCA-AI-1"}).status_code == 422


# Acceptance tests for the pedagogy-side fixes (see the PDF)

class TestPedagogyReadsMcaBaseline:
    @pytest.mark.xfail(strict=True, reason="Pedagogy issue 2: skill scores are 0-100 but the weak-skill threshold is 0.4")
    def test_weak_mca_skill_becomes_priority(self, api, learner, finish_mca_session, db_session):
        session = finish_mca_session(learner, _speaking(n=100, quiet_every=10))  # quiet in 90% of chunks
        assert session["skill_scores"]["vocal_command"] < 40
        api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]})

        strategy = optimize_strategy(_MID_OCEAN, baseline=_baseline_summary(db_session, learner))
        assert "vocal_command" in strategy.priority_skills

    @pytest.mark.xfail(strict=True, reason="Pedagogy issue 4: missing emotion data is read as confidence 0")
    def test_no_emotion_data_does_not_force_supportive_persona(self, api, learner, finish_mca_session, db_session):
        session = finish_mca_session(learner, _speaking(emotion=None))  # no emotion readings at all
        api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]})

        summary = _baseline_summary(db_session, learner)
        assert summary.confidence_indicator is None
        assert optimize_strategy(_MID_OCEAN, baseline=summary).npc_personality == \
            optimize_strategy(_MID_OCEAN, baseline=None).npc_personality

    @pytest.mark.xfail(strict=True, reason="Pedagogy issue 5: stress labels don't include MCA's angry/disgust")
    def test_mca_negative_emotions_count_as_stress(self, api, learner, finish_mca_session, db_session):
        session = finish_mca_session(learner, _speaking(), {"angry": 0.7, "disgust": 0.3})
        api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]})
        assert _baseline_summary(db_session, learner).stress_indicator > 0.6

    @pytest.mark.xfail(strict=True, reason="Pedagogy issue 5: 'neutral' is counted as confidence")
    def test_neutral_voice_is_not_full_confidence(self, api, learner, finish_mca_session, db_session):
        session = finish_mca_session(learner, _speaking(), {"neutral": 1.0})
        api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]})
        assert _baseline_summary(db_session, learner).confidence_indicator < 1.0

    @pytest.mark.xfail(strict=True, reason="Pedagogy issue 6: /baseline/complete skips the session-quality filter")
    def test_session_that_observed_nothing_is_rejected(self, api, learner, finish_mca_session):
        session = finish_mca_session(learner, [])  # nothing observed: every skill is 50
        assert api(learner, "post", _BASELINE, json={"mca_session_id": session["id"]}).status_code == 422
