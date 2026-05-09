"""
Pydantic schemas for the voice-baseline endpoints.

POST /apa/baseline/complete  →  BaselineCompleteIn  /  BaselineCompleteOut
GET  /apa/baseline/me        →  BaselineSnapshotOut
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
    """Response for POST /apa/baseline/complete — snapshot record plus the plan that was (re-)generated."""

    baseline: BaselineSnapshotOut
    plan_id: uuid.UUID
