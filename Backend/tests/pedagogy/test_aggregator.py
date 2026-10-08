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
            TurnMetric(  # RPE scores turns 0-10
                turn=1,
                assertiveness_score=7.0,
                empathy_score=6.0,
                clarity_score=8.0,
                response_quality=7.5,
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
    # RPE escalation is 0-5; 5 is the ceiling.
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(final_escalation=5))
    assert signal.stress_level >= 0.9


def test_rpe_escalation_is_read_on_its_0_to_5_scale():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(final_escalation=3))
    assert signal.stress_level == pytest.approx(0.6)


def test_rpe_turn_scores_are_read_on_their_0_to_10_scale():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(turn_metrics=[
        TurnMetric(turn=1, assertiveness_score=2, empathy_score=2, clarity_score=5, response_quality=3.0),
        TurnMetric(turn=2, assertiveness_score=6, empathy_score=3, clarity_score=9, response_quality=5.0),
    ]))
    assert signal.engagement_score == pytest.approx(0.4)


def test_rpe_zero_trust_is_not_read_as_missing():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(final_trust=0))
    assert signal.confidence_score == pytest.approx(0.0)


def test_rpe_missing_trust_is_neutral():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(final_trust=None))
    assert signal.confidence_score == pytest.approx(0.5)


def test_rpe_ended_by_user_maps_to_partial():
    signal = PerformanceAggregator.from_rpe_feedback(_make_fb(outcome="ended_by_user"))
    assert signal.outcome == "partial"
    assert signal.objective_completion_rate == pytest.approx(0.5)


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


# --- real MCA audio frames (issue 7) ---

# The `metrics` object of an MCA audio WebSocket frame (app/api/v1/mca/audio.py)
# for a chunk where the learner was silent but a nudge fired.
_SILENT_NUDGE_FRAME = {
    "emotion": None,
    "confidence": 0.0,
    "speaking": False,
    "face_visible": True,
    "nudge": "Long silence. Try to keep the conversation going.",
    "nudge_category": "silence",
    "nudge_severity": "info",
    "active_nudges": [],
    "detections": [],
}


def test_real_mca_frame_without_emotion_is_accepted():
    nudge = McaNudge(**_SILENT_NUDGE_FRAME)
    assert nudge.emotion is None
    assert nudge.nudge_category == "silence"


def test_silent_frames_do_not_drag_confidence_down():
    """Frames without an emotion reading carry confidence 0.0, which is not a reading."""
    nudges = [McaNudge(**_SILENT_NUDGE_FRAME), _make_nudge(confidence=0.8)]
    signal = PerformanceAggregator.from_mca_nudges(nudges)
    assert signal.confidence_score == pytest.approx(0.8)


def test_no_emotion_readings_give_neutral_confidence():
    signal = PerformanceAggregator.from_mca_nudges([McaNudge(**_SILENT_NUDGE_FRAME)])
    assert signal.confidence_score == pytest.approx(0.5)
