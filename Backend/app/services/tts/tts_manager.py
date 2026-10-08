"""
tts_manager.py
Selects the configured provider, calls it, and normalizes the result. This
is the one seam NPC dialogue becomes audio through:

    NPC backend response -> SpeechPerformanceService -> speechText +
    delivery metadata -> TTSManager -> selected provider -> audio

Chirp 3 HD is currently the only registered provider — the architecture
stays provider-based (see providers/base.py's TTSProvider interface) so a
future local provider (Piper, StyleTTS2, ...) can register here without
touching the router or speech_performance.py; Kokoro was built and later
removed (too slow/variable on this hardware — see the RPE TTS provider
architecture task's follow-up), leaving the registry with one entry.

Deliberately excludes the *existing* Google TTS (/api/gtts) and the
browser SpeechSynthesis fallback from this list — the frontend's own
speak() already falls through to those if TTSManager fails entirely
(see RolePlaySessionV2.jsx's speakViaGoogleOrBrowser), so adding them here
would mean calling Google Cloud TTS through two different code paths for
the same failure.
"""
import base64
import logging
import time

from app.config import get_settings
from app.services.tts.providers.base import TTSProviderError, TTSResult
from app.services.tts.providers.chirp3_provider import Chirp3TTSProvider
from app.services.tts.speech_performance import build_speech_performance

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 1000
MAX_CACHE_ENTRIES = 50

# Instantiated once at import time — same module-level singleton pattern as
# rpe_scenario_service etc. in router.py. Chirp3TTSProvider's own __init__
# never raises (see its docstring), so this is safe even with no Google
# Cloud credentials configured — it just reports available() == False
# until ADC is set up.
_PROVIDERS = {
    "chirp3": Chirp3TTSProvider(),
}


class TTSManager:
    def __init__(self):
        self._dev_cache: dict[str, dict] = {}

    def _provider_order(self) -> list[str]:
        primary = get_settings().rpe_tts_provider
        order = [primary] if primary in _PROVIDERS else []
        order += [name for name in _PROVIDERS if name not in order]
        return order

    def health(self) -> dict:
        settings = get_settings()
        return {
            "primaryProvider": settings.rpe_tts_provider,
            "providers": {name: {"available": p.available()} for name, p in _PROVIDERS.items()},
        }

    def synthesize(self, text: str, emotion: str = "neutral", intensity: float | None = None,
                    gender: str | None = None, voice: str | None = None,
                    speed_override: float | None = None, provider_override: str | None = None) -> dict:
        """
        Raises TTSProviderError only once EVERY provider in the order has
        failed — the router is the only caller and turns that into a 503.
        provider_override bypasses the normal fallback order entirely
        (used by the DEV benchmark/test endpoints to exercise one specific
        provider even when it wouldn't normally be reached). gender
        ("male" | "female", the same value derive_npc_gender already
        produces) is forwarded to the provider as metadata — Chirp3TTSProvider
        uses it to pick between the two configured voices; an explicit
        `voice` always overrides it.
        """
        text = (text or "").strip()
        if not text:
            raise ValueError("text is required")
        if len(text) > MAX_TEXT_CHARS:
            raise ValueError(f"text exceeds {MAX_TEXT_CHARS} characters")

        performance = build_speech_performance(text, emotion=emotion, intensity=intensity)
        speed = speed_override if speed_override is not None else performance["speedMultiplier"]

        is_dev = get_settings().app_env == "development"
        order = [provider_override] if provider_override in _PROVIDERS else self._provider_order()
        cache_key = f"{provider_override or '|'.join(order)}::{voice}::{gender}::{round(speed, 3)}::{performance['speechText']}"
        if is_dev and cache_key in self._dev_cache:
            logger.info("[TTS] cache hit — %s", performance["speechText"][:40])
            # latencyMs/rtf on a cache hit would otherwise be the ORIGINAL
            # request's stale numbers, misreadable as a fresh (and
            # suspiciously identical) measurement — see the benchmark
            # endpoint's "repeated line" row. cached:true plus a real ~0ms
            # figure keeps the response honest about what actually happened
            # this time; durationMs (a property of the audio, not the
            # request) is left untouched.
            cached = dict(self._dev_cache[cache_key])
            cached["cached"] = True
            cached["latencyMs"] = 0
            cached["rtf"] = None
            return cached

        errors = []
        for name in order:
            provider = _PROVIDERS[name]
            try:
                t0 = time.time()
                result = provider.synthesize(
                    performance["speechText"], voice=voice, speed=speed, emotion=emotion,
                    metadata={"gender": gender},
                )
                total_ms = round((time.time() - t0) * 1000)
                if is_dev:
                    rtf = round(result.duration_ms / total_ms, 2) if total_ms else None
                    logger.info(
                        "[TTS] provider=%s voice=%s latency_ms=%s duration_ms=%s rtf=%s",
                        result.provider, result.voice, total_ms, result.duration_ms, rtf,
                    )
                response = _to_response(result, performance, total_ms)
                if is_dev:
                    self._dev_cache[cache_key] = response
                    if len(self._dev_cache) > MAX_CACHE_ENTRIES:
                        self._dev_cache.pop(next(iter(self._dev_cache)))
                return response
            except TTSProviderError as exc:
                logger.warning("[TTS] provider=%s failed, trying next: %s", name, exc)
                errors.append(f"{name}: {exc}")

        raise TTSProviderError(f"All TTS providers failed: {'; '.join(errors)}")


def _to_response(result: TTSResult, performance: dict, total_ms: int) -> dict:
    return {
        "audio": base64.b64encode(result.audio).decode("ascii"),
        "contentType": result.content_type,
        "provider": result.provider,
        "voice": result.voice,
        "durationMs": result.duration_ms,
        "latencyMs": total_ms,
        "rtf": round(result.duration_ms / total_ms, 2) if total_ms else None,
        "cached": False,
        "words": result.words,
        "wtimes": result.wtimes_ms,
        "wdurations": result.wdurations_ms,
        "emotion": performance["emotion"],
        "pauseBeforeMs": performance["pauseBeforeMs"],
        "pauseAfterMs": performance["pauseAfterMs"],
    }


tts_manager = TTSManager()
