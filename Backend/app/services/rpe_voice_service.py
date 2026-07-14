"""
rpe_voice_service.py

Converts NPC text responses to speech audio using Gemini TTS.
Returns base64-encoded audio that the frontend plays directly.

NPC voices are mapped per scenario conflict type:
  manager_pressure  → Fenrir  (firm, authoritative)
  peer_indirect     → Puck    (sly, casual)
  external_pressure → Orus    (sharp, impatient)
  peer_sabotage     → Puck    (smooth, two-faced)
  autonomy_conflict → Fenrir  (controlling, anxious)
  default           → Fenrir
"""
from __future__ import annotations

import base64
import logging
import struct

from app.config import get_settings

logger = logging.getLogger(__name__)

def _pcm_to_wav(
    pcm_bytes:   bytes,
    sample_rate: int = 24_000,
    channels:    int = 1,
    bits:        int = 16,
) -> bytes:
    """
    Wrap raw Linear-16 PCM bytes in a RIFF/WAV container.
    Gemini TTS returns raw PCM — browsers cannot play it without this header.

    Header layout (44 bytes, little-endian):
      RIFF  chunk-size  WAVE  fmt   subchunk1-size  audio-fmt  channels
      sample-rate  byte-rate  block-align  bits  data  data-size
    """
    data_size   = len(pcm_bytes)
    byte_rate   = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,   # total file size − 8
        b"WAVE",
        b"fmt ",
        16,               # PCM fmt subchunk is always 16 bytes
        1,                # audio format 1 = PCM (uncompressed)
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        data_size,
    )
    return header + pcm_bytes


VOICE_MAP: dict[str, str] = {
    "manager_pressure":  "Fenrir",
    "peer_indirect":     "Puck",
    "external_pressure": "Orus",
    "peer_sabotage":     "Puck",
    "autonomy_conflict": "Fenrir",
}


class RpeVoiceService:

    def __init__(self) -> None:
        self._client    = None
        self._genai     = None
        self._types     = None
        self._available = False
        self._try_init()

    def _try_init(self) -> None:
        # ── Gemini TTS ────────────────────────────────────────────────────────
        try:
            from google import genai
            from google.genai import types as genai_types

            api_key = get_settings().gemini_api_key
            if not api_key:
                raise RuntimeError("GEMINI_API_KEY is not configured.")

            self._genai   = genai
            self._types   = genai_types
            self._client  = genai.Client(api_key=api_key)
            self._available = True
            logger.info("RPE Voice Service: Gemini TTS ready.")
        except Exception as exc:
            self._available = False
            logger.warning("RPE Voice Service: Gemini TTS unavailable: %s", exc)

        # ── Groq Whisper (speech-to-text) ─────────────────────────────────────
        try:
            from groq import Groq
            groq_key = get_settings().groq_api_key
            if not groq_key:
                raise RuntimeError("GROQ_API_KEY is not configured.")
            self._groq_client = Groq(api_key=groq_key)
            logger.info("RPE Voice Service: Groq Whisper ready.")
        except Exception as exc:
            self._groq_client = None
            logger.warning("RPE Voice Service: Groq Whisper unavailable: %s", exc)

    def text_to_speech(
        self,
        text:          str,
        conflict_type: str = "manager_pressure",
    ) -> str | None:
        """
        Convert NPC text to speech.

        Returns base64-encoded audio string (WAV/PCM) or None if unavailable.
        """
        if not self._available or not self._client:
            return None

        clean_text = text.replace("*", "").replace("_", "").strip()
        if not clean_text:
            return None

        voice_name = VOICE_MAP.get(conflict_type, "Fenrir")

        # Try TTS models in order — gemini-2.0-flash-exp was deprecated
        _TTS_MODELS = [
            "gemini-2.5-flash-preview-tts",   # dedicated TTS model (May 2025+)
            "gemini-2.0-flash",                # stable release fallback
        ]

        try:
            response = None
            last_exc = None
            for model_name in _TTS_MODELS:
                try:
                    response = self._client.models.generate_content(
                        model    = model_name,
                        contents = clean_text,
                        config   = self._types.GenerateContentConfig(
                            response_modalities = ["AUDIO"],
                            speech_config       = self._types.SpeechConfig(
                                voice_config = self._types.VoiceConfig(
                                    prebuilt_voice_config = self._types.PrebuiltVoiceConfig(
                                        voice_name = voice_name
                                    )
                                )
                            ),
                        ),
                    )
                    logger.info("RPE Voice: using model %s", model_name)
                    break
                except Exception as exc:
                    logger.warning("RPE Voice: model %s failed: %s", model_name, exc)
                    last_exc = exc

            if response is None:
                raise last_exc  # surface the last error so the outer handler logs it

            for part in response.candidates[0].content.parts:
                if not (hasattr(part, "inline_data") and part.inline_data):
                    continue

                audio_bytes = part.inline_data.data
                mime        = getattr(part.inline_data, "mime_type", "") or ""
                logger.info("RPE Voice: received audio mime_type=%r  bytes=%d", mime, len(audio_bytes))

                # Gemini TTS outputs raw Linear-16 PCM (mime: "audio/pcm" or "audio/L16").
                # Browsers cannot play bare PCM — wrap it in a WAV container first.
                mime_lower = mime.lower()
                if "pcm" in mime_lower or "l16" in mime_lower or not mime_lower:
                    audio_bytes = _pcm_to_wav(audio_bytes)
                    logger.info("RPE Voice: wrapped PCM → WAV (%d bytes)", len(audio_bytes))

                return base64.b64encode(audio_bytes).decode("utf-8")

            logger.warning("RPE Voice: no audio data in Gemini response.")
            return None

        except Exception as exc:
            logger.error("RPE Voice TTS error: %s", exc)
            return None

    def transcribe_audio(
        self,
        audio_bytes:  bytes,
        content_type: str = "audio/webm",
    ) -> str | None:
        """
        Transcribe audio bytes via Groq Whisper.

        Accepts any format MediaRecorder produces (webm, ogg, mp4).
        Returns the transcript string, or None if unavailable.
        """
        if not self._groq_client:
            return None

        import io
        ext      = (content_type.split("/")[-1].split(";")[0]) or "webm"
        filename = f"recording.{ext}"

        try:
            result = self._groq_client.audio.transcriptions.create(
                file          = (filename, io.BytesIO(audio_bytes), content_type),
                model         = "whisper-large-v3-turbo",
                response_format = "text",
                language      = "en",
            )
            # SDK may return a str directly or a Transcription object
            return result if isinstance(result, str) else getattr(result, "text", None)
        except Exception as exc:
            logger.error("RPE Voice transcription error: %s", exc)
            return None

    @property
    def is_transcription_available(self) -> bool:
        return self._groq_client is not None

    @property
    def is_available(self) -> bool:
        return self._available
