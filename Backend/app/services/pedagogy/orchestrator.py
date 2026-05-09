"""
APM Orchestrator — coordinates personality profile → strategy → scenario
selection and manages the adaptive feedback loop.

Three entry points:
  generate_training_plan  — called on survey submit (and by the API directly)
  apply_session_feedback  — called when RPE posts end-of-session results
  apply_live_signals      — called mid-session from MCA nudges (lightweight)

All are async; callers must await them.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.contracts.mca import McaNudge
from app.contracts.rpe import FeedbackResponse
from app.core.llm_client import GeminiClient
from app.core.rpe_client import RpeClient
from app.models.baseline_snapshot import BaselineSnapshot
from app.models.personality_profile import PersonalityProfile
from app.models.training_plan import AdjustmentHistory, TrainingPlan
from app.services.pedagogy import analytics_writer
from app.services.pedagogy.aggregator import PerformanceAggregator
from app.services.pedagogy.baseline_summarizer import summarize as summarize_baseline
from app.services.pedagogy.brief_generator import generate_brief
from app.services.pedagogy.dda_engine import initial_difficulty
from app.services.pedagogy.dynamic_adjuster import adjust
from app.services.pedagogy.scenario_selector import select_scenarios
from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import BaselineSummary, OceanScores, TeachingStrategy

logger = logging.getLogger(__name__)


def _load_ocean(user_id: uuid.UUID, db: Session) -> Optional[OceanScores]:
    profile = (
        db.query(PersonalityProfile)
        .filter(PersonalityProfile.user_id == user_id)
        .first()
    )
    if profile is None:
        return None
    return OceanScores(
        openness=profile.openness,
        conscientiousness=profile.conscientiousness,
        extraversion=profile.extraversion,
        agreeableness=profile.agreeableness,
        neuroticism=profile.neuroticism,
    )


def _load_plan(user_id: uuid.UUID, db: Session) -> Optional[TrainingPlan]:
    return (
        db.query(TrainingPlan)
        .filter(TrainingPlan.user_id == user_id)
        .first()
    )


def _load_baseline_summary(user_id: uuid.UUID, db: Session) -> BaselineSummary:
    """Return a BaselineSummary for the user; has_baseline=False if none exists."""
    snapshot = (
        db.query(BaselineSnapshot)
        .filter(BaselineSnapshot.user_id == user_id)
        .first()
    )
    return summarize_baseline(snapshot)


async def generate_training_plan(
    user_id: uuid.UUID,
    db: Session,
    rpe: RpeClient,
    llm: GeminiClient,
    skill: str = "job_interview",
) -> TrainingPlan:
    """
    Generate (or regenerate) a training plan for the user.

    Raises ValueError if no PersonalityProfile exists for the user.
    When a BaselineSnapshot exists for the user, the plan is adjusted to
    reflect measured vocal/emotional evidence from the baseline session.
    """
    scores = _load_ocean(user_id, db)
    if scores is None:
        raise ValueError(
            f"No personality profile for user {user_id}. Submit the survey first."
        )

    baseline = _load_baseline_summary(user_id, db)
    if baseline.has_baseline:
        logger.info(
            "Baseline available for user %s (stress=%.2f, confidence=%.2f)",
            user_id,
            baseline.stress_indicator or 0.0,
            baseline.confidence_indicator or 0.0,
        )

    strategy = optimize_strategy(scores, baseline=baseline)
    difficulty, _rationale = initial_difficulty(scores, baseline=baseline)
    brief = generate_brief(scores, strategy, baseline, difficulty)

    now = datetime.now(timezone.utc)
    plan = _load_plan(user_id, db)

    baseline_json: Optional[dict] = (
        baseline.model_dump() if baseline.has_baseline else None
    )

    if plan is None:
        plan = TrainingPlan(
            user_id=user_id,
            skill=skill,
            strategy_json=strategy.model_dump(),
            difficulty=difficulty,
            recommended_scenario_ids=[],
            primary_scenario_json=None,
            generation_source="gemini_fallback",  # placeholder, updated below
            generation_status="pending",
            baseline_summary_json=baseline_json,
            brief_json=brief.model_dump(),
            created_at=now,
            updated_at=now,
        )
        db.add(plan)
    else:
        plan.skill = skill
        plan.strategy_json = strategy.model_dump()
        plan.difficulty = difficulty
        plan.generation_status = "pending"
        plan.baseline_summary_json = baseline_json
        plan.brief_json = brief.model_dump()
        plan.updated_at = now

    db.commit()
    db.refresh(plan)

    result = await select_scenarios(
        profile=scores,
        strategy=strategy,
        difficulty=difficulty,
        skill=skill,
        rpe=rpe,
        llm=llm,
        user_id=str(user_id),
    )

    plan.primary_scenario_json = result.primary_scenario
    plan.recommended_scenario_ids = result.recommended_scenario_ids
    plan.generation_source = result.generation_source
    plan.generation_status = (
        "scenario_failed"
        if result.primary_scenario.get("scenario_id") == "none"
        else "completed"
    )
    plan.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(plan)

    analytics_writer.write_skill_predictions(str(user_id), plan, db)

    return plan


async def apply_session_feedback(
    user_id: uuid.UUID,
    fb: FeedbackResponse,
    db: Session,
) -> TrainingPlan:
    """
    Process end-of-session RPE feedback and update the training plan.

    Raises ValueError if no training plan exists for the user.
    """
    plan = _load_plan(user_id, db)
    if plan is None:
        raise ValueError(
            f"No training plan for user {user_id}. "
            "Generate a plan before submitting session feedback."
        )

    current_strategy = TeachingStrategy(**plan.strategy_json)
    signal = PerformanceAggregator.from_rpe_feedback(fb)
    result = adjust(current_strategy, plan.difficulty, signal, mode="full")

    now = datetime.now(timezone.utc)
    history_entry = AdjustmentHistory(
        user_id=user_id,
        plan_id=plan.id,
        trigger="session_end",
        previous_strategy=plan.strategy_json,
        new_strategy=result.new_strategy.model_dump(),
        previous_difficulty=plan.difficulty,
        new_difficulty=result.new_difficulty,
        signals_summary=result.signals_summary,
        rationale="; ".join(result.rationale),
        created_at=now,
    )
    db.add(history_entry)

    plan.strategy_json = result.new_strategy.model_dump()
    plan.difficulty = result.new_difficulty
    plan.last_adjusted_at = now
    plan.updated_at = now
    db.commit()
    db.refresh(plan)

    analytics_writer.write_session_metrics(fb, db)
    analytics_writer.write_feedback_entries(fb, db)

    return plan


async def apply_live_signals(
    user_id: uuid.UUID,
    nudges: list[McaNudge],
    db: Session,
) -> dict:
    """
    Process mid-session MCA nudges (lightweight — no strategy mutation).

    Persists an AdjustmentHistory row only if difficulty actually changed.
    Returns the AdjustmentResult as a dict for the hint response.
    """
    plan = _load_plan(user_id, db)
    if plan is None:
        return {
            "new_difficulty": 5,
            "rationale": ["No training plan found — using default difficulty"],
            "signals_summary": {},
        }

    current_strategy = TeachingStrategy(**plan.strategy_json)
    signal = PerformanceAggregator.from_mca_nudges(nudges)
    result = adjust(current_strategy, plan.difficulty, signal, mode="lightweight")

    if result.new_difficulty != plan.difficulty:
        now = datetime.now(timezone.utc)
        history_entry = AdjustmentHistory(
            user_id=user_id,
            plan_id=plan.id,
            trigger="live_signal",
            previous_strategy=plan.strategy_json,
            new_strategy=result.new_strategy.model_dump(),
            previous_difficulty=plan.difficulty,
            new_difficulty=result.new_difficulty,
            signals_summary=result.signals_summary,
            rationale="; ".join(result.rationale),
            created_at=now,
        )
        db.add(history_entry)
        plan.difficulty = result.new_difficulty
        plan.last_adjusted_at = now
        plan.updated_at = now
        db.commit()

    return result.model_dump()
