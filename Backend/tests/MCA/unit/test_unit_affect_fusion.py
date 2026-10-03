"""Unit tests for the multimodal (voice + face) fusion rules and their orchestrator."""
import numpy as np
import pytest

from app.api.v1.mca.affect_fusion import (
    AffectFusionAnalyzer,
    DeerInHeadlightsRule,
    DistractedPresenterRule,
    IncongruentSignalRule,
    MicFailureRule,
    OverlyAnimatedRule,
    SarcasmDetectionRule,
    ScriptReaderRule,
    TensePresenterRule,
)
from app.api.v1.mca.base_types import AudioFeatures

pytestmark = pytest.mark.unit


def _visual(yaw=0.0, pitch=0.0, roll=0.0, mar=0.2, ear=0.3):
    return {"pose": {"yaw": yaw, "pitch": pitch, "roll": roll}, "mar": mar, "ear": ear}


def _features(emotion="neutral", volume=0.05, zcr=0.05, pitch_std=20.0, visual=None):
    f = AudioFeatures(
        audio_data=np.zeros(10, dtype=np.float32),
        sample_rate=22050,
        avg_volume=volume,
        pitch_hz=150.0,
        zero_crossing_rate=zcr,
        spectral_centroid=1500.0,
        duration_ms=3000.0,
        pitch_std=pitch_std,
        emotion_label=emotion,
    )
    f.visual_metrics = _visual() if visual is None else visual
    return f


class TestFusionRulesPositive:
    def test_distracted_presenter(self):
        nudge = DistractedPresenterRule().evaluate(_features("neutral", visual=_visual(yaw=-0.3)))
        assert nudge is not None and nudge.severity == "warning"

    def test_tense_presenter(self):
        nudge = TensePresenterRule().evaluate(_features("fearful", visual=_visual(mar=0.05)))
        assert nudge is not None and nudge.severity == "critical"

    def test_script_reader(self):
        nudge = ScriptReaderRule().evaluate(_features("neutral", pitch_std=10.0, visual=_visual(pitch=0.2)))
        assert nudge is not None and "monotone" in nudge.message

    def test_deer_in_headlights(self):
        nudge = DeerInHeadlightsRule().evaluate(_features("surprised", visual=_visual(ear=0.4)))
        assert nudge is not None and "frozen" in nudge.message

    def test_mic_failure(self):
        nudge = MicFailureRule().evaluate(_features(volume=0.002, visual=_visual(mar=0.3)))
        assert nudge is not None and "microphone" in nudge.message

    def test_overly_animated(self):
        nudge = OverlyAnimatedRule().evaluate(_features("happy", zcr=0.2, visual=_visual(roll=0.3)))
        assert nudge is not None and nudge.severity == "info"

    def test_incongruent_signal(self):
        nudge = IncongruentSignalRule().evaluate(_features("disgust", visual=_visual(mar=0.6)))
        assert nudge is not None and "mixed signals" in nudge.message

    def test_sarcasm_detection(self):
        nudge = SarcasmDetectionRule().evaluate(_features("angry", visual=_visual(mar=0.45, roll=0.25)))
        assert nudge is not None and "sarcastic" in nudge.message


