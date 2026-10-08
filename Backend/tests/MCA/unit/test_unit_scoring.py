"""Unit tests for the rule-based scoring helpers and calculate_session_metrics edge cases.

The happy-path model behaviour is covered in tests/MCA/test_mca_scoring.py.
This file targets input handling: odd, partial or malformed client data.
"""
import pytest

from app.api.v1.mca.scoring import (
    SCORING_VERSION,
    _confidence,
    _elapsed,
    _issue_tag,
    _rate,
    calculate_session_metrics,
    clamp,
    combine_breakdown_to_overall,
)

pytestmark = pytest.mark.unit

_DIMS = ("vocal_command", "speech_fluency", "presence_engagement", "emotional_regulation")


def _chunk(t, speaking=True, face=True, detections=(), emotion=None, confidence=None):
    return {
        "elapsed_seconds": t, "speaking": speaking, "face_visible": face,
        "emotion": emotion, "confidence": confidence, "detections": list(detections),
    }


class TestScoringHelpersPositive:
    def test_issue_tag_is_case_insensitive(self):
        assert _issue_tag({"category": "PACE"}) == "pace"
        assert _issue_tag({"category": "Fusion", "message": "Look at the AUDIENCE"}) == "presence"

    def test_elapsed_parses_numeric_strings(self):
        assert _elapsed({"elapsed_seconds": "12.5"}) == 12.5

    def test_confidence_keeps_valid_probability(self):
        assert _confidence(0.42) == 0.42

    def test_rate(self):
        assert _rate(1, 3) == round(1 / 3, 4)

    def test_overall_rounds_mean(self):
        assert combine_breakdown_to_overall(
            {"vocal_command": 51, "speech_fluency": 50, "presence_engagement": 50, "emotional_regulation": 50}
        ) == 50


class TestScoringHelpersNegative:
    def test_unknown_category_defaults_to_vocal(self):
        # NEGATIVE: a category the scorer doesn't know (e.g. from a newer
        # analyzer) must still be counted somewhere rather than raising.
        assert _issue_tag({"category": "mystery"}) == "vocal"

    def test_missing_category_defaults_to_vocal(self):
        # NEGATIVE: a malformed detection without a category is tolerated.
        assert _issue_tag({}) == "vocal"

    @pytest.mark.parametrize("bad", [None, "abc", [], {}])
    def test_elapsed_bad_values_become_zero(self, bad):
        # NEGATIVE: non-numeric timestamps from the client must not crash
        # scoring. They fall back to t=0.
        assert _elapsed({"elapsed_seconds": bad}) == 0.0

    def test_elapsed_missing_key_is_zero(self):
        # NEGATIVE: older clients omit elapsed_seconds entirely.
        assert _elapsed({}) == 0.0

    @pytest.mark.parametrize("value, expected", [(1.7, 1.0), (-0.3, 0.0)])
    def test_confidence_out_of_range_is_clamped(self, value, expected):
        # NEGATIVE: a probability outside [0, 1] is invalid. It's clamped
        # so it can't inflate or flip the affect balance.
        assert _confidence(value) == expected

    @pytest.mark.parametrize("value", [None, "high", object()])
    def test_confidence_non_numeric_defaults_to_full_weight(self, value):
        # NEGATIVE: unknown confidence means the reading is taken at face
        # value (weight 1.0) rather than dropped or crashing.
        assert _confidence(value) == 1.0

    def test_rate_with_zero_denominator(self):
        # NEGATIVE: no eligible intervals means no rate, not ZeroDivisionError.
        assert _rate(0, 0) == 0.0

    def test_clamp_rejects_out_of_range(self):
        # NEGATIVE: scores outside 0-100 are invalid output.
        assert clamp(1e9) == 100
        assert clamp(-1e9) == 0

    def test_overall_missing_dimension_raises(self):
        # NEGATIVE: the overall score is only defined for all four skills.
        # A partial breakdown is a programming error and must fail loudly.
        with pytest.raises(KeyError):
            combine_breakdown_to_overall({"vocal_command": 80})


