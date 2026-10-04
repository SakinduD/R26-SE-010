"""Unit tests for NudgeEngine orchestration, SER model selection and feature extraction."""
import json
import time
from unittest.mock import MagicMock

import numpy as np
import pytest

from app.api.v1.mca.base_types import AudioAnalyzer, AudioFeatures, Nudge
from app.api.v1.mca.nudge_engine import AudioFeatureExtractor, NudgeEngine, SerAnalyzer

pytestmark = pytest.mark.unit

_INFO_PACE = Nudge("Speaking rapidly.", "pace", "info")
_INFO_PITCH = Nudge("High energy!", "pitch", "info")
_WARNING = Nudge("A bit quiet.", "volume", "warning")
_CRITICAL = Nudge("Check your microphone.", "fusion", "critical")


class _Fixed(AudioAnalyzer):
    """Returns the nudge set on it for the current chunk."""
    def __init__(self, nudge=None):
        self.next = nudge

    def analyze(self, features):
        return self.next


def _features(volume=0.05, feature_vector=None):
    return AudioFeatures(
        audio_data=np.zeros(10, dtype=np.float32),
        sample_rate=22050,
        avg_volume=volume,
        pitch_hz=150.0,
        zero_crossing_rate=0.05,
        spectral_centroid=1500.0,
        duration_ms=3000.0,
        feature_vector=feature_vector,
    )


@pytest.fixture
def clock(monkeypatch):
    now = {"t": 5000.0}
    monkeypatch.setattr(time, "time", lambda: now["t"])
    return now


# NudgeEngine

class TestNudgeEnginePositive:
    def test_highest_severity_is_selected(self, clock):
        engine = NudgeEngine(analyzers=[_Fixed(_INFO_PACE), _Fixed(_CRITICAL), _Fixed(_WARNING)])
        assert engine.evaluate(_features()) == _CRITICAL

    def test_all_detections_reported_even_if_one_nudge_fires(self, clock):
        engine = NudgeEngine(analyzers=[_Fixed(_INFO_PACE), _Fixed(_WARNING)])
        engine.evaluate(_features())
        assert set(engine.active_messages) == {_INFO_PACE.message, _WARNING.message}

    def test_tie_goes_to_least_recently_shown_category(self, clock):
        engine = NudgeEngine(analyzers=[_Fixed(_INFO_PACE), _Fixed(_INFO_PITCH)])
        engine.category_last_fired = {"pace": 4000.0, "pitch": 1000.0}
        assert engine.evaluate(_features()).category == "pitch"

    def test_new_nudge_allowed_after_cooldown(self, clock):
        a = _Fixed(_INFO_PACE)
        engine = NudgeEngine(analyzers=[a])
        assert engine.evaluate(_features()) is not None
        clock["t"] += engine.COOLDOWN_SECONDS + 0.1
        assert engine.evaluate(_features()) == _INFO_PACE

    def test_visual_metrics_attached_to_features(self, clock):
        engine = NudgeEngine(analyzers=[_Fixed()])
        f = _features()
        engine.evaluate(f, {"mar": 0.2})
        assert f.visual_metrics == {"mar": 0.2}

    def test_ser_emotion_inferred_with_svm(self, clock):
        engine = NudgeEngine(analyzers=[_Fixed()])
        ser = MagicMock(model_kind="svm", EMOTION_MAP=SerAnalyzer.EMOTION_MAP)
        ser.model.predict.return_value = [1]
        ser.model.predict_proba.return_value = [[0.1, 0.8, 0.1]]
        engine.ser_analyzer = ser

        f = _features(feature_vector=np.zeros(362))
        engine.evaluate(f)
        assert f.emotion_label == "happy"
        assert f.emotion_confidence == pytest.approx(0.8)


