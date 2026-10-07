"""
base.py
The TTSProvider interface every backend voice provider implements
(Chirp3TTSProvider today; a future local provider — Piper, StyleTTS2 —
would implement the same contract). TTSManager (tts_manager.py) is the
only thing that calls these directly; it only ever depends on this
interface, never a concrete provider's internals.
"""
import io
import re
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass


def wav_duration_ms(wav_bytes: bytes) -> int:
    """Exact duration from a WAV file's own frame count — never estimated."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        return round(w.getnframes() / w.getframerate() * 1000)


_WORD_RE = re.compile(r"\S+")


def estimate_word_timings(text: str, duration_ms: int) -> tuple[list[str], list[int], list[int]]:
    """
    Word start/duration proportional to character count across the total
    (real, measured) audio duration — an honest estimate, NOT real forced
    alignment. Used by providers whose API doesn't expose per-word timing
    (Chirp 3 HD), so TalkingHead's speakAudio() still has *something* to
    drive lip-sync from instead of leaving the avatar's face frozen (its
    lipsync generation is entirely gated on r.words being present — see
    speakAudio() in talkinghead.mjs).
    """
    words = _WORD_RE.findall(text)
    if not words:
        return [], [], []
    total_chars = sum(len(w) for w in words) or 1
    wtimes_ms, wdurations_ms = [], []
    elapsed_ms = 0.0
    for w in words:
        dur_ms = duration_ms * (len(w) / total_chars)
        wtimes_ms.append(round(elapsed_ms))
        wdurations_ms.append(round(dur_ms))
        elapsed_ms += dur_ms
    return words, wtimes_ms, wdurations_ms


@dataclass
class TTSResult:
    audio: bytes
    content_type: str
    provider: str
    voice: str
    duration_ms: int
    latency_ms: int
    # Real or estimated per-word timing for lip-sync (Chirp3TTSProvider
    # always fills these via estimate_word_timings() above, since the API
    # exposes no real per-word timing) — TalkingHead's speakAudio() would
    # otherwise leave the avatar's face frozen when these are omitted.
    words: list[str] | None = None
    wtimes_ms: list[int] | None = None
    wdurations_ms: list[int] | None = None


class TTSProviderError(Exception):
    """Raised by a provider for any failure — bad input, network, a
    genuine runtime error. TTSManager catches this one type to move on to
    the next provider without needing to know each provider's internals."""


class TTSProviderConfigError(TTSProviderError):
    """Raised when a provider isn't usable in this environment at all
    (missing credentials, disabled, model not loaded) — a subclass of
    TTSProviderError so TTSManager's fallback still catches it, but
    distinguished for health/debug output ("not configured" vs "failed")."""


class TTSProvider(ABC):
    name: str

    @abstractmethod
    def available(self) -> bool:
        """Whether this provider can be used right now (configured, model
        loaded, credentials present) without attempting synthesis."""

    @abstractmethod
    def synthesize(self, text: str, voice: str | None = None, speed: float | None = None,
                   emotion: str | None = None, metadata: dict | None = None) -> TTSResult:
        """Raises TTSProviderError (or TTSProviderConfigError) on any
        failure — never returns a partial/invalid result."""
