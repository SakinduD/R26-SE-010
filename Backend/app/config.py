import logging
from functools import lru_cache

from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    app_name: str = "genz-softskills-api"
    app_env: str = "development"
    debug: bool = False
    database_url: str
    gemini_api_key: str = ""
    gemini_api_key_apm: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
    USE_OPENAI: bool = True   # RPE NPC dialogue: OpenAI when true, Groq fallback when false
    # RPE's own OpenAI model — separate from openai_mentoring_model so it can be
    # tuned/pinned for live conversational latency without touching mentoring.
    rpe_openai_model: str = "gpt-5-mini"
    # RPE NPC dialogue provider A/B experiment — see rpe_llm_service.py's
    # get_npc_response(). "openai" (default) is the EXACT pre-existing
    # behavior (routes on USE_OPENAI above, unchanged); "gemini" tries
    # Gemini first, falling back to the OpenAI/Groq path on any failure.
    rpe_llm_provider: str = "openai"
    # Only consulted when rpe_llm_provider == "openai" (the default) AND
    # that path fails entirely — set to "gemini" to opt into Gemini as a
    # secondary fallback. Empty (default) preserves today's exact fallback
    # behavior (OpenAI failure -> the safe canned response, nothing else).
    rpe_llm_fallback_provider: str = ""
    # Defaults to Flash-Lite, not Flash — measured during this experiment:
    # gemini-3.6-flash (the current replacement for the now-retired
    # gemini-2.5-flash) defaults to heavy "thinking" this SDK version can't
    # disable (no thinking_budget field until a google-genai major version
    # this project can't take without breaking Supabase's httpx pin — see
    # Backend/docs), measured at ~25-30s/turn over 3 real trials — not
    # viable for a live conversation. gemini-3.5-flash-lite measured
    # ~2.6s/turn, comparable-or-faster than OpenAI. Override to
    # "gemini-3.6-flash" only if testing that tradeoff deliberately.
    rpe_gemini_model: str = "gemini-3.5-flash-lite"
    # Prompt V2 experiment (payload-optimization pass) — "current" (default)
    # is the exact pre-existing system prompt, byte-for-byte unchanged.
    # "compact" swaps in a materially smaller prompt covering the identical
    # semantics (see rpe_npc_service.py's RULES_COMPACT/SCHEMA_TASK_COMPACT)
    # — never invented new rules, only tightened the wording. Global/
    # deployment-level, not per-request: flip via .env, then restart.
    rpe_llm_prompt_version: str = "current"
    # Latency-investigation experiment — "minimal" (default) is the exact
    # pre-existing value. Only ever read by _get_npc_response_openai (NPC
    # dialogue); coaching/end-detection calls sharing _call_openai_json stay
    # hardcoded at "minimal" regardless of this setting. Verified supported
    # values for gpt-5-mini via a real 400 error from the API itself:
    # minimal | low | medium | high ("none" is rejected). Override only for
    # benchmarking — low/medium/high measured 1.8x/3.3x/6x+ slower on this
    # model, see Backend/docs/INTEGRATION_RPE_LATENCY_CACHE_EXPERIMENT.md.
    rpe_openai_reasoning_effort: str = "minimal"
    # RPE avatar voice + speech-to-text — one Google Cloud key backs both
    # /api/gtts and (Phase 3) /api/stt, proxied server-side so it never
    # reaches the browser.
    google_cloud_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_mentoring_model: str = "gpt-5-mini"
    llm_mentoring_timeout_s: float = 45.0

    # Supabase Auth — url + keys required; jwt_secret kept for reference only
    # (newer Supabase projects use ES256 — verification uses the JWKS endpoint, not this secret)
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str = ""

    # APM — Adaptive Pedagogical Module integration
    rpe_base_url: str = "http://localhost:8000"
    apm_service_token: str = ""           # used by RPE→APM session-feedback callback
    apm_llm_timeout_s: float = 8.0
    apm_rpe_timeout_s: float = 5.0
    apm_demo_mode: bool = False           # enables /apa/demo/* endpoints for live demos

    # RPE NPC voice — provider-based (see app/services/tts/tts_manager.py).
    # Chirp 3 HD (Google Cloud TTS via ADC — see chirp3_provider.py for the
    # one-time `gcloud auth application-default login` setup) is currently
    # the only provider. The existing Google TTS path (/api/gtts,
    # GOOGLE_CLOUD_API_KEY-based) keeps working unchanged — it's the
    # frontend's own further fallback if Chirp3 fails, not part of this
    # provider list.
    #
    # Two voices, not one — Chirp3Provider picks between them per NPC
    # gender (see derive_npc_gender/npc_gender, already used to pick the
    # NPC's avatar/profile picture) rather than using one voice for every
    # NPC regardless of who they're supposed to be. Real Google voice
    # names/genders confirmed via texttospeech.list_voices(), not guessed.
    rpe_tts_provider: str = "chirp3"
    rpe_tts_voice_female: str = "en-US-Chirp3-HD-Kore"
    rpe_tts_voice_male: str = "en-US-Chirp3-HD-Charon"
    rpe_tts_language: str = "en-US"
    rpe_tts_speed: float = 1.0

    # Local timezone used whenever a timestamp has to be bucketed into a calendar
    # day the learner would recognise — learning streaks, "trained today", the
    # weekly activity strip. Timestamps are stored in UTC; only day boundaries
    # are localised. IANA name, e.g. "Asia/Colombo", "UTC".
    app_timezone: str = "Asia/Colombo"

    model_config = {
        "env_file": ".env",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


def get_apm_gemini_key() -> str:
    """
    Resolve the Gemini API key for the APM module — the ONE place APM key
    resolution happens. Never read GEMINI_API_KEY* inline anywhere else.

    Resolution order:
      1. GEMINI_API_KEY_APM if set
      2. else GEMINI_API_KEY, with a single WARNING logged
      3. else "" — callers must degrade, never raise. intent_parser falls back
         to rule_based parsing; scenario_selector keeps its never-raises
         degradation path. The API still returns 200 either way.

    Callers reach this through app.core.llm_client.get_apm_llm_client(), which
    is lru_cached — so in practice the fallback warning is emitted once per
    process rather than on every plan generation.
    """
    settings = get_settings()

    if settings.gemini_api_key_apm:
        return settings.gemini_api_key_apm

    if settings.gemini_api_key:
        logger.warning(
            "GEMINI_API_KEY_APM not set — APM falling back to shared GEMINI_API_KEY"
        )
        return settings.gemini_api_key

    return ""
