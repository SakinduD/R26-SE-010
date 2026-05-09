import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.auth import get_current_user
from app.models.session_result import SessionResult
from app.models.user import User
from app.services.llm_service import llm_service

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    history: list = []
    context: dict = {}
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    isSuccessful: bool
    message: str
    data: Optional[Any] = None


@router.post("/", response_model=ChatResponse)
async def chat_with_bot(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Handle conversational responses for the AI Chatbot mode.
    Requires authentication. Optionally associates the turn with a session.
    """
    if not request.message.strip():
        return ChatResponse(isSuccessful=False, message="Message cannot be empty")

    # Optionally validate & increment chat_turns counter on the linked session
    if request.session_id:
        try:
            sid = uuid.UUID(request.session_id)
            mca_session = db.get(SessionResult, sid)
            if mca_session and mca_session.user_id == current_user.id and mca_session.status == "active":
                mca_session.chat_turns = (mca_session.chat_turns or 0) + 1
                db.commit()
        except Exception:
            pass  # Non-critical — don't fail the chat request over this

    try:
        response_text = await llm_service.get_response(
            request.message,
            history=request.history,
            context=request.context,
        )
        return ChatResponse(
            isSuccessful=True,
            message="Chat generated successfully",
            data=response_text,
        )
    except Exception as e:
        return ChatResponse(isSuccessful=False, message=f"AI Engine Error: {str(e)}")
