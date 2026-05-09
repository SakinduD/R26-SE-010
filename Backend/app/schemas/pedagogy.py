"""
APM Pydantic schemas for the pedagogy API layer.

These are response/request shapes only — internal logic types live in
app/services/pedagogy/types.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.contracts.mca import McaNudge
from app.services.pedagogy.types import TeachingStrategy


class TrainingPlanOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    skill: str
    strategy: TeachingStrategy
    difficulty: int
    recommended_scenario_ids: list[str]
    primary_scenario: Optional[dict] = None
    generation_source: str
    generation_status: str
    last_adjusted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    baseline_summary_json: Optional[dict] = None
    brief_json: Optional[dict] = None

    model_config = {"from_attributes": True}


class AdjustmentHistoryEntryOut(BaseModel):
    id: uuid.UUID
    trigger: str
    previous_strategy: dict
    new_strategy: dict
    previous_difficulty: int
    new_difficulty: int
    signals_summary: dict
    rationale: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AdjustmentHintOut(BaseModel):
    new_difficulty: int
    rationale: list[str]
    signals_summary: dict


class GeneratePlanIn(BaseModel):
    skill: str = Field(default="job_interview", max_length=40)


class LiveSignalIn(BaseModel):
    nudges: list[McaNudge]
