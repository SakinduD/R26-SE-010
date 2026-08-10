"""
SQLAlchemy models for APM persistence.

Three tables, three distinct jobs — do not conflate them:

  TrainingPlan (training_plans)
      The user's *adaptive state*: current teaching strategy, current
      difficulty, and the RPE scenario currently recommended. Upserted —
      exactly one row per user (UNIQUE on user_id). Maintained by
      orchestrator.generate_training_plan / apply_session_feedback.

  AdjustmentHistory (adjustment_history)
      Append-only log of every strategy/difficulty change, powering the
      "see how the plan changed" view.

  PersonalisedTrainingPlan (personalised_training_plans)
      A *goal-conditioned* plan: the learner describes a workplace situation
      they want to practise and APM composes a build spec for RPE's scenario
      generator. Many rows per user, versioned and status-tracked; served by
      /apa/training-plan/*. It does not duplicate TrainingPlan — plan_service
      consumes the adaptive state above for the latest recalibrated strategy
      and difficulty.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:  # pragma: no cover
    from app.models.user import User


def json_column_type():
    return JSON().with_variant(JSONB(), "postgresql")


class TrainingPlan(Base):
    __tablename__ = "training_plans"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_training_plans_user_id"),
        CheckConstraint(
            "difficulty BETWEEN 1 AND 10",
            name="ck_training_plans_difficulty_range",
        ),
        CheckConstraint(
            "generation_source IN ('rpe_library', 'gemini_fallback', 'rpe_then_gemini')",
            name="ck_training_plans_generation_source",
        ),
        CheckConstraint(
            "generation_status IN ('pending', 'completed', 'scenario_failed')",
            name="ck_training_plans_generation_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    skill: Mapped[str] = mapped_column(
        String(40), nullable=False, default="job_interview"
    )
    strategy_json: Mapped[dict] = mapped_column(json_column_type(), nullable=False)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    recommended_scenario_ids: Mapped[list[str]] = mapped_column(
        json_column_type(), nullable=False, default=list
    )
    primary_scenario_json: Mapped[Optional[dict]] = mapped_column(
        json_column_type(), nullable=True
    )
    generation_source: Mapped[str] = mapped_column(String(40), nullable=False)
    generation_status: Mapped[str] = mapped_column(
        String(40), nullable=False, default="pending"
    )
    baseline_summary_json: Mapped[Optional[dict]] = mapped_column(
        json_column_type(), nullable=True
    )
    brief_json: Mapped[Optional[dict]] = mapped_column(
        json_column_type(), nullable=True
    )
    last_adjusted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    history: Mapped[list["AdjustmentHistory"]] = relationship(
        "AdjustmentHistory",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="desc(AdjustmentHistory.created_at)",
    )


class AdjustmentHistory(Base):
    __tablename__ = "adjustment_history"
    __table_args__ = (
        CheckConstraint(
            "trigger IN ('survey', 'session_end', 'live_signal', 'manual')",
            name="ck_adjustment_history_trigger",
        ),
        CheckConstraint(
            "previous_difficulty BETWEEN 1 AND 10",
            name="ck_adjustment_history_prev_difficulty",
        ),
        CheckConstraint(
            "new_difficulty BETWEEN 1 AND 10",
            name="ck_adjustment_history_new_difficulty",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("training_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trigger: Mapped[str] = mapped_column(String(40), nullable=False)
    previous_strategy: Mapped[dict] = mapped_column(json_column_type(), nullable=False)
    new_strategy: Mapped[dict] = mapped_column(json_column_type(), nullable=False)
    previous_difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    new_difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    signals_summary: Mapped[dict] = mapped_column(
        json_column_type(), nullable=False, default=dict
    )
    rationale: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    plan: Mapped["TrainingPlan"] = relationship(
        "TrainingPlan", back_populates="history"
    )


class PersonalisedTrainingPlan(Base):
    """
    A goal-conditioned training plan — the complete input contract for RPE's
    scenario generator.

    Unlike TrainingPlan above, rows are never overwritten: regenerating
    archives the old row and inserts a new one with plan_version + 1, so the
    learner keeps a history of what they asked to practise.

    The JSONB blobs mirror the Pydantic models in app/contracts/training_plan.py
    and app/schemas/training_plan.py, validated in both directions.
    """

    __tablename__ = "personalised_training_plans"
    __table_args__ = (
        CheckConstraint(
            "difficulty BETWEEN 1 AND 10",
            name="ck_personalised_plans_difficulty_range",
        ),
        CheckConstraint(
            "plan_version >= 1",
            name="ck_personalised_plans_version_positive",
        ),
        CheckConstraint(
            "status IN ('draft', 'active', 'consumed', 'archived')",
            name="ck_personalised_plans_status",
        ),
        Index("ix_personalised_plans_user_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    schema_version: Mapped[str] = mapped_column(String(16), nullable=False)
    plan_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active"
    )

    # Denormalised for list/filter queries; authoritative copies live in the blobs.
    domain: Mapped[str] = mapped_column(String(40), nullable=False)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    title_hint: Mapped[str] = mapped_column(String(200), nullable=False)

    intent: Mapped[dict] = mapped_column(json_column_type(), nullable=False)
    blueprint: Mapped[dict] = mapped_column(json_column_type(), nullable=False)
    pedagogy: Mapped[dict] = mapped_column(json_column_type(), nullable=False)
    adaptation: Mapped[dict] = mapped_column(json_column_type(), nullable=False)
    inputs_snapshot: Mapped[dict] = mapped_column(
        json_column_type(), nullable=False, default=dict
    )
    generation_sources: Mapped[dict] = mapped_column(
        json_column_type(), nullable=False, default=dict
    )

    target_skills: Mapped[list[str]] = mapped_column(
        json_column_type(), nullable=False, default=list
    )
    personalisation_brief: Mapped[str] = mapped_column(Text, nullable=False)

    # Stamped when RPE fetches the brief; status is left alone so RPE may retry.
    consumed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
