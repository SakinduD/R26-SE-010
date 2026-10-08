"""
stt_router.py
Proxy endpoint for Google Cloud Speech-to-Text. Keeps GOOGLE_CLOUD_API_KEY
server-side — the browser never sees it. Same key/pattern as
tts_router.py's /gtts endpoint.

Used today by MultimodalEngine.jsx's live-mode continuous transcription
(scoring input for the LLM coach, not shown to the user as a chat message).
RPE's own reply bar (frontend/src/hooks/useVoiceRecorder.js) no longer calls
this — it now uses the browser's built-in SpeechRecognition (Web Speech API)
directly, client-side, no key involved; see that hook's own docstring for
why (mirrors /baseline's AIChatbot, which has always worked that way).

The browser records one utterance with MediaRecorder (audio/webm;codecs=opus)
and POSTs the raw audio bytes as the request body. This endpoint base64-encodes
them, wraps them in Google STT's REST request shape, and returns just the
transcript — the frontend doesn't need Google's full response shape.
"""
import base64
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()

_GOOGLE_STT_URL = "https://speech.googleapis.com/v1/speech:recognize"


@router.post("/stt")
async def transcribe_speech(request: Request) -> JSONResponse:
    settings = get_settings()
    if not settings.google_cloud_api_key:
        raise HTTPException(
            status_code=503,
            detail="STT not configured — add GOOGLE_CLOUD_API_KEY to .env",
        )

    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio payload")

    payload = {
        "config": {
            "encoding": "WEBM_OPUS",
            "sampleRateHertz": 48000,
            "languageCode": "en-US",
            "model": "latest_short",
            "enableAutomaticPunctuation": True,
        },
        "audio": {"content": base64.b64encode(audio_bytes).decode("ascii")},
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                _GOOGLE_STT_URL,
                params={"key": settings.google_cloud_api_key},
                json=payload,
            )
    except httpx.RequestError as exc:
        logger.error("Google STT request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to reach Google STT") from exc

    if response.status_code != 200:
        logger.error("Google STT returned %s: %s", response.status_code, response.text[:500])
        raise HTTPException(status_code=502, detail="Speech recognition failed")

    data = response.json()
    results = [r for r in data.get("results", []) if r.get("alternatives")]
    transcript = " ".join(r["alternatives"][0]["transcript"] for r in results).strip()

    # Lowest confidence across all result chunks — mirrors the same
    # conservative "did any part sound uncertain" signal RPE's native
    # SpeechRecognition path already surfaces (see useVoiceRecorder.js).
    # Google only reliably populates this for is_final results, which a
    # synchronous recognize call always returns, so no filtering needed here.
    confidences = [
        r["alternatives"][0]["confidence"]
        for r in results
        if isinstance(r["alternatives"][0].get("confidence"), (int, float))
    ]
    confidence = min(confidences) if confidences else None

    return JSONResponse(content={"transcript": transcript, "confidence": confidence})
