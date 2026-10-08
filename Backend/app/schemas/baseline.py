"""
Pydantic schemas for the voice-baseline endpoints.

POST /apa/baseline/complete  →  BaselineCompleteIn  /  BaselineCompleteOut
GET  /apa/baseline/me        →  BaselineSnapshotOut
GET  /apa/baseline/history   →  list[BaselineHistoryOut]
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class BaselineCompleteIn(BaseModel):
    """Body for POST /apa/baseline/complete."""

    mca_session_id: str


class BaselineSnapshotOut(BaseModel):
    """Read representation of a persisted BaselineSnapshot row."""

    id: uuid.UUID
    user_id: uuid.UUID
    mca_session_id: str
    skill_scores: Optional[dict[str, Any]] = None
    emotion_distribution: Optional[dict[str, Any]] = None
    overall_score: Optional[float] = None
    duration_seconds: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BaselineCompleteOut(BaseModel):
    """
    Response for POST /apa/baseline/complete.

    plan_regenerated is True on the first baseline, which builds the training
    plan. On a redo only the learner profile is recalculated and the existing
    plan is left alone (plan_id is that plan, or None if there is none yet).
    """

    baseline: BaselineSnapshotOut
    plan_id: Optional[uuid.UUID] = None
    plan_regenerated: bool


class BaselineHistoryOut(BaseModel):
    """One submitted baseline, as listed by GET /apa/baseline/history."""

    id: uuid.UUID
    mca_session_id: str
    skill_scores: Optional[dict[str, Any]] = None
    emotion_distribution: Optional[dict[str, Any]] = None
    overall_score: Optional[float] = None
    duration_seconds: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BaselineChatIn(BaseModel):
    """Body for POST /apa/baseline/chat."""

    message: str
    history: list = []
    context: Optional[dict[str, Any]] = None
    turn: int = 0


class BaselineChatOut(BaseModel):
    """Response for POST /apa/baseline/chat."""

    response: str
    should_end: bool
