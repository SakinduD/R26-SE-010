from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
from app.services.llm_service import llm_service

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    history: list = None
    context: dict = None

class ChatResponse(BaseModel):
    isSuccessful: bool
    message: str
    data: Optional[Any] = None

@router.post("/", response_model=ChatResponse)
async def chat_with_bot(request: ChatRequest):
    """
    Handle conversational responses for the AI Chatbot mode.
    """
    if not request.message:
        return ChatResponse(
            isSuccessful=False,
            message="Message cannot be empty"
        )
    
    try:
        response_text = await llm_service.get_response(request.message, history=request.history)
        return ChatResponse(
            isSuccessful=True,
            message="Chat generated successfully",
            data=response_text
        )
    except Exception as e:
        return ChatResponse(
            isSuccessful=False,
            message=f"AI Engine Error: {str(e)}"
        )
