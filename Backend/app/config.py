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
    apm_write_analytics: bool = True      # toggle for analytics_writer
    apm_llm_timeout_s: float = 8.0
    apm_rpe_timeout_s: float = 5.0
    apm_demo_mode: bool = False           # enables /apa/demo/* endpoints for live demos

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
