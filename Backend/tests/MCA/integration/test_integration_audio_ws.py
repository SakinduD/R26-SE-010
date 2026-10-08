"""Integration tests for the real-time audio-analysis WebSocket.

The WebSocket, the real NudgeEngine and its real analyzers all run. Three
things are stubbed:
- verify_jwt (no Supabase JWKS call),
- the audio decoder (returns a prepared AudioFeatures, since the tests can't ship WebM fixtures),
- the SER model (the engine is built without SerAnalyzer, so no model is loaded).
"""
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi import HTTPException
from starlette.websockets import WebSocketDisconnect

from app.api.v1.mca.affect_fusion import AffectFusionAnalyzer
from app.api.v1.mca.base_types import AudioFeatures
from app.api.v1.mca.nudge_engine import (
    ClarityAnalyzer,
    NudgeEngine,
    PaceAnalyzer,
    PitchAnalyzer,
    SilenceAnalyzer,
    VolumeAnalyzer,
)

pytestmark = pytest.mark.integration

_WS = "/api/v1/mca/audio/audio-analysis"
_LOUD = "Strong volume! Try a conversational tone."
_AWAY = "Your voice is calm, but you are looking away from the audience."


def _features(volume=0.05, emotion=None):
    return AudioFeatures(
        audio_data=np.zeros(10, dtype=np.float32), sample_rate=22050, avg_volume=volume,
        pitch_hz=150.0, zero_crossing_rate=0.05, spectral_centroid=1500.0,
        duration_ms=3000.0, emotion_label=emotion,
    )


def _engine_without_ser():
    return NudgeEngine(analyzers=[
        AffectFusionAnalyzer(), VolumeAnalyzer(), PitchAnalyzer(),
        PaceAnalyzer(), ClarityAnalyzer(), SilenceAnalyzer(),
    ])


@pytest.fixture
def authed():
    payload = MagicMock(sub="11111111-1111-1111-1111-111111111111")
    with patch("app.api.v1.mca.audio.verify_jwt", return_value=payload):
        yield


@pytest.fixture
def engine():
    with patch("app.api.v1.mca.audio.NudgeEngine", side_effect=_engine_without_ser):
        yield


@pytest.fixture
def decoder():
    """Each audio frame decodes to whatever features the test queues up."""
    with patch("app.api.v1.mca.audio._extractor.extract") as extract:
        yield extract


@pytest.mark.usefixtures("authed", "engine")
class TestAudioStreamPositive:
    def test_loud_chunk_produces_volume_nudge(self, client, decoder):
        decoder.return_value = _features(volume=0.3)
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_bytes(b"chunk-1")
            resp = ws.receive_json()

        assert resp["status"] == "analyzed"
        assert resp["bytes"] == len(b"chunk-1")
        m = resp["metrics"]
        assert m["nudge"] == _LOUD
        assert m["nudge_category"] == "volume"
        assert m["nudge_severity"] == "warning"
        assert m["speaking"] is True
        assert m["face_visible"] is False          # no visual frame was sent
        assert {"message": _LOUD, "category": "volume", "severity": "warning"} in m["detections"]

    def test_visual_metrics_feed_fusion_rules(self, client, decoder):
        decoder.return_value = _features(volume=0.05, emotion="neutral")
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_json({"type": "visual_metrics", "session_id": "abc",
                          "metrics": {"pose": {"yaw": 0.4, "pitch": 0.0, "roll": 0.0}, "mar": 0.2, "ear": 0.3}})
            ws.send_bytes(b"chunk")
            m = ws.receive_json()["metrics"]

        assert m["face_visible"] is True
        assert m["nudge"] == _AWAY
        assert m["nudge_category"] == "fusion"
        assert m["emotion"] == "neutral"

    def test_cooldown_suppresses_repeat_nudge_but_keeps_detection(self, client, decoder):
        decoder.return_value = _features(volume=0.3)
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_bytes(b"chunk-1")
            first = ws.receive_json()["metrics"]
            decoder.return_value = _features(volume=0.3)
            ws.send_bytes(b"chunk-2")
            second = ws.receive_json()["metrics"]

        assert first["nudge"] == _LOUD
        assert second["nudge"] is None                 # still inside the 10 s cooldown
        assert second["active_nudges"] == [_LOUD]      # ...but the behaviour is still reported

    def test_clean_chunk_has_no_nudge(self, client, decoder):
        decoder.return_value = _features(volume=0.05)
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_bytes(b"chunk")
            m = ws.receive_json()["metrics"]
        assert m["nudge"] is None
        assert m["detections"] == []
        assert m["speaking"] is True