class TestNudgeEngineNegative:
    def test_no_detections_returns_none_and_clears_history(self, clock):
        # NEGATIVE: a clean chunk has nothing to coach, and stale sustain
        # counts must not carry over to a later chunk.
        engine = NudgeEngine(analyzers=[_Fixed()])
        engine.behavior_history = {"old": 3}
        assert engine.evaluate(_features()) is None
        assert engine.behavior_history == {}
        assert engine.active_messages == []

    def test_equal_severity_blocked_during_cooldown(self, clock):
        # NEGATIVE: a second info nudge 3 s after the first would spam the
        # learner. The cooldown must hold it back.
        a = _Fixed(_INFO_PACE)
        engine = NudgeEngine(analyzers=[a])
        engine.evaluate(_features())
        clock["t"] += 3
        a.next = _INFO_PITCH
        assert engine.evaluate(_features()) is None

    def test_lower_severity_blocked_during_cooldown(self, clock):
        # NEGATIVE: after a critical nudge, a minor info issue must not
        # interrupt within the cooldown window.
        a = _Fixed(_CRITICAL)
        engine = NudgeEngine(analyzers=[a])
        engine.evaluate(_features())
        clock["t"] += 2
        a.next = _INFO_PACE
        assert engine.evaluate(_features()) is None

    def test_behaviour_not_sustained_yet(self, clock):
        # NEGATIVE: with SUSTAIN_THRESHOLD=2, a one-chunk blip is not yet a
        # sustained behaviour, so no nudge on the first chunk.
        engine = NudgeEngine(analyzers=[_Fixed(_WARNING)])
        engine.SUSTAIN_THRESHOLD = 2
        assert engine.evaluate(_features()) is None
        assert engine.behavior_history == {_WARNING.message: 1}

    def test_ser_skipped_when_learner_not_speaking(self, clock):
        # NEGATIVE: below the speech gate, emotion inference would classify
        # background noise. The model must not even be called.
        engine = NudgeEngine(analyzers=[_Fixed()])
        ser = MagicMock(model_kind="svm")
        engine.ser_analyzer = ser
        f = _features(volume=0.005, feature_vector=np.zeros(362))
        engine.evaluate(f)
        ser.model.predict.assert_not_called()
        assert f.emotion_label is None

    def test_ser_inference_error_is_swallowed(self, clock):
        # NEGATIVE: a broken model must not crash the live stream. Emotion
        # just stays unknown and the other analyzers still run.
        engine = NudgeEngine(analyzers=[_Fixed(_WARNING)])
        ser = MagicMock(model_kind="svm")
        ser.model.predict.side_effect = ValueError("bad shape")
        engine.ser_analyzer = ser
        f = _features(feature_vector=np.zeros(362))
        assert engine.evaluate(f) == _WARNING
        assert f.emotion_label is None

    def test_ser_skipped_when_required_input_missing(self, clock):
        # NEGATIVE: an SVM model with no 362-dim feature vector (extraction
        # failed) has nothing to classify, so it must be skipped.
        engine = NudgeEngine(analyzers=[_Fixed()])
        ser = MagicMock(model_kind="svm")
        engine.ser_analyzer = ser
        engine.evaluate(_features(feature_vector=None))
        ser.model.predict.assert_not_called()

    def test_empty_visual_dict_is_treated_as_no_face(self, clock):
        # NEGATIVE: {} carries no face data and must become None so fusion
        # rules don't run on an empty face.
        engine = NudgeEngine(analyzers=[_Fixed()])
        f = _features()
        engine.evaluate(f, {})
        assert f.visual_metrics is None


# SerAnalyzer model selection

def _ser_with_config(path) -> SerAnalyzer:
    ser = SerAnalyzer.__new__(SerAnalyzer)  # skip __init__ so nothing loads
    ser.config_path = str(path)
    return ser


class TestSerModelSelectionPositive:
    def test_enabled_model_is_selected(self, tmp_path):
        cfg = tmp_path / "model_config.json"
        cfg.write_text(json.dumps({
            "svm": {"enabled": False, "path": "svm.pkl"},
            "cnn": {"enabled": True, "path": "cnn.pkl"},
        }))
        assert _ser_with_config(cfg)._resolve_model_path() == ("cnn", "cnn.pkl")

    def test_first_of_multiple_enabled_models_is_used(self, tmp_path):
        cfg = tmp_path / "model_config.json"
        cfg.write_text(json.dumps({
            "wav2vec2": {"enabled": True, "path": "w2v"},
            "svm": {"enabled": True, "path": "svm.pkl"},
        }))
        assert _ser_with_config(cfg)._resolve_model_path() == ("wav2vec2", "w2v")


class TestSerModelSelectionNegative:
    def test_missing_config_falls_back_to_svm(self, tmp_path):
        # NEGATIVE: the config file doesn't exist. Startup must not crash,
        # it falls back to the bundled SVM path.
        ser = _ser_with_config(tmp_path / "nope.json")
        assert ser._resolve_model_path() == ("svm", SerAnalyzer.FALLBACK_MODEL_PATH)

    def test_corrupt_config_falls_back_to_svm(self, tmp_path):
        # NEGATIVE: the config is not valid JSON, so the fallback is used
        # instead of raising.
        cfg = tmp_path / "model_config.json"
        cfg.write_text("{not json")
        assert _ser_with_config(cfg)._resolve_model_path() == ("svm", SerAnalyzer.FALLBACK_MODEL_PATH)

    def test_nothing_enabled_falls_back_to_svm(self, tmp_path):
        # NEGATIVE: every model is disabled, so there is no explicit choice.
        cfg = tmp_path / "model_config.json"
        cfg.write_text(json.dumps({"svm": {"enabled": False, "path": "x.pkl"}}))
        assert _ser_with_config(cfg)._resolve_model_path() == ("svm", SerAnalyzer.FALLBACK_MODEL_PATH)

    def test_model_file_missing_disables_emotion(self, tmp_path):
        # NEGATIVE: the selected model path doesn't exist on disk. Emotion
        # detection is disabled (model None) rather than crashing the server.
        cfg = tmp_path / "model_config.json"
        cfg.write_text(json.dumps({"svm": {"enabled": True, "path": str(tmp_path / "missing.pkl")}}))
        ser = _ser_with_config(cfg)
        ser.model = None
        ser.feature_extractor = None
        ser._load_model()
        assert ser.model is None


# AudioFeatureExtractor

class TestAudioFeatureExtractorNegative:
    def test_garbage_bytes_return_none(self):
        # NEGATIVE: bytes that aren't a WebM/Opus container can't be decoded.
        # The extractor must return None instead of raising into the WebSocket loop.
        assert AudioFeatureExtractor().extract(b"definitely not audio") is None

    def test_empty_bytes_return_none(self):
        # NEGATIVE: an empty frame (e.g. a MediaRecorder hiccup) has no audio.
        assert AudioFeatureExtractor().extract(b"") is None
