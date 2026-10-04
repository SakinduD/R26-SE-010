"""Redoing the MCA baseline: pedagogy recalculates the learner profile, not the plan.

Real MCA sessions (via the MCA API) and real plan generation; only role-play
scenario selection (RPE + LLM) is mocked.

The xfail(strict=True) tests are acceptance tests for task P8 in
Backend/docs/MCA_Pedagogy_Integration_Issues.pdf: on a redo, keep every
baseline and recalculate the personalised learner profile, leaving existing
training plans untouched. Remove each marker once the behaviour is implemented.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.models.personality_profile import PersonalityProfile
from app.models.training_plan import TrainingPlan
from app.services.pedagogy.scenario_selector import ScenarioSelectionResult

pytestmark = pytest.mark.integration

_BASELINE = "/apa/baseline/complete"
_PROFILE = "/apa/learner-profile/me"
_QUIET = {"message": "A bit quiet. Projecting helps engagement.", "category": "volume", "severity": "warning"}

_SELECTION = ScenarioSelectionResult(
    primary_scenario={"scenario_id": "scenario_002", "title": "Workplace Conflict", "difficulty": "beginner",
                      "target_skills": ["assertiveness"]},
    recommended_scenario_ids=["scenario_002"],
    match_score=0.7,
    generation_source="rpe_library",
    rationale=["test"],
)


@pytest.fixture(autouse=True)
def _mock_scenario_selection():
    with patch("app.services.pedagogy.orchestrator.select_scenarios", new=AsyncMock(return_value=_SELECTION)):
        yield


@pytest.fixture
def learner(make_user, db_session):
    user = make_user("redo")
    now = datetime.now(timezone.utc)
    db_session.add(PersonalityProfile(
        user_id=user.id, openness=50.0, conscientiousness=50.0, extraversion=50.0,
        agreeableness=50.0, neuroticism=50.0, raw_responses={}, created_at=now, updated_at=now,
    ))
    db_session.commit()
    return user


@pytest.fixture
def do_baseline(api, start_session):
    """Run a real MCA baseline session and submit it; returns (session, baseline response)."""
    def _do(user, quiet_every=None):
        sid = start_session(user, "ai")["id"]
        session = api(user, "post", f"/mca/sessions/{sid}/end", json={"observation_log": [
            {"elapsed_seconds": 3 * i, "speaking": True, "face_visible": True, "emotion": "neutral",
             "confidence": 0.9, "detections": [_QUIET] if quiet_every and i % quiet_every else []}
            for i in range(40)
        ]}).json()
        resp = api(user, "post", _BASELINE, json={"mca_session_id": sid})
        assert resp.status_code == 201, resp.text
        return session, resp.json()
    return _do


def _plan(db_session, user) -> TrainingPlan:
    db_session.expire_all()
    return db_session.query(TrainingPlan).filter(TrainingPlan.user_id == user.id).one()


def _plan_state(plan: TrainingPlan) -> dict:
    return {"skill": plan.skill, "difficulty": plan.difficulty, "strategy": plan.strategy_json,
            "baseline": plan.baseline_summary_json}


class TestBaselineRedoPositive:
    def test_redo_becomes_the_current_baseline(self, api, learner, do_baseline):
        do_baseline(learner)
        second, resp = do_baseline(learner, quiet_every=2)
        assert resp["baseline"]["mca_session_id"] == second["id"]
        assert api(learner, "get", "/apa/baseline/me").json()["mca_session_id"] == second["id"]

    def test_plan_generated_after_redo_uses_new_baseline(self, api, learner, do_baseline, db_session):
        do_baseline(learner)
        second, _ = do_baseline(learner, quiet_every=2)
        assert api(learner, "post", "/apa/plan/generate").status_code == 201
        assert _plan(db_session, learner).baseline_summary_json["raw_overall_score"] == \
            pytest.approx(second["overall_score"])


class TestBaselineRedoAcceptance:
    @pytest.mark.xfail(strict=True, reason="P8: baselines are overwritten; no history is kept")
    def test_every_baseline_is_kept(self, api, learner, do_baseline):
        first, _ = do_baseline(learner)
        second, _ = do_baseline(learner, quiet_every=2)
        resp = api(learner, "get", "/apa/baseline/history")
        assert resp.status_code == 200
        assert [b["mca_session_id"] for b in resp.json()] == [second["id"], first["id"]]  # newest first

    @pytest.mark.xfail(strict=True, reason="P8: a redo regenerates the training plan (resets skill and difficulty)")
    def test_redo_leaves_training_plan_untouched(self, learner, do_baseline, db_session):
        do_baseline(learner)
        # The learner picks a skill and earns harder difficulty in role-plays.
        plan = _plan(db_session, learner)
        plan.skill, plan.difficulty = "negotiation", min(10, plan.difficulty + 2)
        db_session.commit()
        before = _plan_state(_plan(db_session, learner))

        do_baseline(learner, quiet_every=2)
        assert _plan_state(_plan(db_session, learner)) == before

    @pytest.mark.xfail(strict=True, reason="P8: no stored learner profile is recalculated on redo")
    def test_redo_recalculates_learner_profile(self, api, learner, do_baseline):
        first, _ = do_baseline(learner)
        resp = api(learner, "get", _PROFILE)
        assert resp.status_code == 200
        assert resp.json()["source_mca_session_id"] == first["id"]

        second, _ = do_baseline(learner, quiet_every=2)
        profile = api(learner, "get", _PROFILE).json()
        assert profile["source_mca_session_id"] == second["id"]
        assert profile["baseline"]["raw_overall_score"] == pytest.approx(second["overall_score"])
        for key in ("strategy", "difficulty", "priority_skills", "weak_skills"):
            assert key in profile
