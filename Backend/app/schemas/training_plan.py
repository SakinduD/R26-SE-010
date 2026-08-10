"""
Learner-facing Pydantic schemas for the personalised Training Plan API.

Naming note — reconciling with the existing TrainingPlanOut:
app/schemas/pedagogy.py already defines a TrainingPlanOut, which is the
per-user adaptive state (strategy + difficulty + selected RPE scenario, one
row per user). It is unchanged. This module models a different, versioned
object, so its response model is PersonalisedTrainingPlanOut — the JSON field
names are the agreed plan shape; only the class name is disambiguated so the
two do not collide in the OpenAPI schema.

Machine-facing wire format lives in app/contracts/training_plan.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.contracts.training_plan import (
    SCHEMA_VERSION,
    AdaptationRules,
    CounterpartDisposition,
    IntensityPreference,
    IntentDomain,
    PedagogyDirectives,
    ParseSource,
    ScenarioBlueprint,
    SessionLength,
)
from app.services.pedagogy.adapter import RPE_SKILL_VOCABULARY

GOAL_TEXT_MIN = 15
GOAL_TEXT_MAX = 500


def _validate_focus_skills(skills: Optional[list[str]]) -> Optional[list[str]]:
    """
    Reject anything outside RPE's fixed 11-skill vocabulary. Raising here
    surfaces as a 422 carrying the allowed list, which is what the frontend
    multi-select needs to self-correct.
    """
    if not skills:
        return skills
    unknown = [s for s in skills if s not in RPE_SKILL_VOCABULARY]
    if unknown:
        raise ValueError(
            f"Unknown focus skills {unknown}. "
            f"Allowed values: {sorted(RPE_SKILL_VOCABULARY)}"
        )
    return skills


class LearnerIntent(BaseModel):
    """Structured reading of what the learner said they want to practise."""

    raw_text: str
    domain: IntentDomain
    workplace_context: str
    learner_role: str
    counterpart_role: str
    counterpart_disposition: CounterpartDisposition
    desired_focus_skills: list[str] = Field(default_factory=list)
    intensity_preference: IntensityPreference
    session_length: SessionLength
    parse_confidence: float = Field(ge=0.0, le=1.0)
    parse_source: ParseSource

    model_config = ConfigDict(extra="ignore")


class InputsSnapshot(BaseModel):
    """
    What the plan was built from. ocean_levels carries low/mid/high only —
    raw OCEAN numbers never leave the backend through this surface.
    """

    ocean_levels: dict[str, str]
    baseline_present: bool
    sessions_considered: int


class GenerateTrainingPlanIn(BaseModel):
    """
    POST /apa/training-plan/generate

    goal_text is required and free-form; every other field is an optional
    structured override that wins over whatever the intent parser inferred.
    """

    goal_text: str = Field(min_length=GOAL_TEXT_MIN, max_length=GOAL_TEXT_MAX)
    domain: Optional[IntentDomain] = None
    workplace_context: Optional[str] = Field(default=None, max_length=300)
    learner_role: Optional[str] = Field(default=None, max_length=120)
    counterpart_role: Optional[str] = Field(default=None, max_length=120)
    counterpart_disposition: Optional[CounterpartDisposition] = None
    focus_skills: Optional[list[str]] = None
    intensity_preference: Optional[IntensityPreference] = None
    session_length: Optional[SessionLength] = None

    @field_validator("focus_skills")
    @classmethod
    def _check_focus_skills(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        return _validate_focus_skills(v)


class UpdatePlanStatusIn(BaseModel):
    """PATCH /apa/training-plan/{plan_id}/status"""

    action: str  # "activate" | "archive"


class PersonalisedTrainingPlanOut(BaseModel):
    """The learner-facing training plan. See the module docstring on naming."""

    plan_id: uuid.UUID
    user_id: uuid.UUID
    schema_version: str = SCHEMA_VERSION
    plan_version: int
    status: str

    intent: LearnerIntent
    blueprint: ScenarioBlueprint
    pedagogy: PedagogyDirectives
    adaptation: AdaptationRules

    personalisation_brief: str
    target_skills: list[str] = Field(default_factory=list)
    inputs_snapshot: InputsSnapshot
    generation_sources: dict[str, str] = Field(default_factory=dict)

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TrainingPlanSummaryOut(BaseModel):
    """Compact row for the paginated history list."""

    plan_id: uuid.UUID
    plan_version: int
    status: str
    domain: str
    title_hint: str
    difficulty: int
    target_skills: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class TrainingPlanListOut(BaseModel):
    """GET /apa/training-plan — paginated history."""

    total: int
    limit: int
    offset: int
    items: list[TrainingPlanSummaryOut] = Field(default_factory=list)


class SkillVocabularyOut(BaseModel):
    """
    GET /apa/training-plan/skill-vocabulary — served so the frontend
    multi-select never hardcodes the list client-side.
    """

    skills: list[str]
    count: int
