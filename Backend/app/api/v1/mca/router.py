from fastapi import APIRouter
from app.api.v1.mca import chat

mca_router = APIRouter()

mca_router.include_router(chat.router, prefix="/chat", tags=["mca-chat"])
