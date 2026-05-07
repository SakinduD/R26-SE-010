from fastapi import APIRouter
from app.api.v1.mca import chat, audio, sessions

mca_router = APIRouter()

mca_router.include_router(chat.router, prefix="/chat", tags=["mca-chat"])
mca_router.include_router(audio.router, prefix="/audio", tags=["mca-audio"])
mca_router.include_router(sessions.router, prefix="/sessions", tags=["mca-sessions"])
