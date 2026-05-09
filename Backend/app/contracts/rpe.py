"""
RPE (Role-Play Simulation Engine) integration contracts.

Mirrors shapes from:
  - Backend/app/services/rpe_apa_service.py:29-55  (ApaLearnerProfile dataclass)
  - Backend/app/schemas/rpe.py                      (Pydantic models)

SCHEMA_VERSION = 1
Bump SCHEMA_VERSION and add a CHANGELOG note when teammates change their shapes
upstream — this file is APM's one source of truth for the RPE wire format.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1

DifficultyLabel = Literal["beginner", "intermediate", "advanced"]


class ApaLearnerProfile(BaseModel):
    """
    Mirror of rpe_apa_service.ApaLearnerProfile (a @dataclass on RPE side).

    Source: Backend/app/services/rpe_apa_service.py:29-55

    All Big Five fields are 0.0 - 1.0 (RPE's scale, NOT the 0-100 scale APM
    uses internally). Conversion happens ONLY in
    app/services/pedagogy/adapter.py — never anywhere else.
    """

    user_id: str
    openness: float = Field(default=0.5, ge=0.0, le=1.0)
    conscientiousness: float = Field(default=0.5, ge=0.0, le=1.0)
    extraversion: float = Field(default=0.5, ge=0.0, le=1.0)
    agreeableness: float = Field(default=0.5, ge=0.0, le=1.0)
    neuroticism: float = Field(default=0.5, ge=0.0, le=1.0)
    weak_skills: list[str] = Field(default_factory=list)
    recommended_difficulty: DifficultyLabel = "beginner"


class ApaRecommendRequest(BaseModel):
    """
    Mirror of Backend/app/schemas/rpe.py::ApaRecommendRequest (lines 80-92).
    Wire body for POST /api/v1/rpe/apa/recommend.
    """

    user_id: str
    openness: float = 0.5
    conscientiousness: float = 0.5
    extraversion: float = 0.5
    agreeableness: float = 0.5
    neuroticism: float = 0.5
    weak_skills: list[str] = Field(default_factory=list)
    recommended_difficulty: DifficultyLabel = "beginner"


class ScenarioSummary(BaseModel):
    """Mirror of Backend/app/schemas/rpe.py::ScenarioSummary (lines 4-11)."""

    scenario_id: str
    title: str
    difficulty: str
    conflict_type: str
    turns: int
    recommended_turns: int
    max_turns: int

    model_config = ConfigDict(extra="ignore")


class ScenarioDetail(BaseModel):
    """Mirror of Backend/app/schemas/rpe.py::ScenarioDetail (lines 60-77)."""

    scenario_id: str
    title: str
    difficulty: str
    conflict_type: str
    npc_role: str
    npc_personality: str
    context: str
    opening_npc_line: str
    recommended_turns: int
    max_turns: int
    end_conditions: dict = Field(default_factory=dict)
    success_criteria: dict = Field(default_factory=dict)
    npc_behaviour: dict = Field(default_factory=dict)
    apa_metadata: dict = Field(default_factory=dict)
    target_skills: list[str] = Field(default_factory=list)
    difficulty_weight: float = 1.0

    model_config = ConfigDict(extra="ignore")


class TurnMetric(BaseModel):
    """Mirror of Backend/app/schemas/rpe.py::TurnMetric (lines 100-106)."""

    turn: int
    assertiveness_score: float
    empathy_score: float
    clarity_score: float
    response_quality: float
    flags: list[str] = Field(default_factory=list)


class RiskFlag(BaseModel):
    """Mirror of Backend/app/schemas/rpe.py::RiskFlag (lines 109-113)."""

    flag_type: str
    severity: str
    description: str
    affected_turns: list[int] = Field(default_factory=list)


class BlindSpot(BaseModel):
    """Mirror of Backend/app/schemas/rpe.py::BlindSpot (lines 116-120)."""

    blind_spot_type: str
    description: str
    affected_turns: list[int] = Field(default_factory=list)
    recommendation: str


class CoachingAdvice(BaseModel):
    """Mirror of Backend/app/schemas/rpe.py::CoachingAdvice (lines 123-128)."""

    overall_rating: str
    summary: str
    advice: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    focus_areas: list[str] = Field(default_factory=list)


class FeedbackResponse(BaseModel):
    """
    Mirror of Backend/app/schemas/rpe.py::FeedbackResponse (lines 131-147).

    This is the inbound payload for POST /api/v1/apa/session-feedback —
    the integration point where RPE notifies APM that a session ended.
    """

    session_id: str
    scenario_id: str
    scenario_title: str
    user_id: str
    outcome: str | None = None
    final_trust: int | None = None
    final_escalation: int | None = None
    total_turns: int
    turn_metrics: list[TurnMetric] = Field(default_factory=list)
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    blind_spots: list[BlindSpot] = Field(default_factory=list)
    coaching_advice: CoachingAdvice
    viz_payload: dict = Field(default_factory=dict)
    end_reason: str | None = None
    recommended_turns: int | None = None
    max_turns: int | None = None

    model_config = ConfigDict(extra="ignore")
