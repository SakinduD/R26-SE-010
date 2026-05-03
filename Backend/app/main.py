import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api_router import router as api_v1_router
from app.config import get_settings
from app.db.database import check_database_connection

logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix="/api/v1")


@app.on_event("startup")
async def startup_event() -> None:
    result = check_database_connection()
    if result["connected"]:
        logger.info("✓ Supabase connection established")
    else:
        logger.error("✗ Database connection failed: %s", result["error"])


@app.get("/")
def root() -> dict[str, str]:
    return {"message": f"Welcome to {settings.app_name}"}


@app.get("/health")
def health_check() -> dict:
    """Health check — always returns 200; status reflects DB and auth state."""
    db_status = check_database_connection()
    auth_configured = bool(
        settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_jwt_secret
    )
    return {
        "status": "ok" if db_status["connected"] else "degraded",
        "app": settings.app_name,
        "env": settings.app_env,
        "database": db_status,
        "auth": {"configured": auth_configured},
    }
