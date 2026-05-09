"""
APM Demo-mode endpoints — /apa/demo/*

Enabled only when settings.apm_demo_mode is True (set APM_DEMO_MODE=true in
.env).  All endpoints return 403 when demo mode is off so they are safe to
leave registered in non-demo environments.

Two built-in personas shortcut the survey+baseline flow for live demos:
  alex   — anxious introvert  (N=70, E=25, O=40, C=40, A=55)
  jordan — confident extrovert (N=30, E=80, O=65, C=70, A=55)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.v1.pedagogy import _plan_to_out
from app.config import get_settings
from app.core.auth import get_current_user
from app.core.llm_client import get_llm_client
from app.core.rpe_client import get_rpe_client
from app.contracts.rpe import CoachingAdvice, FeedbackResponse, TurnMetric
from app.models.baseline_snapshot import BaselineSnapshot
from app.models.personality_profile import PersonalityProfile
from app.models.user import User
from app.schemas.pedagogy import TrainingPlanOut
from app.services.pedagogy import orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(tags=["APM Demo"])

# ---------------------------------------------------------------------------
# Pre-canned personas
# ---------------------------------------------------------------------------

_PERSONAS: dict[str, dict[str, Any]] = {
    "alex": {
        "id": "alex",
        "label": "Alex — Anxious Introvert",
        "description": (
            "High neuroticism, low extraversion. Needs a gentle, slow, "
            "supportive path. Baseline shows elevated stress and low confidence."
        ),
        "ocean": {
            "openness": 40.0,
            "conscientiousness": 40.0,
            "extraversion": 25.0,
            "agreeableness": 55.0,
            "neuroticism": 70.0,
        },
        "baseline": {
            "stress_indicator": 0.72,
            "confidence_indicator": 0.18,
            "skill_scores": {
                "assertiveness": 0.25,
                "boundary_setting": 0.30,
                "emotional_regulation": 0.35,
            },
            "emotion_distribution": {
                "anxious": 0.45,
                "nervous": 0.27,
                "calm": 0.18,
                "neutral": 0.10,
            },
            "overall_score": 38.0,
            "duration_seconds": 210,
        },
    },
    "jordan": {
        "id": "jordan",
        "label": "Jordan — Confident Extrovert",
        "description": (
            "Low neuroticism, high extraversion and conscientiousness. "
            "Ready for a challenging, fast-paced plan. Baseline shows composure."
        ),
        "ocean": {
            "openness": 65.0,
            "conscientiousness": 70.0,
            "extraversion": 80.0,
            "agreeableness": 55.0,
            "neuroticism": 30.0,
        },
        "baseline": {
            "stress_indicator": 0.15,
            "confidence_indicator": 0.75,
            "skill_scores": {
                "political_awareness": 0.45,
                "conflict_resolution": 0.60,
            },
            "emotion_distribution": {
                "confident": 0.55,
                "calm": 0.30,
                "neutral": 0.10,
                "anxious": 0.05,
            },
            "overall_score": 74.0,
            "duration_seconds": 185,
        },
    },
}

# ---------------------------------------------------------------------------
# Outcome presets for simulate-session
# ---------------------------------------------------------------------------

_SESSION_PRESETS: dict[str, dict[str, Any]] = {
    "success": {
        "outcome": "success",
        "final_trust": 82,
        "final_escalation": 1,
        "turn_metrics": [
            TurnMetric(turn=i, assertiveness_score=0.8, empathy_score=0.75,
                       clarity_score=0.82, response_quality=0.80)
            for i in range(1, 6)
        ],
    },
    "partial": {
        "outcome": "partial",
        "final_trust": 50,
        "final_escalation": 2,
        "turn_metrics": [
            TurnMetric(turn=i, assertiveness_score=0.55, empathy_score=0.50,
                       clarity_score=0.55, response_quality=0.52)
            for i in range(1, 6)
        ],
    },
    "failure": {
        "outcome": "failure",
        "final_trust": 20,
        "final_escalation": 3,
        "turn_metrics": [
            TurnMetric(turn=i, assertiveness_score=0.25, empathy_score=0.30,
                       clarity_score=0.28, response_quality=0.28)
            for i in range(1, 6)
        ],
    },
}


def _require_demo_mode() -> None:
    if not get_settings().apm_demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Demo mode is not enabled. "
                "Set APM_DEMO_MODE=true in your .env to unlock /apa/demo/* endpoints."
            ),
        )


# ---------------------------------------------------------------------------
# Request / response schemas (local — demo-only, not part of the main API)
# ---------------------------------------------------------------------------

class InjectPersonaIn(BaseModel):
    persona_id: str


class SimulateSessionIn(BaseModel):
    outcome: str = "partial"  # "success" | "partial" | "failure"


class PersonaOut(BaseModel):
    id: str
    label: str
    description: str
    ocean: dict[str, float]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/demo/personas", response_model=list[PersonaOut])
def list_personas() -> list[PersonaOut]:
    """Return the available demo personas."""
    _require_demo_mode()
    return [
        PersonaOut(
            id=p["id"],
            label=p["label"],
            description=p["description"],
            ocean=p["ocean"],
        )
        for p in _PERSONAS.values()
    ]


@router.post("/demo/inject-persona", response_model=TrainingPlanOut, status_code=201)
async def inject_persona(
    body: InjectPersonaIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    rpe=Depends(get_rpe_client),
    llm=Depends(get_llm_client),
) -> TrainingPlanOut:
    """
    Inject a pre-canned persona for the current user and generate a training plan.

    Upserts PersonalityProfile and BaselineSnapshot, then calls
    orchestrator.generate_training_plan so the plan reflects both OCEAN and
    baseline evidence.  Returns the full TrainingPlanOut (including brief_json).
    """
    _require_demo_mode()

    persona = _PERSONAS.get(body.persona_id.lower())
    if persona is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown persona_id {body.persona_id!r}. "
                   f"Valid values: {list(_PERSONAS)}",
        )

    now = datetime.now(timezone.utc)
    user_id = current_user.id
    ocean = persona["ocean"]
    bl = persona["baseline"]

    # --- upsert PersonalityProfile ---
    profile = (
        db.query(PersonalityProfile)
        .filter(PersonalityProfile.user_id == user_id)
        .first()
    )
    if profile is None:
        profile = PersonalityProfile(
            user_id=user_id,
            openness=ocean["openness"],
            conscientiousness=ocean["conscientiousness"],
            extraversion=ocean["extraversion"],
            agreeableness=ocean["agreeableness"],
            neuroticism=ocean["neuroticism"],
            raw_responses={},
            version="demo-v1",
            created_at=now,
            updated_at=now,
        )
        db.add(profile)
    else:
        profile.openness = ocean["openness"]
        profile.conscientiousness = ocean["conscientiousness"]
        profile.extraversion = ocean["extraversion"]
        profile.agreeableness = ocean["agreeableness"]
        profile.neuroticism = ocean["neuroticism"]
        profile.updated_at = now

    # --- upsert BaselineSnapshot ---
    snapshot = (
        db.query(BaselineSnapshot)
        .filter(BaselineSnapshot.user_id == user_id)
        .first()
    )
    if snapshot is None:
        snapshot = BaselineSnapshot(
            user_id=user_id,
            mca_session_id=f"demo-{body.persona_id}-{uuid.uuid4().hex[:8]}",
            skill_scores=bl["skill_scores"],
            emotion_distribution=bl["emotion_distribution"],
            overall_score=bl["overall_score"],
            duration_seconds=bl["duration_seconds"],
            created_at=now,
            updated_at=now,
        )
        db.add(snapshot)
    else:
        snapshot.mca_session_id = f"demo-{body.persona_id}-{uuid.uuid4().hex[:8]}"
        snapshot.skill_scores = bl["skill_scores"]
        snapshot.emotion_distribution = bl["emotion_distribution"]
        snapshot.overall_score = bl["overall_score"]
        snapshot.duration_seconds = bl["duration_seconds"]
        snapshot.updated_at = now

    db.commit()

    logger.info(
        "Demo persona %r injected for user %s", body.persona_id, user_id
    )

    plan = await orchestrator.generate_training_plan(
        user_id=user_id,
        db=db,
        rpe=rpe,
        llm=llm,
        skill="job_interview",
    )
    return _plan_to_out(plan)


@router.post("/demo/simulate-session", response_model=TrainingPlanOut)
async def simulate_session(
    body: SimulateSessionIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TrainingPlanOut:
    """
    Simulate a completed RPE session for the current user.

    Builds a synthetic FeedbackResponse matching the requested outcome
    (success / partial / failure) and feeds it through
    orchestrator.apply_session_feedback.  Requires a training plan to exist
    (call /demo/inject-persona first).
    """
    _require_demo_mode()

    outcome_key = body.outcome.lower()
    if outcome_key not in _SESSION_PRESETS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown outcome {body.outcome!r}. "
                   "Valid values: success, partial, failure",
        )

    preset = _SESSION_PRESETS[outcome_key]
    fb = FeedbackResponse(
        session_id=f"demo-session-{uuid.uuid4().hex[:8]}",
        scenario_id="demo-scenario-001",
        scenario_title="Demo: Job Interview Scenario",
        user_id=str(current_user.id),
        outcome=preset["outcome"],
        final_trust=preset["final_trust"],
        final_escalation=preset["final_escalation"],
        total_turns=5,
        turn_metrics=preset["turn_metrics"],
        coaching_advice=CoachingAdvice(
            overall_rating=preset["outcome"],
            summary=f"Simulated {preset['outcome']} session for demo.",
            advice=[],
            strengths=[],
            focus_areas=[],
        ),
    )

    plan = await orchestrator.apply_session_feedback(
        user_id=current_user.id,
        fb=fb,
        db=db,
    )
    return _plan_to_out(plan)
