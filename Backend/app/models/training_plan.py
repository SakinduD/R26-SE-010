"""
SQLAlchemy models for APM persistence — TrainingPlan and AdjustmentHistory.

TrainingPlan is upserted: one row per user (UNIQUE on user_id).
AdjustmentHistory is append-only and powers the "see how the plan changed"
demo view.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:  # pragma: no cover
    from app.models.user import User


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
    strategy_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    recommended_scenario_ids: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    primary_scenario_json: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True
    )
    generation_source: Mapped[str] = mapped_column(String(40), nullable=False)
    generation_status: Mapped[str] = mapped_column(
        String(40), nullable=False, default="pending"
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
    previous_strategy: Mapped[dict] = mapped_column(JSONB, nullable=False)
    new_strategy: Mapped[dict] = mapped_column(JSONB, nullable=False)
    previous_difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    new_difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    signals_summary: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
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
