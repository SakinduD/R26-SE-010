from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Score = float | None


class AnalyticsSessionMetricBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str = Field(..., min_length=1, max_length=64)
    scenario_id: str | None = Field(default=None, max_length=64)
    skill_type: str | None = Field(default=None, max_length=80)

    confidence_score: Score = Field(default=None, ge=0, le=100)
    clarity_score: Score = Field(default=None, ge=0, le=100)
    empathy_score: Score = Field(default=None, ge=0, le=100)
    listening_score: Score = Field(default=None, ge=0, le=100)
    adaptability_score: Score = Field(default=None, ge=0, le=100)
    emotional_control_score: Score = Field(default=None, ge=0, le=100)
    professionalism_score: Score = Field(default=None, ge=0, le=100)

    eye_contact_score: Score = Field(default=None, ge=0, le=100)
    speech_pace_score: Score = Field(default=None, ge=0, le=100)
    speech_volume_score: Score = Field(default=None, ge=0, le=100)
    response_quality_score: Score = Field(default=None, ge=0, le=100)

    overall_score: Score = Field(default=None, ge=0, le=100)


class AnalyticsSessionMetricCreate(AnalyticsSessionMetricBase):
    pass


class AnalyticsSessionMetricRead(AnalyticsSessionMetricBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FeedbackEntryBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str = Field(..., min_length=1, max_length=64)
    feedback_type: Literal["self", "peer", "system", "mentor"]
    skill_area: str | None = Field(default=None, max_length=80)
    rating: Score = Field(default=None, ge=0, le=100)
    comment: str | None = None
    sentiment: Literal["positive", "neutral", "negative"] | None = None


class FeedbackEntryCreate(FeedbackEntryBase):
    pass


class FeedbackEntryRead(FeedbackEntryBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SkillPredictionBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str | None = Field(default=None, max_length=64)
    predicted_skill: str = Field(..., min_length=1, max_length=80)
    predicted_score: Score = Field(default=None, ge=0, le=100)
    current_score: Score = Field(default=None, ge=0, le=100)
    trend_label: Literal["improving", "stable", "declining"] | None = None
    risk_level: Literal["low", "medium", "high"] = "medium"
    recommendation: str | None = None
    model_version: str = Field(default="rule-based-v1", min_length=1, max_length=40)


class SkillPredictionCreate(SkillPredictionBase):
    pass


class SkillPredictionRead(SkillPredictionBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
