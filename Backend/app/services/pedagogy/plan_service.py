"""
Plan Service — async orchestration + persistence for goal-conditioned
Training Plans.

The only module in the training-plan path that touches I/O. It reuses the
existing pedagogy components (strategy_optimizer, dda_engine, dynamic_adjuster,
adapter, brief_generator) rather than reimplementing any of them.

Pipeline (POST /apa/training-plan/generate):
    1. Load PersonalityProfile     → PersonalityProfileMissing if absent (409)
    2. Load BaselineSnapshot + recent session history
    3. Parse intent
    4. Strategy + difficulty; recalibrate via dynamic_adjuster when history exists
    5. Target skills = weak skills ∪ intent focus skills, ranked, RPE-constrained
    6. Compose (pure)
    7. Persist and return
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.contracts.training_plan import (
    SCHEMA_VERSION,
    LearnerIntentWire,
    ScenarioGenerationBrief,
)
from app.core.llm_client import GeminiClient
from app.models.analytics import AnalyticsSessionMetric
from app.models.baseline_snapshot import BaselineSnapshot
from app.models.personality_profile import PersonalityProfile
from app.models.training_plan import PersonalisedTrainingPlan, TrainingPlan
from app.schemas.training_plan import (
    GenerateTrainingPlanIn,
    LearnerIntent,
    PersonalisedTrainingPlanOut,
)
from app.services.pedagogy import intent_parser, plan_composer
from app.services.pedagogy.adapter import (
    RPE_SKILL_VOCABULARY,
    difficulty_int_to_label,
    infer_weak_skills,
    to_rpe_profile,
)
from app.services.pedagogy.baseline_summarizer import summarize as summarize_baseline
from app.services.pedagogy.brief_generator import generate_brief
from app.services.pedagogy.dda_engine import initial_difficulty
from app.services.pedagogy.dynamic_adjuster import adjust
from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import (
    BaselineSummary,
    OceanScores,
    PerformanceSignal,
    TeachingStrategy,
)

logger = logging.getLogger(__name__)

# How many recent sessions feed the recalibration pass.
SESSION_HISTORY_WINDOW = 5

# AnalyticsSessionMetric stores 0-100; PerformanceSignal wants 0.0-1.0.
# This is a metrics-scale conversion, NOT an OCEAN conversion — adapter.py's
# single-site rule is about personality scores only.
_METRIC_SCALE = 100.0

# Outcome thresholds when deriving a signal from stored session metrics.
_OUTCOME_SUCCESS_AT = 0.7
_OUTCOME_FAILURE_BELOW = 0.4

MAX_TARGET_SKILLS = 5


class PersonalityProfileMissing(Exception):
    """
    Raised when the learner has no PersonalityProfile.

    The API layer turns this into 409 PERSONALITY_PROFILE_MISSING so the
    frontend can route the user to the BFI-44 survey.
    """


class PlanNotFound(Exception):
    """Raised when a plan id does not exist or is not owned by the caller."""


def _load_ocean(user_id: uuid.UUID, db: Session) -> OceanScores:
    profile = (
        db.query(PersonalityProfile)
        .filter(PersonalityProfile.user_id == user_id)
        .first()
    )
    if profile is None:
        raise PersonalityProfileMissing(
            f"No personality profile for user {user_id}. Complete the survey first."
        )
    return OceanScores(
        openness=profile.openness,
        conscientiousness=profile.conscientiousness,
        extraversion=profile.extraversion,
        agreeableness=profile.agreeableness,
        neuroticism=profile.neuroticism,
    )


def _load_baseline(user_id: uuid.UUID, db: Session) -> BaselineSummary:
    snapshot = (
        db.query(BaselineSnapshot)
        .filter(BaselineSnapshot.user_id == user_id)
        .first()
    )
    return summarize_baseline(snapshot)


def _load_recent_metrics(
    user_id: uuid.UUID, db: Session
) -> list[AnalyticsSessionMetric]:
    """Most recent completed sessions for this learner, newest first."""
    return (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.user_id == str(user_id))
        .order_by(AnalyticsSessionMetric.created_at.desc())
        .limit(SESSION_HISTORY_WINDOW)
        .all()
    )


def _signal_from_metrics(
    metrics: list[AnalyticsSessionMetric],
) -> Optional[PerformanceSignal]:
    """
    Reduce stored session metrics to a PerformanceSignal for dynamic_adjuster.

    Returns None when there is nothing to learn from, so the caller can skip
    recalibration entirely rather than feeding it a neutral signal.
    """
    scored = [m for m in metrics if m.overall_score is not None]
    if not scored:
        return None

    def _mean(attr: str) -> float:
        values = [
            getattr(m, attr) for m in scored if getattr(m, attr, None) is not None
        ]
        if not values:
            return 0.5
        return max(0.0, min(1.0, (sum(values) / len(values)) / _METRIC_SCALE))

    overall = _mean("overall_score")
    engagement = _mean("response_quality_score")
    confidence = _mean("confidence_score")

    if overall >= _OUTCOME_SUCCESS_AT:
        outcome = "success"
    elif overall < _OUTCOME_FAILURE_BELOW:
        outcome = "failure"
    else:
        outcome = "partial"

    return PerformanceSignal(
        engagement_score=engagement,
        confidence_score=confidence,
        objective_completion_rate=overall,
        # Analytics metrics carry no direct stress channel; low clarity under
        # pressure is the closest stored proxy.
        stress_level=max(0.0, min(1.0, 1.0 - _mean("clarity_score"))),
        outcome=outcome,
    )


def _longitudinal_signal(
    user_id: uuid.UUID, db: Session
) -> tuple[Optional[PerformanceSignal], Optional[dict]]:
    """The learner profile the analytics module has built across many sessions.

    ``_signal_from_metrics`` above averages the most recent session rows. That is
    a fair summary of *recent* performance but it cannot see direction: a learner
    averaging 70 while sliding from 85 looks identical to one climbing from 55.

    The Feedback System & Predictive Analytics module owns that longer view —
    per-skill trend direction, blind spots where self-perception has drifted from
    observed behaviour, and the behavioural risk model's forecast — and reduces it
    to the same normalised PerformanceSignal. Preferring it here is what makes a
    regenerated plan reflect where the learner is *heading* rather than only where
    they have been.

    Returns ``(signal, evidence)``; ``(None, None)`` when analytics has no
    session evidence yet, so the caller falls back to the metric averages.
    """
    try:
        from app.services import analytics_feedback_loop_service
    except ImportError:  # pragma: no cover - analytics module optional
        return None, None

    try:
        profile = analytics_feedback_loop_service.build_learner_profile_signal(
            db, str(user_id)
        )
    except Exception:
        logger.exception(
            "Longitudinal analytics signal unavailable for user %s — "
            "falling back to recent session averages",
            user_id,
        )
        return None, None

    if profile.evidence_sessions == 0:
        return None, None

    evidence = {
        "analyzed_skills": profile.analyzed_skill_count,
        "improving": profile.improving_count,
        "declining": profile.declining_count,
        "blind_spots_high": profile.blind_spot_high,
        "high_risk_skills": profile.high_risk_skill_count,
        "evidence_sessions": profile.evidence_sessions,
    }
    return (
        PerformanceSignal(
            engagement_score=profile.engagement_score,
            confidence_score=profile.confidence_score,
            objective_completion_rate=profile.objective_completion_rate,
            stress_level=profile.stress_level,
            outcome=profile.outcome,
        ),
        evidence,
    )


def _rank_target_skills(
    weak_skills: list[str],
    intent_skills: list[str],
    strategy: TeachingStrategy,
) -> list[str]:
    """
    Merge and rank target skills, strictly inside RPE's 11-skill vocabulary.

    Ranking, highest priority first:
      1. Skills the learner asked for that APM independently flagged as weak
      2. Skills the learner explicitly asked for
      3. Baseline-measured priority skills from the strategy
      4. Remaining OCEAN-inferred weak skills

    Capped at MAX_TARGET_SKILLS so RPE gets a focused brief, not a wish list.
    """
    weak_set = set(weak_skills)
    intent_set = set(intent_skills)

    ranked: list[str] = []

    def _add(skills: list[str]) -> None:
        for skill in skills:
            if skill in RPE_SKILL_VOCABULARY and skill not in ranked:
                ranked.append(skill)

    _add([s for s in intent_skills if s in weak_set])
    _add(list(intent_skills))
    _add([s for s in strategy.priority_skills if s not in intent_set])
    _add(weak_skills)

    return ranked[:MAX_TARGET_SKILLS]


def _overrides_from_request(body: GenerateTrainingPlanIn) -> dict[str, Any]:
    """Non-None structured fields from the request — these beat the LLM parse."""
    return {
        "domain": body.domain,
        "workplace_context": body.workplace_context,
        "learner_role": body.learner_role,
        "counterpart_role": body.counterpart_role,
        "counterpart_disposition": body.counterpart_disposition,
        "desired_focus_skills": body.focus_skills,
        "intensity_preference": body.intensity_preference,
        "session_length": body.session_length,
    }


def plan_to_out(plan: PersonalisedTrainingPlan) -> PersonalisedTrainingPlanOut:
    """ORM row → learner-facing response model."""
    return PersonalisedTrainingPlanOut(
        plan_id=plan.id,
        user_id=plan.user_id,
        schema_version=plan.schema_version,
        plan_version=plan.plan_version,
        status=plan.status,
        intent=plan.intent,
        blueprint=plan.blueprint,
        pedagogy=plan.pedagogy,
        adaptation=plan.adaptation,
        personalisation_brief=plan.personalisation_brief,
        target_skills=plan.target_skills or [],
        inputs_snapshot=plan.inputs_snapshot,
        generation_sources=plan.generation_sources or {},
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def plan_to_scenario_brief(
    plan: PersonalisedTrainingPlan, db: Session
) -> ScenarioGenerationBrief:
    """
    ORM row → the RPE-facing wire format.

    The Big Five values are converted 0-100 → 0.0-1.0 by
    adapter.to_rpe_profile(), the single conversion site. If the learner's
    profile has since been deleted, the brief still renders using the OCEAN
    levels captured in inputs_snapshot at generation time.
    """
    ocean = _load_ocean(plan.user_id, db)
    difficulty = int(plan.pedagogy.get("difficulty", plan.difficulty))

    learner_profile = to_rpe_profile(
        ocean,
        list(plan.target_skills or []),
        difficulty,
        user_id=str(plan.user_id),
    )

    return ScenarioGenerationBrief(
        schema_version=plan.schema_version,
        plan_id=str(plan.id),
        plan_version=plan.plan_version,
        user_id=str(plan.user_id),
        generated_at=plan.created_at,
        learner_profile=learner_profile,
        intent=LearnerIntentWire(**plan.intent),
        blueprint=plan.blueprint,
        pedagogy=plan.pedagogy,
        adaptation=plan.adaptation,
        target_skills=list(plan.target_skills or []),
        consumed_at=plan.consumed_at,
    )


async def _build_plan_body(
    user_id: uuid.UUID,
    db: Session,
    body: GenerateTrainingPlanIn,
    llm: Optional[GeminiClient],
    *,
    reuse_intent: Optional[LearnerIntent] = None,
) -> dict[str, Any]:
    """
    Run the full pipeline and return everything needed to persist a row.

    Never raises except PersonalityProfileMissing — every LLM path degrades.
    """
    ocean = _load_ocean(user_id, db)
    baseline = _load_baseline(user_id, db)
    metrics = _load_recent_metrics(user_id, db)

    levels = plan_composer.ocean_levels(ocean)

    # Regenerate reuses the original intent verbatim.
    if reuse_intent is not None:
        intent = reuse_intent
    else:
        intent = await intent_parser.parse_intent(
            body.goal_text,
            structured_overrides=_overrides_from_request(body),
            ocean_levels=levels,
            llm=llm,
        )

    strategy = optimize_strategy(ocean, baseline=baseline)
    difficulty, _rationale = initial_difficulty(ocean, baseline=baseline)

    # Prefer the analytics module's longitudinal learner profile — it knows the
    # direction of travel, not just the recent average. Fall back to averaging
    # the stored session rows when analytics has nothing to say yet.
    signal, analytics_evidence = _longitudinal_signal(user_id, db)
    recalibration_source = "recalibrated_from_analytics"
    if signal is None:
        signal = _signal_from_metrics(metrics)
        recalibration_source = "recalibrated_from_history"

    if signal is not None:
        result = adjust(strategy, difficulty, signal, mode="full")
        logger.info(
            "Recalibrated plan inputs for user %s (%s, %d session rows): "
            "difficulty %d → %d%s",
            user_id,
            recalibration_source,
            len(metrics),
            difficulty,
            result.new_difficulty,
            f" evidence={analytics_evidence}" if analytics_evidence else "",
        )
        # dynamic_adjuster drops priority_skills from its output; carry the
        # baseline-derived ones forward so target-skill ranking keeps them.
        strategy = result.new_strategy.model_copy(
            update={"priority_skills": strategy.priority_skills}
        )
        difficulty = result.new_difficulty
        pedagogy_source = recalibration_source
    else:
        pedagogy_source = "ocean_baseline"

    weak_skills = infer_weak_skills(ocean, strategy, baseline)
    target_skills = _rank_target_skills(
        weak_skills, list(intent.desired_focus_skills), strategy
    )

    composed = plan_composer.compose_plan(
        intent=intent,
        ocean=ocean,
        strategy=strategy,
        difficulty=difficulty,
        baseline=baseline,
        target_skills=target_skills,
    )

    brief = generate_brief(ocean, strategy, baseline, difficulty)

    return {
        "intent": intent,
        "difficulty": difficulty,
        "target_skills": target_skills,
        "blueprint": composed["blueprint"],
        "pedagogy": composed["pedagogy"],
        "adaptation": composed["adaptation"],
        "personalisation_brief": brief.summary,
        "inputs_snapshot": {
            "ocean_levels": levels,
            "baseline_present": baseline.has_baseline,
            "sessions_considered": len(metrics),
        },
        "generation_sources": {
            "intent": intent.parse_source,
            "blueprint": "rule_based",
            "pedagogy": pedagogy_source,
            "brief": "rule_based",
        },
    }


def _archive_active_plans(
    user_id: uuid.UUID, db: Session, *, exclude_id: Optional[uuid.UUID] = None
) -> None:
    """Archive any currently-active plan so /training-plan/active stays single."""
    query = db.query(PersonalisedTrainingPlan).filter(
        PersonalisedTrainingPlan.user_id == user_id,
        PersonalisedTrainingPlan.status == "active",
    )
    if exclude_id is not None:
        query = query.filter(PersonalisedTrainingPlan.id != exclude_id)
    for row in query.all():
        row.status = "archived"
        row.updated_at = datetime.now(timezone.utc)


def _persist(
    user_id: uuid.UUID,
    db: Session,
    parts: dict[str, Any],
    plan_version: int,
) -> PersonalisedTrainingPlan:
    now = datetime.now(timezone.utc)
    intent: LearnerIntent = parts["intent"]

    _archive_active_plans(user_id, db)

    plan = PersonalisedTrainingPlan(
        user_id=user_id,
        schema_version=SCHEMA_VERSION,
        plan_version=plan_version,
        status="active",
        domain=intent.domain,
        difficulty=parts["difficulty"],
        title_hint=parts["blueprint"]["title_hint"][:200],
        intent=intent.model_dump(mode="json"),
        blueprint=parts["blueprint"],
        pedagogy=parts["pedagogy"],
        adaptation=parts["adaptation"],
        inputs_snapshot=parts["inputs_snapshot"],
        generation_sources=parts["generation_sources"],
        target_skills=parts["target_skills"],
        personalisation_brief=parts["personalisation_brief"],
        created_at=now,
        updated_at=now,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    logger.info(
        "Personalised training plan %s v%d created for user %s "
        "(domain=%s, difficulty=%d, intent_source=%s)",
        plan.id,
        plan.plan_version,
        user_id,
        plan.domain,
        plan.difficulty,
        parts["generation_sources"]["intent"],
    )
    return plan


async def generate_plan(
    user_id: uuid.UUID,
    db: Session,
    body: GenerateTrainingPlanIn,
    llm: Optional[GeminiClient] = None,
) -> PersonalisedTrainingPlan:
    """Generate a new plan from a learner's goal text. Starts at version 1."""
    parts = await _build_plan_body(user_id, db, body, llm)
    return _persist(user_id, db, parts, plan_version=1)


