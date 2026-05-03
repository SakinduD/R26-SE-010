from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "genz-softskills-api"
    app_env: str = "development"
    debug: bool = False
    database_url: str
    gemini_api_key: str = ""
    groq_api_key: str = ""

    # Supabase Auth — url + keys required; jwt_secret kept for reference only
    # (newer Supabase projects use ES256 — verification uses the JWKS endpoint, not this secret)
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str = ""

    model_config = {
        "env_file": ".env",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