@pytest.mark.usefixtures("authed", "engine")
class TestAudioStreamNegative:
    def test_undecodable_audio_returns_bare_ack(self, client, decoder):
        # NEGATIVE: the chunk can't be decoded (extractor returns None). The
        # server acknowledges it without metrics instead of crashing the stream.
        decoder.return_value = None
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_bytes(b"corrupt")
            resp = ws.receive_json()
        assert resp == {"status": "analyzed", "bytes": len(b"corrupt")}

    def test_malformed_text_frame_is_ignored(self, client, decoder):
        # NEGATIVE: a non-JSON text frame is logged and skipped. The
        # connection must stay open and keep analysing audio.
        decoder.return_value = _features(volume=0.3)
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_text("{this is not json")
            ws.send_bytes(b"chunk")
            resp = ws.receive_json()
        assert resp["metrics"]["nudge"] == _LOUD

    def test_unknown_message_type_does_not_set_face(self, client, decoder):
        # NEGATIVE: only type == "visual_metrics" updates face data. Another
        # message type must not be treated as a visible face.
        decoder.return_value = _features(volume=0.05, emotion="neutral")
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_json({"type": "ping", "metrics": {"pose": {"yaw": 0.4}, "mar": 0.2}})
            ws.send_bytes(b"chunk")
            m = ws.receive_json()["metrics"]
        assert m["face_visible"] is False
        assert m["nudge"] is None

    def test_silent_chunk_is_not_speaking(self, client, decoder):
        # NEGATIVE: below the speech gate the learner isn't talking. The chunk
        # must be marked not-speaking so scoring treats it as unobservable.
        decoder.return_value = _features(volume=0.0005)
        with client.websocket_connect(f"{_WS}?token=t") as ws:
            ws.send_bytes(b"chunk")
            m = ws.receive_json()["metrics"]
        assert m["speaking"] is False
        assert m["emotion"] is None


class TestAudioStreamAuthNegative:
    def test_missing_token_closes_with_4001(self, client):
        # NEGATIVE: there's no token, so the stream must be refused (4001)
        # before any audio is processed.
        with client.websocket_connect(_WS) as ws:
            assert ws.receive_json() == {"error": "Missing authentication token"}
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
        assert exc.value.code == 4001

    def test_expired_token_closes_with_4003(self, client):
        # NEGATIVE: the token was rejected by verify_jwt (e.g. expired), so
        # the stream is refused with 4003.
        with patch("app.api.v1.mca.audio.verify_jwt", side_effect=HTTPException(401, "Token expired")):
            with client.websocket_connect(f"{_WS}?token=expired") as ws:
                assert ws.receive_json() == {"error": "Invalid or expired token"}
                with pytest.raises(WebSocketDisconnect) as exc:
                    ws.receive_json()
        assert exc.value.code == 4003

    def test_rejected_connection_never_builds_engine(self, client):
        # NEGATIVE: an unauthenticated client must not cause the server to
        # build a NudgeEngine (which can load the emotion model) for it.
        with patch("app.api.v1.mca.audio.NudgeEngine") as engine_cls:
            with client.websocket_connect(_WS) as ws:
                ws.receive_json()
        engine_cls.assert_not_called()
