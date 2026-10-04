"""Unit tests for MCA request/response models, ID generation and the STT helper."""
import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.api.v1.mca.chat import ChatRequest
from app.api.v1.mca.sessions import (
    ChunkObservation,
    NudgeEntry,
    SessionEndRequest,
    SessionResponse,
    SessionStartRequest,
    generate_friendly_id,
)
from app.api.v1.mca.stt import _transcribe_with_groq

pytestmark = pytest.mark.unit

_FRIENDLY_ID = re.compile(r"^MCA-(LIVE|AI)-\d{8}-[A-Z0-9]{4}$")


class TestSchemasPositive:
    def test_start_request_defaults_to_live(self):
        assert SessionStartRequest().mode == "live"

    @pytest.mark.parametrize("mode", ["live", "ai"])
    def test_start_request_accepts_known_modes(self, mode):
        assert SessionStartRequest(mode=mode).mode == mode

    def test_end_request_all_fields_optional(self):
        body = SessionEndRequest()
        assert body.nudge_log == []
        assert body.observation_log == []
        assert body.chat_turns is None

    def test_chunk_observation_defaults(self):
        obs = ChunkObservation()
        assert obs.speaking is False and obs.face_visible is False and obs.detections == []

    def test_chat_request_minimal(self):
        req = ChatRequest(message="hi")
        assert req.history == [] and req.context == {} and req.session_id is None

    def test_session_response_from_orm(self):
        now = datetime.now(timezone.utc)
        row = SimpleNamespace(
            id=uuid.uuid4(), user_id=uuid.uuid4(), session_type="ai", status="completed",
            started_at=now, ended_at=now, duration_seconds=42, nudge_log=[], chat_turns=3,
            overall_score=70, dominant_emotion="happy", emotion_distribution={"happy": 1.0},
            nudge_summary={}, skill_scores={}, score_diagnostics={}, mechanical_averages={},
            friendly_id="MCA-AI-20261003-AB12",
        )
        resp = SessionResponse.from_orm(row)
        assert resp.mode == "ai"
        assert resp.started_at == now.isoformat()
        assert resp.id == str(row.id)

    @pytest.mark.parametrize("mode", ["live", "ai"])
    def test_friendly_id_format(self, mode):
        assert _FRIENDLY_ID.match(generate_friendly_id(mode))


class TestSchemasNegative:
    def test_start_request_rejects_unknown_mode(self):
        # NEGATIVE: only "live" and "ai" exist. Any other mode would create
        # a session the scorer has no branch for.
        with pytest.raises(ValidationError):
            SessionStartRequest(mode="video")

    def test_start_request_mode_is_case_sensitive(self):
        # NEGATIVE: "LIVE" is not the literal "live". Accepting it would
        # store inconsistent session_type values.
        with pytest.raises(ValidationError):
            SessionStartRequest(mode="LIVE")

    def test_nudge_entry_requires_core_fields(self):
        # NEGATIVE: a nudge without category/severity can't be summarised
        # or scored, so it must be rejected at the boundary.
        with pytest.raises(ValidationError):
            NudgeEntry(message="Speak up")

    def test_end_request_rejects_wrong_types(self):
        # NEGATIVE: chat_turns must be an integer, not free text.
        with pytest.raises(ValidationError):
            SessionEndRequest(chat_turns="many")

    def test_end_request_rejects_non_numeric_emotion_share(self):
        # NEGATIVE: emotion shares are fractions. A string can't be weighed.
        with pytest.raises(ValidationError):
            SessionEndRequest(emotion_distribution={"happy": "lots"})

    def test_chat_request_requires_message(self):
        # NEGATIVE: the chatbot can't respond to a request with no message field.
        with pytest.raises(ValidationError):
            ChatRequest()

    def test_friendly_ids_are_not_constant(self):
        # NEGATIVE: if the random suffix were fixed, two sessions on the same
        # day would get the same friendly ID.
        ids = {generate_friendly_id("live") for _ in range(50)}
        assert len(ids) > 1


class TestTranscribeHelper:
    """_transcribe_with_groq picks the upload extension from the content type."""

    def _run(self, content_type, prompt=None):
        result = MagicMock()
        result.to_dict.return_value = {"text": "hi"}
        client = MagicMock()
        client.audio.transcriptions.create.return_value = result
        with patch("groq.Groq", return_value=client), \
             patch("app.api.v1.mca.stt.get_settings", return_value=SimpleNamespace(groq_api_key="k")):
            data = _transcribe_with_groq(b"audio", content_type, prompt)
        return data, client.audio.transcriptions.create.call_args.kwargs

    @pytest.mark.parametrize("content_type, ext", [
        ("audio/ogg", "ogg"), ("audio/mp4", "mp4"), ("audio/webm;codecs=opus", "webm"),
    ])
    def test_extension_matches_content_type(self, content_type, ext):
        data, kwargs = self._run(content_type)
        assert kwargs["file"][0] == f"segment.{ext}"
        assert data == {"text": "hi"}

    def test_prompt_is_forwarded_when_given(self):
        _, kwargs = self._run("audio/webm", prompt="previous words")
        assert kwargs["prompt"] == "previous words"

    def test_unknown_content_type_defaults_to_webm(self):
        # NEGATIVE: an unrecognised content type falls back to webm (the
        # browser MediaRecorder default) instead of failing the upload.
        _, kwargs = self._run("application/octet-stream")
        assert kwargs["file"][0] == "segment.webm"

    def test_empty_prompt_is_not_sent(self):
        # NEGATIVE: an empty prompt would bias Whisper toward nothing, so the
        # parameter is omitted rather than sent as "".
        _, kwargs = self._run("audio/webm", prompt="")
        assert "prompt" not in kwargs
