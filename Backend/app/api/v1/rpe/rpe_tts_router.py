"""
rpe_tts_router.py
The RPE NPC voice endpoint — provider-based (Chirp 3 HD; see
app/services/tts/tts_manager.py). Mounted flat under /api (see main.py),
same convention as the existing /gtts and /stt proxies — those stay
untouched; this is an independent endpoint the frontend's own fallback
chain (Google/browser) sits in front of.

Stays thin per the router -> service -> service split used everywhere else
in this app: validate the request, hand off to tts_manager, shape the
response. All provider/synthesis logic lives in app/services/tts/.
"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.tts.providers.base import TTSProviderError
from app.services.tts.tts_manager import tts_manager

logger = logging.getLogger(__name__)

router = APIRouter()

# Same 10 workplace lines used for the DEV benchmark below and available
# to the DEV test page — short enough to stay within a single NPC turn's
# usual 1-3 sentence budget, spanning the app's actual emotion set.
SAMPLE_LINES = [
    {"label": "Calm manager", "emotion": "neutral", "text": "Let's take a step back and look at what's actually blocking this."},
    {"label": "Frustrated client", "emotion": "frustrated", "text": "This is the third time I've asked. I need this fixed today, not next week."},
    {"label": "Concerned colleague", "emotion": "concerned", "text": "I'm a little worried this timeline doesn't leave room for testing. Can we talk it through?"},
    {"label": "Confident manager", "emotion": "confident", "text": "I've reviewed the numbers, and I'm comfortable moving forward with this plan."},
    {"label": "Supportive teammate", "emotion": "satisfied", "text": "You've got this. Let me know if there's anything I can take off your plate."},
    {"label": "Skeptical reviewer", "emotion": "skeptical", "text": "I've seen this kind of estimate before, and it never holds up past week two."},
    {"label": "Short acknowledgment", "emotion": "neutral", "text": "Understood. Send it over when it's ready."},
    {"label": "Long escalation", "emotion": "angry", "text": "We agreed on Friday, you confirmed it twice, and now it's Monday and there's nothing. I need an explanation, not another excuse."},
    {"label": "Repeated line (cache test)", "emotion": "neutral", "text": "Let's take a step back and look at what's actually blocking this."},
    {"label": "Direct question", "emotion": "concerned", "text": "What's actually stopping this from shipping on time?"},
]


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    emotion: str = "neutral"
    intensity: float | None = Field(default=None, ge=0.0, le=1.0)
    # "male" | "female" — the same value derive_npc_gender already produces
    # for the NPC's avatar/profile picture (see rpe_scenario_service.py).
    # Chirp3TTSProvider picks its voice from this; omitted/unrecognized
    # falls back to the configured male voice.
    gender: str | None = None
    # Overrides — bypass the configured primary provider/voice/speed.
    # Used by the DEV test/benchmark endpoints; real NPC dialogue never
    # sets these.
    voice: str | None = None
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    provider: str | None = None


def _require_dev():
    if get_settings().app_env != "development":
        raise HTTPException(status_code=404)


@router.post("/tts/speak")
def synthesize_speech(payload: SpeakRequest):
    try:
        return tts_manager.synthesize(
            text=payload.text, emotion=payload.emotion, intensity=payload.intensity,
            gender=payload.gender, voice=payload.voice, speed_override=payload.speed,
            provider_override=payload.provider,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TTSProviderError as exc:
        logger.error("[TTS] all providers failed: %s", exc)
        raise HTTPException(status_code=503, detail="TTS unavailable") from exc


@router.get("/tts/speak/health")
def tts_health():
    """
    Dev-only status — primary provider + each provider's availability.
    Never a filesystem path, credential path, or any other config value.
    404s outside development so this isn't a standing surface in production.
    """
    _require_dev()
    return tts_manager.health()


@router.post("/v1/rpe/tts/test")
def tts_test(payload: SpeakRequest):
    """Dev-only single-utterance test endpoint — identical to /tts/speak,
    kept as its own path/name because it's the one the frontend test page
    and manual debugging hit directly, independent of the production path."""
    _require_dev()
    try:
        return tts_manager.synthesize(
            text=payload.text, emotion=payload.emotion, intensity=payload.intensity,
            gender=payload.gender, voice=payload.voice, speed_override=payload.speed,
            provider_override=payload.provider,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TTSProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class BenchmarkRequest(BaseModel):
    providers: list[str] = ["chirp3"]


@router.post("/v1/rpe/tts/benchmark")
def tts_benchmark(payload: BenchmarkRequest):
    """
    Dev-only. Runs SAMPLE_LINES through each requested backend provider
    (browser SpeechSynthesis can't be driven from the backend — the DEV
    test page benchmarks that one client-side) and reports latency/
    duration/RTF/success per line, without picking a winner. Alternates
    gender per line so both configured voices get exercised.
    """
    _require_dev()
    results = []
    for provider_name in payload.providers:
        for i, line in enumerate(SAMPLE_LINES):
            gender = "female" if i % 2 == 0 else "male"
            entry = {"provider": provider_name, "label": line["label"], "emotion": line["emotion"], "gender": gender}
            try:
                response = tts_manager.synthesize(
                    text=line["text"], emotion=line["emotion"], gender=gender, provider_override=provider_name,
                )
                entry.update({
                    "success": True, "voice": response["voice"],
                    "latencyMs": response["latencyMs"], "durationMs": response["durationMs"],
                    "rtf": response["rtf"],
                })
            except (ValueError, TTSProviderError) as exc:
                entry.update({"success": False, "error": str(exc)})
            results.append(entry)
    return {"results": results}
