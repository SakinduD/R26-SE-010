from datetime import datetime
from typing import Dict, Optional
import uuid

from pydantic import BaseModel, ConfigDict


class SessionResultCreate(BaseModel):
    """
    Schema for creating a new session result after a session ends.
    Internal backend use typically, but strictly typed for validation.
    """
    session_type: str
    overall_score: int
    dominant_emotion: Optional[str] = None
    emotion_distribution: Dict[str, float]
    nudge_summary: Dict[str, int]
    mechanical_averages: Dict[str, float]


class SessionResultResponse(BaseModel):
    """
    Schema for sending the session result back to the frontend.
    """
    id: uuid.UUID
    user_id: uuid.UUID
    session_type: str
    overall_score: int
    dominant_emotion: Optional[str] = None
    emotion_distribution: Dict[str, float]
    nudge_summary: Dict[str, int]
    mechanical_averages: Dict[str, float]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
