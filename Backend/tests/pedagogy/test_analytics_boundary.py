"""
The APM ↔ analytics boundary.

Analytics reports on multimodal (MCA) sessions only and hands its learner
signal back to APM as a pull. APM must read the columns analytics actually
fills, and must never write role-play data into analytics tables.
"""
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.contracts.rpe import CoachingAdvice, FeedbackResponse, TurnMetric
from app.models.analytics import AnalyticsSessionMetric
from app.models.training_plan import AdjustmentHistory
from app.services.pedagogy import orchestrator, plan_service
from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import OceanScores


def _mca_row(vocal, fluency, presence, regulation, overall) -> AnalyticsSessionMetric:
    """A metric row exactly as analytics_integration_service writes an MCA session."""
    return AnalyticsSessionMetric(
        user_id="u", session_id=str(uuid.uuid4()),
        speech_volume_score=vocal,
        speech_pace_score=fluency, clarity_score=fluency,
        eye_contact_score=presence, confidence_score=presence,
        empathy_score=regulation, emotional_control_score=regulation,
        response_quality_score=None,  # role-play only; never filled for MCA sessions
        overall_score=overall,
    )


def test_fallback_signal_reads_the_mca_columns_analytics_fills():
    signal = plan_service._signal_from_metrics([
        _mca_row(vocal=30, fluency=60, presence=80, regulation=20, overall=50),
        _mca_row(vocal=50, fluency=60, presence=90, regulation=40, overall=60),
    ])
    assert signal.engagement_score == pytest.approx(0.85)    # presence_engagement
    assert signal.confidence_score == pytest.approx(0.40)    # vocal_command
    assert signal.stress_level == pytest.approx(0.70)        # 1 - emotional regulation
    assert signal.objective_completion_rate == pytest.approx(0.55)


def test_fallback_engagement_is_measured_not_a_placeholder():
    """response_quality_score is always empty now; engagement must not sit at 0.5."""
    low = plan_service._signal_from_metrics([_mca_row(50, 50, 10, 50, 50)])
    high = plan_service._signal_from_metrics([_mca_row(50, 50, 95, 50, 50)])
    assert low.engagement_score < 0.2 < 0.9 < high.engagement_score


def test_session_feedback_writes_only_apm_adjustment_history():
    """Role-play results stay in APM; nothing is added to analytics tables."""
    plan = MagicMock()
    plan.id = uuid.uuid4()
    plan.difficulty = 5
    plan.strategy_json = optimize_strategy(OceanScores(
        openness=50, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=50,
    )).model_dump()
    fb = FeedbackResponse(
        session_id="rp-1", scenario_id="scenario_002", scenario_title="T", user_id="u",
        outcome="failure", final_trust=10, final_escalation=5, total_turns=1,
        turn_metrics=[TurnMetric(turn=1, assertiveness_score=2, empathy_score=2,
                                 clarity_score=2, response_quality=2.0)],
        coaching_advice=CoachingAdvice(overall_rating="needs_work", summary="s"),
    )
    db = MagicMock()

    import asyncio
    with patch.object(orchestrator, "_load_plan", return_value=plan):
        asyncio.run(orchestrator.apply_session_feedback(uuid.uuid4(), fb, db))

    added = [call.args[0] for call in db.add.call_args_list]
    assert added and all(isinstance(row, AdjustmentHistory) for row in added)
