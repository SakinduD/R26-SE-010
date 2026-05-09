"""Tests for PerformanceAggregator — mapping external signals to PerformanceSignal."""
import pytest

from app.contracts.mca import McaNudge
from app.contracts.rpe import CoachingAdvice, FeedbackResponse, RiskFlag, TurnMetric
from app.services.pedagogy.aggregator import PerformanceAggregator


def _make_fb(**kwargs) -> FeedbackResponse:
    defaults = dict(
        session_id="sess1",
        scenario_id="sc1",
        scenario_title="Test",
        user_id="user1",
        outcome="success",
        final_trust=80,
        final_escalation=1,
        total_turns=3,
        turn_metrics=[
            TurnMetric(
                turn=1,
                assertiveness_score=0.7,
                empathy_score=0.6,
                clarity_score=0.8,
                response_quality=0.75,
            )
        ],
        coaching_advice=CoachingAdvice(overall_rating="good", summary="OK"),
    )
    defaults.update(kwargs)
    return FeedbackResponse(**defaults)


def _make_nudge(category="volume", severity="critical", confidence=0.5) -> McaNudge:
    return McaNudge(
        emotion="neutral",
        confidence=confidence,
        nudge_category=category,
        nudge_severity=severity,
    )


# --- RPE feedback ---

def test_rpe_success_maps_outcome():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(outcome="success"))
    assert signal.outcome == "success"
    assert signal.objective_completion_rate == 1.0


def test_rpe_failure_maps_outcome():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(outcome="failure"))
    assert signal.outcome == "failure"
    assert signal.objective_completion_rate == 0.0


def test_rpe_unknown_outcome_maps_to_partial():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(outcome="incomplete"))
    assert signal.outcome == "partial"
    assert signal.objective_completion_rate == 0.5


def test_rpe_high_trust_raises_confidence():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(final_trust=90))
    assert signal.confidence_score >= 0.8


def test_rpe_low_trust_lowers_confidence():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(final_trust=10))
    assert signal.confidence_score <= 0.2


def test_rpe_high_escalation_raises_stress():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(final_escalation=4))
    assert signal.stress_level >= 0.9


def test_rpe_high_severity_flags_raise_stress():
    flags = [
        RiskFlag(flag_type="escalation", severity="critical", description="x"),
        RiskFlag(flag_type="conflict", severity="high", description="y"),
    ]
    signal = PerformanceAggregator.from_rpe_feedback(
        _make_fb(final_escalation=0, risk_flags=flags)
    )
    assert signal.stress_level > 0.0


def test_rpe_empty_turns_defaults_engagement():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(turn_metrics=[]))
    assert signal.engagement_score == 0.5


def test_rpe_all_values_in_range():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb())
    for attr in ("engagement_score", "confidence_score", "objective_completion_rate", "stress_level"):
        v = getattr(signal, attr)
        assert 0.0 <= v <= 1.0, f"{attr}={v} out of [0, 1]"


# --- MCA nudges ---

def test_mca_empty_nudges_neutral_defaults():
    signal = PerformanceAggregator.from_mca_nudges([])
    assert signal.engagement_score == 0.5
    assert signal.stress_level == 0.0
    assert signal.outcome == "partial"


def test_mca_criticals_raise_stress():
    nudges = [_make_nudge(severity="critical"), _make_nudge(severity="critical")]
    signal = PerformanceAggregator.from_mca_nudges(nudges)
    assert signal.stress_level > 0.5


def test_mca_volume_silence_clarity_drop_engagement():
    nudges = [
        _make_nudge(category="volume"),
        _make_nudge(category="silence"),
        _make_nudge(category="clarity"),
    ]
    signal = PerformanceAggregator.from_mca_nudges(nudges)
    assert signal.engagement_score < 1.0


def test_mca_outcome_always_partial():
    nudges = [_make_nudge(severity="info")]
    signal = PerformanceAggregator.from_mca_nudges(nudges)
    assert signal.outcome == "partial"


def test_mca_confidence_reflects_nudge_confidence():
    nudges = [_make_nudge(confidence=0.9), _make_nudge(confidence=0.9)]
    signal = PerformanceAggregator.from_mca_nudges(nudges)
    assert signal.confidence_score >= 0.8


def test_mca_all_values_in_range():
    nudges = [_make_nudge("volume", "critical", 0.7), _make_nudge("ser", "warning", 0.4)]
    signal = PerformanceAggregator.from_mca_nudges(nudges)
    for attr in ("engagement_score", "confidence_score", "objective_completion_rate", "stress_level"):
        v = getattr(signal, attr)
        assert 0.0 <= v <= 1.0, f"{attr}={v} out of [0, 1]"
