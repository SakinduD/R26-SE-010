"""Nudges must reflect the current chunk; the cooldown only limits how often a new one pops up."""
import time
from unittest.mock import patch

import pytest

from app.api.v1.mca.base_types import AudioAnalyzer, AudioFeatures, Nudge
from app.api.v1.mca.nudge_engine import NudgeEngine, SerAnalyzer

_INFO = Nudge("Speaking rapidly.", "pace", "info")
_INFO_2 = Nudge("High energy!", "pitch", "info")
_CRITICAL = Nudge("Check your microphone.", "fusion", "critical")


class _Scripted(AudioAnalyzer):
    """Returns whatever nudge the test sets for the current chunk."""
    def __init__(self):
        self.next = None

    def analyze(self, features):
        return self.next


def _features():
    return AudioFeatures(
        audio_data=b"", sample_rate=16000, avg_volume=0.05, pitch_hz=150.0,
        zero_crossing_rate=0.05, spectral_centroid=1500.0, duration_ms=3000.0,
    )


@pytest.fixture
def clock(monkeypatch):
    now = {"t": 1000.0}
    monkeypatch.setattr(time, "time", lambda: now["t"])
    return now


@pytest.fixture
def engine():
    a, b = _Scripted(), _Scripted()
    return NudgeEngine(analyzers=[a, b]), a, b


def test_first_behaviour_fires_immediately(clock, engine):
    eng, a, _ = engine
    a.next = _INFO
    assert eng.evaluate(_features()) == _INFO


def test_cooldown_holds_back_equal_severity_but_not_detection(clock, engine):
    eng, a, b = engine
    a.next = _INFO
    eng.evaluate(_features())

    clock["t"] += 3
    a.next, b.next = _INFO, _INFO_2
    assert eng.evaluate(_features()) is None
    # Still reported every chunk, so the screen and the scoring stay current.
    assert set(eng.active_messages) == {_INFO.message, _INFO_2.message}

    clock["t"] += 9   # cooldown over
    assert eng.evaluate(_features()) is not None


def test_more_severe_behaviour_escalates_through_cooldown(clock, engine):
    eng, a, b = engine
    a.next = _INFO
    eng.evaluate(_features())

    clock["t"] += 3
    b.next = _CRITICAL
    assert eng.evaluate(_features()) == _CRITICAL

    # ...but it can't be used to bypass the cooldown again at the same level.
    clock["t"] += 3
    assert eng.evaluate(_features()) is None


def test_resolved_behaviour_leaves_active_list_during_cooldown(clock, engine):
    eng, a, _ = engine
    a.next = _INFO
    eng.evaluate(_features())

    clock["t"] += 3
    a.next = None
    eng.evaluate(_features())
    assert eng.active_messages == []


def test_ser_model_loaded_once_and_shared():
    config = "tests/does-not-exist/model_config.json"
    SerAnalyzer._cache.pop(config, None)
    with patch.object(SerAnalyzer, "_load_model", autospec=True) as load:
        SerAnalyzer(config_path=config)
        SerAnalyzer(config_path=config)
    assert load.call_count == 1
    SerAnalyzer._cache.pop(config, None)
