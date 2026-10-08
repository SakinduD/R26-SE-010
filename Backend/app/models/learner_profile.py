"""
SQLAlchemy model for LearnerProfileRecord.

The learner's stored personalised profile: what pedagogy derives from the
OCEAN survey plus the current baseline (baseline summary, teaching strategy,
recommended difficulty, priority and weak skills). One current row per user,
recalculated on every baseline. Plan generation and the role-play recommender
read it instead of recomputing the profile each time.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.baseline_snapshot import _json_col


class LearnerProfileRecord(Base):
    __tablename__ = "learner_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_learner_profiles_user_id"),
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
    # Rules version that computed this row; a mismatch forces recalculation.
    profile_version: Mapped[str] = mapped_column(String(40), nullable=False)
    # The baseline it came from (BaselineSnapshot.mca_session_id); None = no baseline.
    source_mca_session_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    ocean_scores: Mapped[Dict[str, Any]] = mapped_column(_json_col(), nullable=False)
    baseline_json: Mapped[Dict[str, Any]] = mapped_column(_json_col(), nullable=False)
    strategy_json: Mapped[Dict[str, Any]] = mapped_column(_json_col(), nullable=False)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty_rationale: Mapped[List[str]] = mapped_column(_json_col(), nullable=False)
    priority_skills: Mapped[List[str]] = mapped_column(_json_col(), nullable=False)
    weak_skills: Mapped[List[str]] = mapped_column(_json_col(), nullable=False)

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
