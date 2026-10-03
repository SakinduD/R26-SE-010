"""Unit tests for the single-dimension audio analyzers in nudge_engine.py.

Each analyzer gets an AudioFeatures snapshot and returns a Nudge or None.
Positive cases: the threshold is crossed and the right nudge comes back.
Negative cases: input the analyzer must ignore (noise, silence, normal speech).
"""
import numpy as np
import pytest

from app.api.v1.mca.base_types import AudioFeatures
from app.api.v1.mca.nudge_engine import (
    ClarityAnalyzer,
    PaceAnalyzer,
    PitchAnalyzer,
    SerAnalyzer,
    SilenceAnalyzer,
    VolumeAnalyzer,
)

pytestmark = pytest.mark.unit


def _features(volume=0.05, pitch=150.0, zcr=0.05, centroid=1500.0):
    """Normal, clean speech unless a test overrides one value."""
    return AudioFeatures(
        audio_data=np.zeros(10, dtype=np.float32),
        sample_rate=22050,
        avg_volume=volume,
        pitch_hz=pitch,
        zero_crossing_rate=zcr,
        spectral_centroid=centroid,
        duration_ms=3000.0,
    )


# VolumeAnalyzer

class TestVolumeAnalyzerPositive:
    def test_quiet_voice_asks_to_speak_up(self):
        nudge = VolumeAnalyzer().analyze(_features(volume=0.02))
        assert nudge is not None
        assert nudge.category == "volume"
        assert nudge.severity == "warning"
        assert "quiet" in nudge.message.lower()

    def test_loud_voice_asks_for_conversational_tone(self):
        nudge = VolumeAnalyzer().analyze(_features(volume=0.25))
        assert nudge is not None
        assert "conversational" in nudge.message.lower()

    def test_normal_volume_gives_no_nudge(self):
        assert VolumeAnalyzer().analyze(_features(volume=0.05)) is None


class TestVolumeAnalyzerNegative:
    def test_below_noise_floor_is_ignored(self):
        # NEGATIVE: RMS under NOISE_FLOOR (0.012) is background noise / no speaker.
        # Telling a silent room to "speak up" would be a false positive.
        assert VolumeAnalyzer().analyze(_features(volume=0.005)) is None

    def test_exactly_noise_floor_is_not_quiet(self):
        # NEGATIVE: the quiet check is strict (NOISE_FLOOR < v), so the
        # boundary value itself must not fire.
        assert VolumeAnalyzer().analyze(_features(volume=VolumeAnalyzer.NOISE_FLOOR)) is None

    def test_exactly_high_threshold_is_not_loud(self):
        # NEGATIVE: "too loud" is strictly greater than HIGH_THRESHOLD.
        assert VolumeAnalyzer().analyze(_features(volume=VolumeAnalyzer.HIGH_THRESHOLD)) is None


# PitchAnalyzer

class TestPitchAnalyzerPositive:
    def test_high_pitch_while_speaking_fires_info(self):
        nudge = PitchAnalyzer().analyze(_features(pitch=400.0))
        assert nudge is not None
        assert nudge.category == "pitch"
        assert nudge.severity == "info"


class TestPitchAnalyzerNegative:
    def test_high_pitch_below_voice_gate_is_ignored(self):
        # NEGATIVE: under the voice gate the "pitch" is breathing or noise,
        # not the learner's voice, so it must not be judged.
        assert PitchAnalyzer().analyze(_features(volume=0.01, pitch=400.0)) is None

    def test_normal_pitch_is_not_flagged(self):
        # NEGATIVE: 200 Hz is a normal speaking pitch, nothing to coach.
        assert PitchAnalyzer().analyze(_features(pitch=200.0)) is None

    def test_no_detected_pitch_is_not_flagged(self):
        # NEGATIVE: pitch 0.0 means YIN found no voiced frames. That is
        # missing data, not a pitch problem.
        assert PitchAnalyzer().analyze(_features(pitch=0.0)) is None


# PaceAnalyzer

class TestPaceAnalyzerPositive:
    def test_high_zero_crossing_rate_means_fast_speech(self):
        nudge = PaceAnalyzer().analyze(_features(zcr=0.25))
        assert nudge is not None
        assert nudge.category == "pace"


class TestPaceAnalyzerNegative:
    def test_fast_zcr_while_silent_is_ignored(self):
        # NEGATIVE: hiss or fan noise has a high ZCR. Below the voice gate
        # it is not speech, so pace cannot be judged.
        assert PaceAnalyzer().analyze(_features(volume=0.005, zcr=0.25)) is None

    def test_normal_pace_is_not_flagged(self):
        # NEGATIVE: ZCR 0.05 is inside the normal voiced-speech range.
        assert PaceAnalyzer().analyze(_features(zcr=0.05)) is None


# ClarityAnalyzer

class TestClarityAnalyzerPositive:
    def test_low_centroid_means_muffled_mic(self):
        nudge = ClarityAnalyzer().analyze(_features(centroid=800.0))
        assert nudge is not None
        assert "muffled" in nudge.message.lower()

    def test_high_centroid_means_background_noise(self):
        nudge = ClarityAnalyzer().analyze(_features(centroid=6000.0))
        assert nudge is not None
        assert "noise" in nudge.message.lower()


class TestClarityAnalyzerNegative:
    def test_muffled_spectrum_while_silent_is_ignored(self):
        # NEGATIVE: with no speech there is nothing to be "unclear", so the
        # voice gate must suppress the clarity check.
        assert ClarityAnalyzer().analyze(_features(volume=0.005, centroid=500.0)) is None

    def test_centroid_in_speech_band_is_clear(self):
        # NEGATIVE: 1-5 kHz is the intelligibility band, which is fine.
        assert ClarityAnalyzer().analyze(_features(centroid=2500.0)) is None


# SilenceAnalyzer

class TestSilenceAnalyzerPositive:
    def test_near_silence_is_a_hesitation(self):
        nudge = SilenceAnalyzer().analyze(_features(volume=0.004))
        assert nudge is not None
        assert nudge.category == "silence"


class TestSilenceAnalyzerNegative:
    def test_complete_silence_is_standby_not_hesitation(self):
        # NEGATIVE: RMS <= 0.001 is a muted/idle mic (standby), not a
        # learner pausing mid-thought, so no hesitation nudge.
        assert SilenceAnalyzer().analyze(_features(volume=0.0005)) is None

    def test_normal_speech_is_not_silence(self):
        # NEGATIVE: the learner is speaking, so there is no silence.
        assert SilenceAnalyzer().analyze(_features(volume=0.05)) is None


# SerAnalyzer

class TestSerAnalyzerNegative:
    def test_ser_analyzer_never_produces_a_nudge(self):
        # NEGATIVE: SerAnalyzer only classifies emotion (inference runs in
        # NudgeEngine.evaluate). It must never emit a coaching nudge itself.
        ser = SerAnalyzer.__new__(SerAnalyzer)
        assert ser.analyze(_features()) is None
