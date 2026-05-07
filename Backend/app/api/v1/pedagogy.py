"""
APM (Adaptive Pedagogical Module) API endpoints.

All routes are prefixed /apa (registered via api_router.py).

Auth:
  Most endpoints require a Bearer JWT (get_current_user dependency).
  POST /apa/session-feedback accepts either JWT _or_ X-Service-Token for the
  RPE→APM callback path where no user JWT context exists.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.config import get_settings
from app.contracts.rpe import FeedbackResponse
from app.core.auth import get_current_user, verify_jwt
from app.core.llm_client import get_llm_client
from app.core.rpe_client import get_rpe_client
from app.models.training_plan import AdjustmentHistory, TrainingPlan
from app.models.user import User
from app.schemas.pedagogy import (
    AdjustmentHintOut,
    AdjustmentHistoryEntryOut,
    GeneratePlanIn,
    LiveSignalIn,
    TrainingPlanOut,
)
from app.services.pedagogy import orchestrator
from app.services.pedagogy.dda_engine import initial_difficulty
from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import OceanScores, TeachingStrategy

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Adaptive Pedagogy"])

_bearer_opt = HTTPBearer(auto_error=False)


def _plan_to_out(plan: TrainingPlan) -> TrainingPlanOut:
    return TrainingPlanOut(
        id=plan.id,
        user_id=plan.user_id,
        skill=plan.skill,
        strategy=TeachingStrategy(**plan.strategy_json),
        difficulty=plan.difficulty,
        recommended_scenario_ids=plan.recommended_scenario_ids or [],
        primary_scenario=plan.primary_scenario_json,
        generation_source=plan.generation_source,
        generation_status=plan.generation_status,
        last_adjusted_at=plan.last_adjusted_at,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


# ---------------------------------------------------------------------------
# Plan CRUD
# ---------------------------------------------------------------------------


@router.post("/plan/generate", response_model=TrainingPlanOut, status_code=201)
async def generate_plan(
    body: GeneratePlanIn = Body(default=GeneratePlanIn()),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TrainingPlanOut:
    """Generate (or regenerate) a personalised training plan for the current user."""
    rpe = get_rpe_client()
    llm = get_llm_client()
    try:
        plan = await orchestrator.generate_training_plan(
            current_user.id, db, rpe, llm, skill=body.skill
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return _plan_to_out(plan)


@router.get("/plan/me", response_model=TrainingPlanOut)
def get_my_plan(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TrainingPlanOut:
    """Return the current user's training plan."""
    plan = (
        db.query(TrainingPlan)
        .filter(TrainingPlan.user_id == current_user.id)
        .first()
    )
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No training plan found. POST /apa/plan/generate first.",
        )
    return _plan_to_out(plan)


@router.get("/plan/history", response_model=list[AdjustmentHistoryEntryOut])
def get_adjustment_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AdjustmentHistoryEntryOut]:
    """Return all adjustment history entries for the current user, newest first."""
    entries = (
        db.query(AdjustmentHistory)
        .filter(AdjustmentHistory.user_id == current_user.id)
        .order_by(AdjustmentHistory.created_at.desc())
        .all()
    )
    return [
        AdjustmentHistoryEntryOut(
            id=e.id,
            trigger=e.trigger,
            previous_strategy=e.previous_strategy,
            new_strategy=e.new_strategy,
            previous_difficulty=e.previous_difficulty,
            new_difficulty=e.new_difficulty,
            signals_summary=e.signals_summary,
            rationale=e.rationale,
            created_at=e.created_at,
        )
        for e in entries
    ]


# ---------------------------------------------------------------------------
# Feedback / signal ingest
# ---------------------------------------------------------------------------


@router.post("/session-feedback", response_model=TrainingPlanOut)
async def receive_session_feedback(
    fb: FeedbackResponse,
    x_service_token: Optional[str] = Header(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_opt),
    db: Session = Depends(get_db),
) -> TrainingPlanOut:
    """
    Inbound RPE → APM end-of-session callback.

    Auth (priority order):
      1. Bearer JWT  — user_id taken from token; fb.user_id ignored for security
      2. X-Service-Token matching APM_SERVICE_TOKEN — user_id from fb.user_id
    """
    settings = get_settings()
    user_uuid: uuid.UUID

    if credentials is not None:
        payload = verify_jwt(credentials.credentials)
        user_uuid = uuid.UUID(payload.sub)
    elif x_service_token and x_service_token == settings.apm_service_token:
        try:
            user_uuid = uuid.UUID(fb.user_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="fb.user_id is not a valid UUID",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Provide a Bearer token or a valid X-Service-Token header",
        )

    try:
        plan = await orchestrator.apply_session_feedback(user_uuid, fb, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return _plan_to_out(plan)


@router.post("/live-signals", response_model=AdjustmentHintOut)
async def receive_live_signals(
    body: LiveSignalIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdjustmentHintOut:
    """Process mid-session MCA nudges and return a lightweight difficulty hint."""
    result = await orchestrator.apply_live_signals(
        current_user.id, body.nudges, db
    )
    return AdjustmentHintOut(
        new_difficulty=result["new_difficulty"],
        rationale=result["rationale"],
        signals_summary=result["signals_summary"],
    )


# ---------------------------------------------------------------------------
# Stateless demo endpoint
# ---------------------------------------------------------------------------


@router.get("/demo/strategy")
def demo_strategy(
    openness: float = 50.0,
    conscientiousness: float = 50.0,
    extraversion: float = 50.0,
    agreeableness: float = 50.0,
    neuroticism: float = 50.0,
) -> dict:
    """
    Stateless demo — returns the strategy and difficulty the engine would compute
    for any OCEAN score set. No DB, no auth. Safe for live demos.

    Example (intro vs. extro pair):
      ?extraversion=25&neuroticism=70
      ?extraversion=80&neuroticism=30
    """
    scores = OceanScores(
        openness=openness,
        conscientiousness=conscientiousness,
        extraversion=extraversion,
        agreeableness=agreeableness,
        neuroticism=neuroticism,
    )
    strategy = optimize_strategy(scores)
    difficulty, rationale = initial_difficulty(scores)
    return {
        "input": scores.model_dump(),
        "strategy": strategy.model_dump(),
        "difficulty": difficulty,
        "difficulty_rationale": rationale,
    }
