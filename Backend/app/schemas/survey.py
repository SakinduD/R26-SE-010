import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator


class QuestionOut(BaseModel):
    id: int
    text: str
    trait: str
    reverse: bool


class SurveySubmitIn(BaseModel):
    answers: dict[int, int]

    @field_validator("answers")
    @classmethod
    def validate_answers(cls, v: dict[int, int]) -> dict[int, int]:
        if set(v.keys()) != set(range(1, 45)):
            missing = set(range(1, 45)) - set(v.keys())
            extra = set(v.keys()) - set(range(1, 45))
            parts = []
            if missing:
                parts.append(f"missing ids: {sorted(missing)}")
            if extra:
                parts.append(f"unexpected ids: {sorted(extra)}")
            raise ValueError("; ".join(parts) or "answers must be exactly ids 1–44")
        for q_id, val in v.items():
            if val < 1 or val > 5:
                raise ValueError(f"answer for question {q_id} must be 1–5, got {val}")
        return v


class TraitScore(BaseModel):
    score: float
    level: Literal["low", "mid", "high"]


class OceanScores(BaseModel):
    openness: TraitScore
    conscientiousness: TraitScore
    extraversion: TraitScore
    agreeableness: TraitScore
    neuroticism: TraitScore


class PersonalityProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    scores: OceanScores
    created_at: datetime
    updated_at: datetime
