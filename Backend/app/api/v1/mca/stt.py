"""
MCA live-mode speech-to-text via Whisper large-v3 (hosted on Groq).

Used by MultimodalEngine.jsx's continuous transcription loop (user mic and
shared meeting audio). Whisper is far more accurate than Google's
latest_short model on conversational / meeting audio, and accepts the
browser's audio/webm;codecs=opus segments as-is.

The browser POSTs the raw audio bytes as the request body. An optional
`prompt` query param carries the tail of the previous segment's transcript so
Whisper keeps context (names, spelling, sentence flow) across segment cuts.

Returns 503 when GROQ_API_KEY isn't configured or Groq fails, so the frontend
can fall back to the existing Google STT endpoint (/api/stt).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool

from app.config import get_settings
from app.core.auth import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

_WHISPER_MODEL = "whisper-large-v3"

# Whisper hallucinates text ("Thank you.", "Bye.") on silence / noise. Segments
# it is itself unsure contain speech are dropped.
_MAX_NO_SPEECH_PROB = 0.6
_MIN_AVG_LOGPROB = -1.0


def _transcribe_with_groq(audio_bytes: bytes, content_type: str, prompt: str | None) -> dict:
    from groq import Groq

    client = Groq(api_key=get_settings().groq_api_key)
    extension = "ogg" if "ogg" in content_type else "mp4" if "mp4" in content_type else "webm"
    result = client.audio.transcriptions.create(
        file=(f"segment.{extension}", audio_bytes),
        model=_WHISPER_MODEL,
        language="en",
        temperature=0.0,
        response_format="verbose_json",
        **({"prompt": prompt} if prompt else {}),
    )
    return result.to_dict() if hasattr(result, "to_dict") else result.model_dump()


@router.post("/transcribe")
async def transcribe_segment(
    request: Request,
    prompt: str | None = Query(default=None, max_length=500),
    current_user: User = Depends(get_current_user),
):
    if not get_settings().groq_api_key:
        raise HTTPException(status_code=503, detail="Whisper STT not configured — add GROQ_API_KEY to .env")

    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio payload")

    content_type = request.headers.get("content-type", "audio/webm")
    try:
        data = await run_in_threadpool(_transcribe_with_groq, audio_bytes, content_type, prompt)
    except Exception as exc:
        logger.error("Groq Whisper transcription failed: %s", exc)
        raise HTTPException(status_code=503, detail="Whisper transcription failed") from exc

    segments = data.get("segments")
    if segments:
        kept = [
            s.get("text", "").strip()
            for s in segments
            if s.get("no_speech_prob", 0) <= _MAX_NO_SPEECH_PROB
            and s.get("avg_logprob", 0) >= _MIN_AVG_LOGPROB
        ]
        transcript = " ".join(t for t in kept if t).strip()
    else:
        transcript = (data.get("text") or "").strip()

    return {"transcript": transcript}