class TestFusionRulesNegative:
    def test_distracted_rule_needs_neutral_voice(self):
        # NEGATIVE: the rule fires only on a calm (neutral) voice. A happy
        # speaker looking around is animated, not distracted.
        assert DistractedPresenterRule().evaluate(_features("happy", visual=_visual(yaw=0.3))) is None

    def test_distracted_rule_missing_pose_defaults_to_facing_camera(self):
        # NEGATIVE: no pose data means yaw defaults to 0 (facing forward).
        # Missing data must not be read as "looking away".
        assert DistractedPresenterRule().evaluate(_features("neutral", visual={})) is None

    def test_tense_rule_relaxed_mouth(self):
        # NEGATIVE: stressed tone but an open/relaxed mouth (MAR >= 0.1) is
        # not the "tense face" pattern, so no critical nudge.
        assert TensePresenterRule().evaluate(_features("angry", visual=_visual(mar=0.3))) is None

    def test_script_reader_zero_pitch_std_is_no_data(self):
        # NEGATIVE: pitch_std == 0 means no voiced frames were measured. That
        # is missing data, not a monotone voice, so the rule requires > 0.
        assert ScriptReaderRule().evaluate(_features("neutral", pitch_std=0.0, visual=_visual(pitch=0.3))) is None

    def test_deer_rule_head_moving(self):
        # NEGATIVE: "frozen" needs a still head. Yaw 0.2 means the learner
        # is moving, so they are not frozen.
        assert DeerInHeadlightsRule().evaluate(_features("fearful", visual=_visual(ear=0.4, yaw=0.2))) is None

    def test_mic_failure_mouth_closed(self):
        # NEGATIVE: low audio with a closed mouth is just a quiet learner, not
        # a broken microphone.
        assert MicFailureRule().evaluate(_features(volume=0.002, visual=_visual(mar=0.05))) is None

    def test_mic_failure_head_turned_away(self):
        # NEGATIVE: with the head turned (yaw >= 0.2) the mouth landmarks are
        # unreliable, so mouth movement can't prove the learner is speaking.
        assert MicFailureRule().evaluate(_features(volume=0.002, visual=_visual(mar=0.3, yaw=0.5))) is None

    def test_overly_animated_needs_fast_pace(self):
        # NEGATIVE: lively head movement with normal pacing is good energy,
        # not "overly animated".
        assert OverlyAnimatedRule().evaluate(_features("happy", zcr=0.05, visual=_visual(roll=0.3))) is None

    def test_incongruent_needs_negative_tone(self):
        # NEGATIVE: smiling with a happy voice is congruent, so there is no
        # mismatch to report.
        assert IncongruentSignalRule().evaluate(_features("happy", visual=_visual(mar=0.6))) is None

    def test_sarcasm_needs_head_tilt(self):
        # NEGATIVE: without the head roll cue it's the incongruent pattern
        # only. Sarcasm needs all three signals.
        assert SarcasmDetectionRule().evaluate(_features("angry", visual=_visual(mar=0.45, roll=0.0))) is None


class TestAffectFusionAnalyzerPositive:
    def test_first_matching_rule_wins(self):
        # Neutral + looking away -> DistractedPresenter (MicFailure doesn't match).
        nudge = AffectFusionAnalyzer().analyze(_features("neutral", visual=_visual(yaw=0.3)))
        assert nudge is not None
        assert nudge.category == "fusion"
        assert "looking away" in nudge.message

    def test_mic_failure_runs_even_when_silent(self):
        # The voice gate must not hide the one rule that detects a dead mic.
        nudge = AffectFusionAnalyzer().analyze(_features(volume=0.002, visual=_visual(mar=0.3)))
        assert nudge is not None and "microphone" in nudge.message


class TestAffectFusionAnalyzerNegative:
    def test_no_face_data_returns_none(self):
        # NEGATIVE: camera off / face not found means no visual channel.
        # Fusion needs both channels, so nothing can be fused.
        f = _features("angry", visual=_visual(mar=0.05))
        f.visual_metrics = None
        assert AffectFusionAnalyzer().analyze(f) is None

    def test_empty_face_dict_returns_none(self):
        # NEGATIVE: an empty metrics dict is as good as no face.
        assert AffectFusionAnalyzer().analyze(_features("neutral", visual={})) is None

    def test_emotional_rules_skipped_when_not_talking(self):
        # NEGATIVE: under the voice gate the "emotion" comes from background
        # noise. Emotional rules must not fire on it (would be a false positive).
        f = _features("neutral", volume=0.01, visual=_visual(yaw=0.4, mar=0.0))
        assert AffectFusionAnalyzer().analyze(f) is None
