"""
Personalised Training Plan API — goal-conditioned plan generation.

Mounted under the same /apa prefix as pedagogy.py (see api_router.py). Kept as
a separate flat file because pedagogy.py is already ~500 lines.

Auth: learner routes use get_current_user; the scenario-brief route accepts
X-Service-Token OR a user JWT — the same dual scheme as /apa/session-feedback,
so RPE can fetch a brief without user context.

The literal paths /active and /skill-vocabulary are declared BEFORE /{plan_id}
so FastAPI does not try to parse them as UUIDs.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.config import get_settings
from app.contracts.training_plan import ScenarioGenerationBrief
from app.core.auth import get_current_user, verify_jwt
from app.core.llm_client import get_apm_llm_client
from app.models.user import User
from app.schemas.training_plan import (
    GenerateTrainingPlanIn,
    PersonalisedTrainingPlanOut,
    SkillVocabularyOut,
    TrainingPlanListOut,
    TrainingPlanSummaryOut,
    UpdatePlanStatusIn,
)
from app.services.pedagogy import plan_service
from app.services.pedagogy.plan_service import (
    PersonalityProfileMissing,
    PlanNotFound,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training-plan", tags=["Adaptive Pedagogy"])

_bearer_opt = HTTPBearer(auto_error=False)

# The frontend switches on this code to route the learner to the survey.
PERSONALITY_PROFILE_MISSING = "PERSONALITY_PROFILE_MISSING"


def _profile_missing_error(exc: PersonalityProfileMissing) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error_code": PERSONALITY_PROFILE_MISSING,
            "message": str(exc),
        },
    )


def _not_found(exc: PlanNotFound) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


def _to_summary(plan) -> TrainingPlanSummaryOut:
    return TrainingPlanSummaryOut(
        plan_id=plan.id,
        plan_version=plan.plan_version,
        status=plan.status,
        domain=plan.domain,
        title_hint=plan.title_hint,
        difficulty=plan.difficulty,
        target_skills=plan.target_skills or [],
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


# --- literal routes — must precede /{plan_id} ------------------------------


@router.get("/skill-vocabulary", response_model=SkillVocabularyOut)
def get_skill_vocabulary(
    current_user: User = Depends(get_current_user),
) -> SkillVocabularyOut:
    """
    RPE's fixed 11-skill vocabulary, so the frontend multi-select cannot drift
    from adapter.RPE_SKILL_VOCABULARY.
    """
    skills = plan_service.skill_vocabulary()
    return SkillVocabularyOut(skills=skills, count=len(skills))


@router.get("/active", response_model=PersonalisedTrainingPlanOut)
def get_active_plan(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonalisedTrainingPlanOut:
    """Latest active plan for the current user."""
    try:
        plan = plan_service.get_active_plan(current_user.id, db)
    except PlanNotFound as exc:
        raise _not_found(exc)
    return plan_service.plan_to_out(plan)


@router.post(
    "/generate",
    response_model=PersonalisedTrainingPlanOut,
    status_code=status.HTTP_201_CREATED,
)
async def generate_training_plan(
    body: GenerateTrainingPlanIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonalisedTrainingPlanOut:
    """
    Generate a personalised training plan from the learner's stated goal.

    Combines the goal text with the learner's OCEAN profile, MCA baseline and
    recent session history. Returns 409 PERSONALITY_PROFILE_MISSING when the
    BFI-44 survey has not been completed.

    LLM degradation never fails the request: if the APM Gemini key is missing
    or Gemini errors, intent parsing falls back to its deterministic keyword
    parser and this endpoint still returns 201.
    """
    llm = get_apm_llm_client()
    try:
        plan = await plan_service.generate_plan(current_user.id, db, body, llm)
    except PersonalityProfileMissing as exc:
        raise _profile_missing_error(exc)
    return plan_service.plan_to_out(plan)


@router.get("", response_model=TrainingPlanListOut)
def list_training_plans(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TrainingPlanListOut:
    """Paginated plan history for the current user, newest first."""
    total, rows = plan_service.list_plans(
        current_user.id, db, limit=limit, offset=offset
    )
    return TrainingPlanListOut(
        total=total,
        limit=limit,
        offset=offset,
        items=[_to_summary(p) for p in rows],
    )


# --- per-plan routes -------------------------------------------------------


@router.get("/{plan_id}", response_model=PersonalisedTrainingPlanOut)
def get_training_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonalisedTrainingPlanOut:
    """Fetch one plan. 404 if it does not exist or belongs to another user."""
    try:
        plan = plan_service.get_plan(current_user.id, plan_id, db)
    except PlanNotFound as exc:
        raise _not_found(exc)
    return plan_service.plan_to_out(plan)


@router.post(
    "/{plan_id}/regenerate",
    response_model=PersonalisedTrainingPlanOut,
    status_code=status.HTTP_201_CREATED,
)
async def regenerate_training_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonalisedTrainingPlanOut:
    """
    Rebuild the plan from the same intent against refreshed inputs.

    The previous row is archived and the new row carries plan_version + 1.
    """
    llm = get_apm_llm_client()
    try:
        plan = await plan_service.regenerate_plan(
            current_user.id, plan_id, db, llm
        )
    except PlanNotFound as exc:
        raise _not_found(exc)
    except PersonalityProfileMissing as exc:
        raise _profile_missing_error(exc)
    return plan_service.plan_to_out(plan)


@router.patch("/{plan_id}/status", response_model=PersonalisedTrainingPlanOut)
def update_plan_status(
    plan_id: uuid.UUID,
    body: UpdatePlanStatusIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonalisedTrainingPlanOut:
    """Activate or archive a plan. Activating archives any other active plan."""
    try:
        plan = plan_service.set_plan_status(
            current_user.id, plan_id, body.action, db
        )
    except PlanNotFound as exc:
        raise _not_found(exc)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )
    return plan_service.plan_to_out(plan)


# --- service route — RPE calls this ----------------------------------------


@router.get("/{plan_id}/scenario-brief", response_model=ScenarioGenerationBrief)
def get_scenario_brief(
    plan_id: uuid.UUID,
    x_service_token: Optional[str] = Header(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_opt),
    db: Session = Depends(get_db),
) -> ScenarioGenerationBrief:
    """
    The complete scenario build spec for RPE.

    Auth (priority order, matching POST /apa/session-feedback):
      1. Bearer JWT — the caller must own the plan
      2. X-Service-Token matching APM_SERVICE_TOKEN — trusted service call

    Stamps consumed_at on every successful fetch but deliberately does not
    change status, so RPE can retry safely.
    """
    settings = get_settings()

    if credentials is not None:
        payload = verify_jwt(credentials.credentials)
        user_uuid = uuid.UUID(payload.sub)
        try:
            plan = plan_service.get_plan(user_uuid, plan_id, db)
        except PlanNotFound as exc:
            raise _not_found(exc)
    elif x_service_token and x_service_token == settings.apm_service_token:
        from app.models.training_plan import PersonalisedTrainingPlan

        plan = (
            db.query(PersonalisedTrainingPlan)
            .filter(PersonalisedTrainingPlan.id == plan_id)
            .first()
        )
        if plan is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No training plan {plan_id}.",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Provide a Bearer token or a valid X-Service-Token header",
        )

    try:
        brief = plan_service.plan_to_scenario_brief(plan, db)
    except PersonalityProfileMissing as exc:
        raise _profile_missing_error(exc)

    plan_service.mark_consumed(plan, db)
    logger.info("Scenario brief for plan %s served to RPE", plan.id)
    return brief
