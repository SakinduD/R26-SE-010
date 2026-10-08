"""
Learner profile service — the learner's personalised profile, stored.

The profile is what pedagogy derives from the OCEAN survey plus the current
baseline: baseline summary, teaching strategy, recommended difficulty and the
priority / weak skills. It is recalculated on every baseline (first or redo)
and read by plan generation (orchestrator, plan_service) and the role-play
recommender, so they all see one consistent view.

Redoing the baseline updates this profile only. Training plans pick it up when
the learner generates a new plan or presses Regenerate.

A stored row is reused only while it still matches its inputs (same OCEAN
scores, same baseline session, same rules version); otherwise it is
recalculated on read, so a survey retake or a skipped baseline never leaves a
stale profile behind.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.baseline_history import BaselineHistory
from app.models.baseline_snapshot import BaselineSnapshot
from app.models.learner_profile import LearnerProfileRecord
from app.models.personality_profile import PersonalityProfile
from app.services.pedagogy.adapter import infer_weak_skills
from app.services.pedagogy.baseline_summarizer import summarize
from app.services.pedagogy.dda_engine import initial_difficulty
from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import (
    BaselineSummary,
    LearnerProfile,
    OceanScores,
    TeachingStrategy,
)

logger = logging.getLogger(__name__)

# Bump when the rules that derive the profile change, so stored rows are recomputed.
PROFILE_VERSION = "learner-profile-v1"


def load_ocean(user_id: uuid.UUID, db: Session) -> Optional[OceanScores]:
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


def _load_snapshot(user_id: uuid.UUID, db: Session) -> Optional[BaselineSnapshot]:
    return (
        db.query(BaselineSnapshot)
        .filter(BaselineSnapshot.user_id == user_id)
        .first()
    )


def _load_record(user_id: uuid.UUID, db: Session) -> Optional[LearnerProfileRecord]:
    return (
        db.query(LearnerProfileRecord)
        .filter(LearnerProfileRecord.user_id == user_id)
        .first()
    )


def compute_profile(
    ocean: OceanScores, snapshot: Optional[BaselineSnapshot]
) -> LearnerProfile:
    """Pure: OCEAN + baseline snapshot → LearnerProfile."""
    baseline = summarize(snapshot)
    strategy = optimize_strategy(ocean, baseline=baseline)
    difficulty, rationale = initial_difficulty(ocean, baseline=baseline)
    return LearnerProfile(
        source_mca_session_id=snapshot.mca_session_id if snapshot else None,
        ocean=ocean,
        baseline=baseline,
        strategy=strategy,
        difficulty=difficulty,
        difficulty_rationale=rationale,
        priority_skills=list(strategy.priority_skills),
        weak_skills=infer_weak_skills(ocean, strategy, baseline),
    )


def _record_to_profile(record: LearnerProfileRecord) -> LearnerProfile:
    return LearnerProfile(
        source_mca_session_id=record.source_mca_session_id,
        ocean=OceanScores(**record.ocean_scores),
        baseline=BaselineSummary(**record.baseline_json),
        strategy=TeachingStrategy(**record.strategy_json),
        difficulty=record.difficulty,
        difficulty_rationale=list(record.difficulty_rationale or []),
        priority_skills=list(record.priority_skills or []),
        weak_skills=list(record.weak_skills or []),
    )


def _is_current(
    record: LearnerProfileRecord,
    ocean: OceanScores,
    snapshot: Optional[BaselineSnapshot],
) -> bool:
    return (
        record.profile_version == PROFILE_VERSION
        and record.ocean_scores == ocean.model_dump()
        and record.source_mca_session_id == (snapshot.mca_session_id if snapshot else None)
    )


def recalculate(
    user_id: uuid.UUID, db: Session, *, ocean: Optional[OceanScores] = None
) -> LearnerProfile:
    """
    Recompute the profile from the OCEAN survey and the current baseline, and
    store it. Raises ValueError if the learner has no personality profile.
    """
    ocean = ocean or load_ocean(user_id, db)
    if ocean is None:
        raise ValueError(
            f"No personality profile for user {user_id}. Submit the survey first."
        )

    snapshot = _load_snapshot(user_id, db)
    profile = compute_profile(ocean, snapshot)

    now = datetime.now(timezone.utc)
    record = _load_record(user_id, db)
    if record is None:
        record = LearnerProfileRecord(user_id=user_id)
        db.add(record)
    record.profile_version = PROFILE_VERSION
    record.source_mca_session_id = profile.source_mca_session_id
    record.ocean_scores = ocean.model_dump()
    record.baseline_json = profile.baseline.model_dump()
    record.strategy_json = profile.strategy.model_dump()
    record.difficulty = profile.difficulty
    record.difficulty_rationale = profile.difficulty_rationale
    record.priority_skills = profile.priority_skills
    record.weak_skills = profile.weak_skills
    record.computed_at = now
    db.commit()

    logger.info(
        "Learner profile recalculated for user %s (baseline=%s, difficulty=%d, weak_skills=%s)",
        user_id,
        profile.source_mca_session_id,
        profile.difficulty,
        profile.weak_skills,
    )
    return profile


def get_current(
    user_id: uuid.UUID, db: Session, *, ocean: Optional[OceanScores] = None
) -> LearnerProfile:
    """
    The stored profile, recalculated first if it is missing or out of date.
    Raises ValueError if the learner has no personality profile.
    """
    ocean = ocean or load_ocean(user_id, db)
    if ocean is None:
        raise ValueError(
            f"No personality profile for user {user_id}. Submit the survey first."
        )

    record = _load_record(user_id, db)
    if record is not None and _is_current(record, ocean, _load_snapshot(user_id, db)):
        return _record_to_profile(record)
    return recalculate(user_id, db, ocean=ocean)


def get_record(user_id: uuid.UUID, db: Session) -> Optional[LearnerProfileRecord]:
    """The stored row (for computed_at); call get_current first to refresh it."""
    return _load_record(user_id, db)


def append_baseline_history(snapshot: BaselineSnapshot, db: Session) -> BaselineHistory:
    """Keep a permanent copy of a submitted baseline. Caller commits."""
    entry = BaselineHistory(
        user_id=snapshot.user_id,
        mca_session_id=snapshot.mca_session_id,
        skill_scores=snapshot.skill_scores,
        emotion_distribution=snapshot.emotion_distribution,
        overall_score=snapshot.overall_score,
        duration_seconds=snapshot.duration_seconds,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    return entry


def list_baseline_history(user_id: uuid.UUID, db: Session) -> list[BaselineHistory]:
    """Every baseline the learner submitted, newest first."""
    return (
        db.query(BaselineHistory)
        .filter(BaselineHistory.user_id == user_id)
        .order_by(BaselineHistory.created_at.desc())
        .all()
    )