async def regenerate_plan(
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    db: Session,
    llm: Optional[GeminiClient] = None,
) -> PersonalisedTrainingPlan:
    """
    Rebuild a plan from the same intent against refreshed OCEAN, baseline and
    session history. The previous row is archived; the new row carries
    plan_version + 1.
    """
    previous = get_plan(user_id, plan_id, db)

    intent = LearnerIntent(**previous.intent)
    body = GenerateTrainingPlanIn(goal_text=intent.raw_text)

    parts = await _build_plan_body(user_id, db, body, llm, reuse_intent=intent)

    previous.status = "archived"
    previous.updated_at = datetime.now(timezone.utc)

    return _persist(user_id, db, parts, plan_version=previous.plan_version + 1)


def get_plan(
    user_id: uuid.UUID, plan_id: uuid.UUID, db: Session
) -> PersonalisedTrainingPlan:
    """
    Fetch one plan, enforcing ownership.

    A plan owned by another user raises PlanNotFound (→ 404, never 403) so the
    endpoint does not leak whether the id exists.
    """
    plan = (
        db.query(PersonalisedTrainingPlan)
        .filter(
            PersonalisedTrainingPlan.id == plan_id,
            PersonalisedTrainingPlan.user_id == user_id,
        )
        .first()
    )
    if plan is None:
        raise PlanNotFound(f"No training plan {plan_id} for this user.")
    return plan


