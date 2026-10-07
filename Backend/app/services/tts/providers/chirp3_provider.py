"""
chirp3_provider.py
Google Cloud Text-to-Speech (Chirp 3 HD) — the RPE NPC voice provider.
Uses Application Default Credentials (ADC) only, never GOOGLE_CLOUD_API_KEY
— that key stays scoped to the existing tts_router.py/stt_router.py proxy.
ADC setup (once, per dev machine):

    gcloud init
    gcloud config set project YOUR_PROJECT_ID
    gcloud services enable texttospeech.googleapis.com
    gcloud auth application-default login

Never touches the frontend — React calls our backend, only this module
talks to Google. Requests LINEAR16 (WAV) output rather than MP3 so audio
decodes through the exact same frontend path TalkingHead already uses
(head.audioCtx.decodeAudioData) and duration_ms is computed exactly from
the WAV's own frame count, never estimated.

REQUEST_TIMEOUT_S bounds the synthesize_speech() call — same value the
existing tts_router.py/stt_router.py proxies use — so a network hiccup
raises a normal, catchable error instead of hanging the request (and with
it the whole turn, since speak() is awaited before the next interaction
is enabled) indefinitely.

Voice picks the NPC's gender (metadata["gender"], "male" | "female" — the
same value derive_npc_gender already produces for the avatar/profile
picture, see rpe_scenario_service.py) over settings.rpe_tts_voice_female/
_male, so a male NPC doesn't get voiced by a female voice or vice versa.
An explicit `voice` argument always wins (used by the DEV test/benchmark
endpoints to force a specific voice regardless of gender).
"""
import logging
import time

from app.config import get_settings
from app.services.tts.providers.base import (
    TTSProvider, TTSProviderConfigError, TTSProviderError, TTSResult, estimate_word_timings, wav_duration_ms,
)

logger = logging.getLogger(__name__)

MIN_SPEED = 0.25
MAX_SPEED = 4.0
MAX_TEXT_CHARS = 1000
SAMPLE_RATE = 24000
# Same bound the existing Google proxies use (tts_router.py, stt_router.py)
# — without an explicit timeout the gRPC call can hang well past what a
# live session can tolerate on a network hiccup, stalling the whole turn
# (speak() is awaited before the next interaction is enabled) with no
# chance to fall back to Google/browser.
REQUEST_TIMEOUT_S = 15.0


class Chirp3TTSProvider(TTSProvider):
    name = "chirp3"

    def __init__(self):
        self._client = None
        self._texttospeech = None
        self._init_error: str | None = None
        try:
            from google.cloud import texttospeech
            self._texttospeech = texttospeech
            # Reads Application Default Credentials lazily — this can
            # succeed even with no credentials configured (ADC discovery
            # is deferred to the first real API call), so a missing
            # `gcloud auth application-default login` surfaces at
            # synthesize() time, not here. Import/app-startup never crashes
            # on a dev machine without Google Cloud set up.
            self._client = texttospeech.TextToSpeechClient()
        except Exception as exc:
            logger.warning("[Chirp3 TTS] client init failed: %s", exc)
            self._init_error = str(exc)

    def available(self) -> bool:
        return self._client is not None

    def synthesize(self, text: str, voice: str | None = None, speed: float | None = None,
                    emotion: str | None = None, metadata: dict | None = None) -> TTSResult:
        if not self.available():
            raise TTSProviderConfigError(
                self._init_error
                or "Chirp 3 HD not configured — run 'gcloud auth application-default login'"
            )

        settings = get_settings()
        text = (text or "").strip()
        if not text:
            raise TTSProviderError("text is required")
        if len(text) > MAX_TEXT_CHARS:
            raise TTSProviderError(f"text exceeds {MAX_TEXT_CHARS} characters")

        gender = (metadata or {}).get("gender")
        default_voice = settings.rpe_tts_voice_female if gender == "female" else settings.rpe_tts_voice_male
        resolved_voice = voice or default_voice
        resolved_speed = speed if speed is not None else settings.rpe_tts_speed
        resolved_speed = max(MIN_SPEED, min(MAX_SPEED, resolved_speed))

        tts = self._texttospeech
        synthesis_input = tts.SynthesisInput(text=text)
        voice_params = tts.VoiceSelectionParams(
            language_code=settings.rpe_tts_language, name=resolved_voice,
        )
        audio_config = tts.AudioConfig(
            audio_encoding=tts.AudioEncoding.LINEAR16,
            speaking_rate=resolved_speed,
            sample_rate_hertz=SAMPLE_RATE,
        )

        t0 = time.time()
        try:
            response = self._client.synthesize_speech(
                input=synthesis_input, voice=voice_params, audio_config=audio_config,
                timeout=REQUEST_TIMEOUT_S,
            )
        except Exception as exc:
            # Covers auth failures only discoverable on the real call (ADC
            # present but expired/wrong project/API not enabled), an
            # invalid voice name, a timeout, and network errors —
            # normalized to one type so TTSManager doesn't need
            # Google-specific handling.
            raise TTSProviderError(f"Chirp 3 HD synthesis failed: {exc}") from exc
        latency_ms = round((time.time() - t0) * 1000)

        audio_bytes = response.audio_content
        duration_ms = wav_duration_ms(audio_bytes)

        # Chirp 3 HD doesn't return per-word timing through this API (no
        # SSML mark/timepoint support for these voices, unlike the older
        # Google voices tts_router.py proxies) — estimate it proportionally
        # from the real measured duration instead of leaving it null.
        # speakAudio()'s own lip-sync generation is entirely gated on
        # r.words being present, so without this the avatar's face would
        # stay frozen while Chirp3 audio plays. Not real forced alignment —
        # see estimate_word_timings()'s own docstring.
        words, wtimes_ms, wdurations_ms = estimate_word_timings(text, duration_ms)

        return TTSResult(
            audio=audio_bytes, content_type="audio/wav", provider=self.name,
            voice=resolved_voice, duration_ms=duration_ms, latency_ms=latency_ms,
            words=words, wtimes_ms=wtimes_ms, wdurations_ms=wdurations_ms,
        )