class TestCalculateSessionMetricsPositive:
    def test_observation_log_is_preferred_over_legacy_logs(self):
        metrics = calculate_session_metrics(
            nudge_log=[{"category": "volume", "message": "x"}],
            emotion_distribution={},
            observation_log=[_chunk(0)],
            behavior_log=[{"category": "pace", "message": "y", "elapsed_seconds": 0}],
        )
        assert metrics["diagnostics"]["evidence_source"] == "observation_log"

    def test_out_of_order_observations_are_sorted(self):
        # speak / pause / speak, delivered shuffled -> still one hesitation.
        pause = {"category": "silence", "message": "Take your time!"}
        metrics = calculate_session_metrics([], {}, observation_log=[
            _chunk(6), _chunk(0), _chunk(3, speaking=False, detections=[pause]),
        ])
        assert metrics["diagnostics"]["obp_per_dimension"]["fluency"] == round(1 / 3, 4)

    def test_emotion_distribution_only_session_is_scored(self):
        metrics = calculate_session_metrics([], {"happy": 1.0}, duration_seconds=30)
        assert metrics["diagnostics"]["evidence_source"] == "emotion_distribution"
        assert metrics["breakdown"]["emotional_regulation"] > 50

    def test_diagnostics_contain_version(self):
        metrics = calculate_session_metrics([], {}, observation_log=[_chunk(0)])
        assert metrics["diagnostics"]["scoring_version"] == SCORING_VERSION


class TestCalculateSessionMetricsNegative:
    def test_none_inputs_are_treated_as_empty(self):
        # NEGATIVE: the API may pass None for any optional log. That must
        # mean "no evidence" (neutral 50s), not a TypeError.
        metrics = calculate_session_metrics(None, None, observation_log=None, behavior_log=None)
        assert metrics["overall"] == 50
        assert metrics["diagnostics"]["evidence_source"] == "none"

    def test_zero_duration_session(self):
        # NEGATIVE: a session ended immediately (0 s) has no expected
        # intervals and must not divide by zero.
        metrics = calculate_session_metrics([], {}, duration_seconds=0)
        assert metrics["diagnostics"]["session_minutes"] == 0.0
        assert metrics["diagnostics"]["max_opportunities"] == 0

    def test_malformed_observation_fields_are_tolerated(self):
        # NEGATIVE: a buggy client sends wrong types (string time, None
        # detections, junk confidence). Scoring still runs with safe defaults.
        metrics = calculate_session_metrics([], {}, observation_log=[
            {"elapsed_seconds": "oops", "speaking": 1, "face_visible": None,
             "emotion": "ANGRY", "confidence": "?", "detections": None},
        ])
        assert set(metrics["breakdown"]) == set(_DIMS)
        assert metrics["diagnostics"]["emotion_valence_raw"] == -1.0  # emotion lower-cased

    def test_unknown_emotion_labels_are_neutral(self):
        # NEGATIVE: labels outside the valence map (e.g. "bored") carry no
        # sign, so they must not move emotional regulation away from 50.
        metrics = calculate_session_metrics([], {}, observation_log=[
            _chunk(3 * i, emotion="bored", confidence=1.0) for i in range(10)
        ])
        assert metrics["breakdown"]["emotional_regulation"] == 50

    def test_zero_weight_emotion_distribution_gives_no_evidence(self):
        # NEGATIVE: a distribution summing to 0 carries no information and
        # must not be read as a negative or positive session.
        metrics = calculate_session_metrics([], {"happy": 0.0, "sad": 0.0}, duration_seconds=30)
        assert metrics["breakdown"]["emotional_regulation"] == 50

    def test_silence_only_session_is_not_penalised(self):
        # NEGATIVE: a learner who only listened (all silent chunks) didn't
        # hesitate. Silence outside their own speech is not a fluency issue.
        pause = {"category": "silence", "message": "Take your time!"}
        metrics = calculate_session_metrics([], {}, observation_log=[
            _chunk(3 * i, speaking=False, detections=[pause]) for i in range(10)
        ])
        assert metrics["breakdown"]["speech_fluency"] == 50
        assert metrics["diagnostics"]["obp_per_dimension"]["fluency"] == 0.0
