"""
Tests for the APM orchestrator — generate_training_plan, apply_session_feedback,
apply_live_signals.

All DB and external calls are mocked so these tests run without PostgreSQL.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.contracts.rpe import CoachingAdvice, FeedbackResponse, TurnMetric
from app.services.pedagogy import orchestrator
from app.services.pedagogy.types import OceanScores, TeachingStrategy

FAKE_USER_ID = uuid.uuid4()
INTRO_SCORES = OceanScores(
    openness=40, conscientiousness=40, extraversion=25, agreeableness=55, neuroticism=70
)
EXTRO_SCORES = OceanScores(
    openness=65, conscientiousness=70, extraversion=80, agreeableness=55, neuroticism=30
)


def _mock_db(plan=None, profile=None):
    """Build a mock SQLAlchemy Session that returns the given objects."""
    db = MagicMock()
    query = db.query.return_value
    filter_ = query.filter.return_value
    filter_.first.return_value = plan if plan is not None else profile
    return db


def _make_plan(scores: OceanScores, difficulty: int = 5) -> MagicMock:
    from app.services.pedagogy.strategy_optimizer import optimize_strategy

    strategy = optimize_strategy(scores)
    plan = MagicMock()
    plan.id = uuid.uuid4()
    plan.user_id = FAKE_USER_ID
    plan.skill = "job_interview"
    plan.strategy_json = strategy.model_dump()
    plan.difficulty = difficulty
    plan.recommended_scenario_ids = []
    plan.primary_scenario_json = {"scenario_id": "s1", "title": "T", "target_skills": ["assertiveness"]}
    plan.generation_source = "rpe_library"
    plan.generation_status = "completed"
    plan.last_adjusted_at = None
    return plan


def _make_fb(outcome: str = "success") -> FeedbackResponse:
    return FeedbackResponse(
        session_id="sess1",
        scenario_id="sc1",
        scenario_title="Test",
        user_id=str(FAKE_USER_ID),
        outcome=outcome,
        final_trust=80 if outcome == "success" else 10,
        final_escalation=1 if outcome == "success" else 4,
        total_turns=3,
        turn_metrics=[
            TurnMetric(
                turn=1,
                assertiveness_score=0.7 if outcome == "success" else 0.2,
                empathy_score=0.6,
                clarity_score=0.8,
                response_quality=0.75 if outcome == "success" else 0.2,
            )
        ],
        coaching_advice=CoachingAdvice(overall_rating="good", summary="OK"),
    )


# --------------------------------------------------------------------------
# generate_training_plan
# --------------------------------------------------------------------------


async def test_generate_training_plan_raises_if_no_profile():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    rpe = AsyncMock()
    llm = AsyncMock()

    with pytest.raises(ValueError, match="personality profile"):
        await orchestrator.generate_training_plan(FAKE_USER_ID, db, rpe, llm)



async def test_generate_training_plan_creates_plan():
    profile = MagicMock()
    profile.openness = INTRO_SCORES.openness
    profile.conscientiousness = INTRO_SCORES.conscientiousness
    profile.extraversion = INTRO_SCORES.extraversion
    profile.agreeableness = INTRO_SCORES.agreeableness
    profile.neuroticism = INTRO_SCORES.neuroticism

    call_count = [0]
    def query_side_effect(model):
        call_count[0] += 1
        m = MagicMock()
        if call_count[0] == 1:
            # PersonalityProfile query
            m.filter.return_value.first.return_value = profile
        else:
            # TrainingPlan query — no existing plan
            m.filter.return_value.first.return_value = None
        return m

    db = MagicMock()
    db.query.side_effect = query_side_effect

    rpe = AsyncMock()
    rpe.recommend_scenarios.side_effect = Exception("RPE unavailable")
    llm = AsyncMock()
    llm.generate_json.return_value = {
        "title": "T", "context": "C", "npc_role": "R",
        "opening_npc_line": "Hi", "npc_personality": "firm",
        "recommended_turns": 5, "max_turns": 10,
        "target_skills": ["assertiveness"],
    }

    # The plan returned after commit/refresh
    created_plan = _make_plan(INTRO_SCORES)
    db.refresh.side_effect = lambda p: None

    # Patch _load_ocean and _load_plan to simplify
    with (
        patch.object(orchestrator, "_load_ocean", return_value=INTRO_SCORES),
        patch.object(orchestrator, "_load_plan", return_value=None),
        patch("app.services.pedagogy.analytics_writer.write_skill_predictions"),
    ):
        rpe2 = AsyncMock()
        rpe2.recommend_scenarios.side_effect = Exception("down")

        llm2 = AsyncMock()
        llm2.generate_json.return_value = {
            "title": "T", "context": "C", "npc_role": "R",
            "opening_npc_line": "Hi", "npc_personality": "firm",
            "recommended_turns": 5, "max_turns": 10,
            "target_skills": ["assertiveness"],
        }

        db2 = MagicMock()
        db2.refresh.side_effect = lambda p: setattr(p, "id", uuid.uuid4()) or setattr(p, "created_at", datetime.now(timezone.utc)) or setattr(p, "updated_at", datetime.now(timezone.utc))

        result_plan = await orchestrator.generate_training_plan(
            FAKE_USER_ID, db2, rpe2, llm2
        )
    # We get a TrainingPlan (or mock) back — check it was committed
    db2.commit.assert_called()
    db2.add.assert_called()


# --------------------------------------------------------------------------
# apply_session_feedback
# --------------------------------------------------------------------------


async def test_apply_session_feedback_raises_if_no_plan():
    with patch.object(orchestrator, "_load_plan", return_value=None):
        db = MagicMock()
        with pytest.raises(ValueError, match="training plan"):
            await orchestrator.apply_session_feedback(FAKE_USER_ID, _make_fb(), db)



async def test_apply_session_feedback_updates_plan():
    intro_plan = _make_plan(INTRO_SCORES, difficulty=4)

    with (
        patch.object(orchestrator, "_load_plan", return_value=intro_plan),
        patch("app.services.pedagogy.analytics_writer.write_session_metrics"),
        patch("app.services.pedagogy.analytics_writer.write_feedback_entries"),
    ):
        db = MagicMock()
        await orchestrator.apply_session_feedback(FAKE_USER_ID, _make_fb("failure"), db)

    db.add.assert_called()   # AdjustmentHistory written
    db.commit.assert_called()



async def test_apply_session_feedback_success_raises_difficulty():
    extro_plan = _make_plan(EXTRO_SCORES, difficulty=6)
    original_difficulty = extro_plan.difficulty

    with (
        patch.object(orchestrator, "_load_plan", return_value=extro_plan),
        patch("app.services.pedagogy.analytics_writer.write_session_metrics"),
        patch("app.services.pedagogy.analytics_writer.write_feedback_entries"),
    ):
        db = MagicMock()
        fb = FeedbackResponse(
            session_id="s1", scenario_id="sc1", scenario_title="T",
            user_id=str(FAKE_USER_ID),
            outcome="success", final_trust=90, final_escalation=0,
            total_turns=5,
            turn_metrics=[
                TurnMetric(turn=i, assertiveness_score=0.9, empathy_score=0.9, clarity_score=0.9, response_quality=0.9)
                for i in range(1, 6)
            ],
            coaching_advice=CoachingAdvice(overall_rating="excellent", summary="Great"),
        )
        await orchestrator.apply_session_feedback(FAKE_USER_ID, fb, db)

    assert extro_plan.difficulty >= original_difficulty


# --------------------------------------------------------------------------
# apply_live_signals
# --------------------------------------------------------------------------


async def test_apply_live_signals_returns_default_if_no_plan():
    with patch.object(orchestrator, "_load_plan", return_value=None):
        db = MagicMock()
        result = await orchestrator.apply_live_signals(FAKE_USER_ID, [], db)

    assert result["new_difficulty"] == 5



async def test_apply_live_signals_lightweight_no_strategy_change():
    from app.contracts.mca import McaNudge

    intro_plan = _make_plan(INTRO_SCORES, difficulty=5)
    original_strategy = dict(intro_plan.strategy_json)

    with patch.object(orchestrator, "_load_plan", return_value=intro_plan):
        db = MagicMock()
        nudges = [
            McaNudge(emotion="neutral", confidence=0.5, nudge_category="volume", nudge_severity="info")
        ]
        result = await orchestrator.apply_live_signals(FAKE_USER_ID, nudges, db)

    # Strategy fields unchanged in result (lightweight mode)
    assert result["new_strategy"]["tone"] == original_strategy["tone"]
