from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "genz-softskills-api"
    app_env: str = "development"
    debug: bool = False
    database_url: str
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
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
