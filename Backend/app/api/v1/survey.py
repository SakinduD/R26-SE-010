import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.auth import get_current_user
from app.models.personality_profile import PersonalityProfile
from app.models.user import User
from app.schemas.survey import (
    OceanScores,
    PersonalityProfileOut,
    QuestionOut,
    SurveySubmitIn,
    TraitScore,
)
from app.services.survey.questions import BFI44_QUESTIONS
from app.services.survey.scorer import interpret_score, score_bfi44

logger = logging.getLogger(__name__)

router = APIRouter(tags=["survey"])


def _build_profile_out(profile: PersonalityProfile) -> PersonalityProfileOut:
    scores = OceanScores(
        openness=TraitScore(score=profile.openness, level=interpret_score(profile.openness)),
        conscientiousness=TraitScore(
            score=profile.conscientiousness,
            level=interpret_score(profile.conscientiousness),
        ),
        extraversion=TraitScore(
            score=profile.extraversion, level=interpret_score(profile.extraversion)
        ),
        agreeableness=TraitScore(
            score=profile.agreeableness, level=interpret_score(profile.agreeableness)
        ),
        neuroticism=TraitScore(
            score=profile.neuroticism, level=interpret_score(profile.neuroticism)
        ),
    )
    return PersonalityProfileOut(
        user_id=profile.user_id,
        scores=scores,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


@router.get("/questions", response_model=list[QuestionOut])
def get_questions() -> list[QuestionOut]:
    """Return all 44 BFI questions. No authentication required."""
    return [QuestionOut(**q) for q in BFI44_QUESTIONS]


async def _fire_generate_plan(user_id: object) -> None:
    """Fire-and-forget training plan generation after survey submit."""
    import uuid as _uuid

    from app.core.llm_client import get_llm_client
    from app.core.rpe_client import RpeClient
    from app.db.database import SessionLocal
    from app.services.pedagogy import orchestrator

    db = SessionLocal()
    try:
        await orchestrator.generate_training_plan(
            _uuid.UUID(str(user_id)), db, RpeClient(), get_llm_client()
        )
        logger.info("Training plan generated for user %s", user_id)
    except Exception:
        logger.exception("Background plan generation failed for user %s", user_id)
    finally:
        db.close()


@router.post("/submit", response_model=PersonalityProfileOut)
async def submit_survey(
    payload: SurveySubmitIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonalityProfileOut:
    """Score BFI-44 answers and persist the result. UPSERT: updates existing profile."""
    try:
        raw_scores = score_bfi44(payload.answers)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    now = datetime.now(timezone.utc)
    profile = (
        db.query(PersonalityProfile)
        .filter(PersonalityProfile.user_id == current_user.id)
        .first()
    )

    if profile is not None:
        profile.openness = raw_scores["openness"]
        profile.conscientiousness = raw_scores["conscientiousness"]
        profile.extraversion = raw_scores["extraversion"]
        profile.agreeableness = raw_scores["agreeableness"]
        profile.neuroticism = raw_scores["neuroticism"]
        profile.raw_responses = {str(k): v for k, v in payload.answers.items()}
        profile.updated_at = now
        logger.info("Updated personality profile for user %s", current_user.id)
    else:
        profile = PersonalityProfile(
            user_id=current_user.id,
            openness=raw_scores["openness"],
            conscientiousness=raw_scores["conscientiousness"],
            extraversion=raw_scores["extraversion"],
            agreeableness=raw_scores["agreeableness"],
            neuroticism=raw_scores["neuroticism"],
            raw_responses={str(k): v for k, v in payload.answers.items()},
            created_at=now,
            updated_at=now,
        )
        db.add(profile)
        logger.info("Created personality profile for user %s", current_user.id)

    db.commit()
    db.refresh(profile)

    asyncio.create_task(_fire_generate_plan(current_user.id))

    return _build_profile_out(profile)


@router.get("/profile/me", response_model=PersonalityProfileOut)
def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PersonalityProfileOut:
    """Return the current user's personality profile, or 404 if not yet submitted."""
    profile = (
        db.query(PersonalityProfile)
        .filter(PersonalityProfile.user_id == current_user.id)
        .first()
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No personality profile found. Submit the survey first.",
        )
    return _build_profile_out(profile)
