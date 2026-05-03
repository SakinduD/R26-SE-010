from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api_router import router as api_v1_router
from app.config import get_settings

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


@app.get("/")
def root() -> dict[str, str]:
    """Welcome endpoint."""
    return {"message": f"Welcome to {settings.app_name}"}


@app.get("/health")
def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "app": settings.app_name, "env": settings.app_env}