def get_active_plan(
    user_id: uuid.UUID, db: Session
) -> PersonalisedTrainingPlan:
    """Latest active plan for the learner."""
    plan = (
        db.query(PersonalisedTrainingPlan)
        .filter(
            PersonalisedTrainingPlan.user_id == user_id,
            PersonalisedTrainingPlan.status == "active",
        )
        .order_by(PersonalisedTrainingPlan.created_at.desc())
        .first()
    )
    if plan is None:
        raise PlanNotFound("No active training plan for this user.")
    return plan


def list_plans(
    user_id: uuid.UUID, db: Session, *, limit: int, offset: int
) -> tuple[int, list[PersonalisedTrainingPlan]]:
    """Paginated plan history, newest first. Returns (total, rows)."""
    base = db.query(PersonalisedTrainingPlan).filter(
        PersonalisedTrainingPlan.user_id == user_id
    )
    total = base.count()
    rows = (
        base.order_by(PersonalisedTrainingPlan.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return total, rows


def set_plan_status(
    user_id: uuid.UUID, plan_id: uuid.UUID, action: str, db: Session
) -> PersonalisedTrainingPlan:
    """
    Apply an 'activate' or 'archive' transition.

    Activating archives whatever else was active, keeping at most one active
    plan per learner. Raises ValueError on an unknown action.
    """
    plan = get_plan(user_id, plan_id, db)
    now = datetime.now(timezone.utc)

    if action == "activate":
        _archive_active_plans(user_id, db, exclude_id=plan.id)
        plan.status = "active"
    elif action == "archive":
        plan.status = "archived"
    else:
        raise ValueError(
            f"Unknown action {action!r}. Allowed values: activate, archive."
        )

    plan.updated_at = now
    db.commit()
    db.refresh(plan)
    return plan


def mark_consumed(
    plan: PersonalisedTrainingPlan, db: Session
) -> PersonalisedTrainingPlan:
    """
    Stamp consumed_at when RPE fetches the brief.

    Status is intentionally left alone — RPE may retry the fetch, and a retry
    must not look like a state change to the learner.
    """
    plan.consumed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(plan)
    return plan


def skill_vocabulary() -> list[str]:
    """RPE's fixed 11-skill vocabulary, sorted for a stable frontend list."""
    return sorted(RPE_SKILL_VOCABULARY)


def difficulty_band(difficulty: int) -> str:
    """Re-exported for the API layer so it does not import adapter directly."""
    return difficulty_int_to_label(difficulty)


def get_adaptive_state(
    user_id: uuid.UUID, db: Session
) -> Optional[TrainingPlan]:
    """The learner's current adaptive-state row, if orchestrator has made one."""
    return (
        db.query(TrainingPlan)
        .filter(TrainingPlan.user_id == user_id)
        .first()
    )
