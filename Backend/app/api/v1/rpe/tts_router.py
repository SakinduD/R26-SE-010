"""
tts_router.py
Proxy endpoint for Google Cloud Text-to-Speech, used by the TalkingHead
avatar (frontend/src/components/RPE/TalkingHeadAvatar.jsx) to voice the RPE
NPC. Keeps GOOGLE_CLOUD_API_KEY server-side — the browser never sees it.

TalkingHead POSTs Google Cloud TTS's own v1beta1 text:synthesize request
shape directly to this endpoint (input.ssml, voice.languageCode/name,
audioConfig.*, enableTimePointing — confirmed by reading
node_modules/@met4citizen/talkinghead/modules/talkinghead.mjs). This proxy
is a transparent pass-through: forward the body as-is to Google with the
API key attached, forward Google's response (audioContent + timepoints)
back as-is. No request/response translation needed — TalkingHead already
speaks Google's native format.
"""
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()

_GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1beta1/text:synthesize"


@router.post("/gtts")
async def synthesize_speech(request: Request) -> JSONResponse:
    settings = get_settings()
    if not settings.google_cloud_api_key:
        raise HTTPException(
            status_code=503,
            detail="TTS not configured — add GOOGLE_CLOUD_API_KEY to .env",
        )

    body = await request.json()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                _GOOGLE_TTS_URL,
                params={"key": settings.google_cloud_api_key},
                json=body,
            )
    except httpx.RequestError as exc:
        logger.error("Google TTS request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to reach Google TTS") from exc

    if response.status_code != 200:
        logger.error("Google TTS returned %s: %s", response.status_code, response.text[:500])

    return JSONResponse(content=response.json(), status_code=response.status_code)
