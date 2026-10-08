"""Integration tests for live-mode speech-to-text (POST /mca/stt/transcribe).

The Groq call is mocked at _transcribe_with_groq; request handling, auth and
the hallucination filter run for real.
"""
from types import SimpleNamespace
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.integration

_URL = "/mca/stt/transcribe"
_AUDIO = b"\x1a\x45\xdf\xa3" + b"\x00" * 64  # WebM magic + padding (never decoded: Groq is mocked)
_WEBM = {"content-type": "audio/webm"}


@pytest.fixture
def groq_configured():
    with patch("app.api.v1.mca.stt.get_settings", return_value=SimpleNamespace(groq_api_key="test-key")):
        yield


@pytest.fixture 
def groq_returns():
    with patch("app.api.v1.mca.stt._transcribe_with_groq") as mock:
        yield mock


@pytest.mark.usefixtures("groq_configured")
class TestTranscribePositive:
    def test_segments_are_joined(self, api, make_user, groq_returns):
        groq_returns.return_value = {"segments": [
            {"text": " Hello everyone. ", "no_speech_prob": 0.01, "avg_logprob": -0.2},
            {"text": "Let's begin.", "no_speech_prob": 0.05, "avg_logprob": -0.3},
        ]}
        resp = api(make_user(), "post", _URL, content=_AUDIO, headers=_WEBM)
        assert resp.status_code == 200
        assert resp.json() == {"transcript": "Hello everyone. Let's begin."}

    def test_plain_text_used_when_no_segments(self, api, make_user, groq_returns):
        groq_returns.return_value = {"text": "  Just text.  "}
        assert api(make_user(), "post", _URL, content=_AUDIO, headers=_WEBM).json() == {"transcript": "Just text."}

    def test_prompt_and_content_type_are_forwarded(self, api, make_user, groq_returns):
        groq_returns.return_value = {"text": "ok"}
        api(make_user(), "post", f"{_URL}?prompt=previous%20sentence", content=_AUDIO,
            headers={"content-type": "audio/ogg"})
        audio, content_type, prompt = groq_returns.call_args.args
        assert audio == _AUDIO
        assert content_type == "audio/ogg"
        assert prompt == "previous sentence"


@pytest.mark.usefixtures("groq_configured")
class TestTranscribeNegative:
    def test_hallucinated_segments_on_silence_are_dropped(self, api, make_user, groq_returns):
        # NEGATIVE: Whisper invents "Thank you." on silence. Segments it marks
        # as likely no-speech, or low-confidence, must not reach the transcript
        # (they would be scored as the learner's words).
        groq_returns.return_value = {"segments": [
            {"text": "Real sentence.", "no_speech_prob": 0.1, "avg_logprob": -0.4},
            {"text": "Thank you.", "no_speech_prob": 0.9, "avg_logprob": -0.2},
            {"text": "Bye.", "no_speech_prob": 0.1, "avg_logprob": -1.5},
        ]}
        assert api(make_user(), "post", _URL, content=_AUDIO, headers=_WEBM).json() == {"transcript": "Real sentence."}

    def test_all_segments_filtered_gives_empty_transcript(self, api, make_user, groq_returns):
        # NEGATIVE: pure silence must give an empty transcript, not invented words.
        groq_returns.return_value = {"segments": [{"text": "Thanks.", "no_speech_prob": 0.95, "avg_logprob": -0.1}]}
        assert api(make_user(), "post", _URL, content=_AUDIO, headers=_WEBM).json() == {"transcript": ""}

    def test_empty_body_is_400(self, api, make_user, groq_returns):
        # NEGATIVE: there's no audio to transcribe, so Groq must not be called.
        resp = api(make_user(), "post", _URL, content=b"", headers=_WEBM)
        assert resp.status_code == 400
        groq_returns.assert_not_called()

    def test_groq_failure_is_503(self, api, make_user, groq_returns):
        # NEGATIVE: Groq is down or rejected the file. 503 tells the frontend
        # to fall back to the secondary STT endpoint.
        groq_returns.side_effect = ConnectionError("groq unreachable")
        resp = api(make_user(), "post", _URL, content=_AUDIO, headers=_WEBM)
        assert resp.status_code == 503
        assert resp.json()["detail"] == "Whisper transcription failed"

    def test_prompt_longer_than_500_chars_is_422(self, api, make_user, groq_returns):
        # NEGATIVE: the context prompt is capped at 500 chars to bound
        # request size and cost.
        resp = api(make_user(), "post", f"{_URL}?prompt={'a' * 501}", content=_AUDIO, headers=_WEBM)
        assert resp.status_code == 422
        groq_returns.assert_not_called()

    def test_without_auth_is_401(self, api, groq_returns):
        # NEGATIVE: STT spends paid Groq quota, so anonymous calls are refused.
        assert api(None, "post", _URL, content=_AUDIO, headers=_WEBM).status_code == 401
        groq_returns.assert_not_called()


class TestTranscribeNotConfigured:
    def test_missing_groq_key_is_503(self, api, make_user, groq_returns):
        # NEGATIVE: the server has no GROQ_API_KEY, so the feature is
        # unavailable. 503 (not 500) lets the client fall back gracefully.
        with patch("app.api.v1.mca.stt.get_settings", return_value=SimpleNamespace(groq_api_key="")):
            resp = api(make_user(), "post", _URL, content=_AUDIO, headers=_WEBM)
        assert resp.status_code == 503
        assert "GROQ_API_KEY" in resp.json()["detail"]
        groq_returns.assert_not_called()
