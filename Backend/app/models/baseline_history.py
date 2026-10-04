"""
SQLAlchemy model for BaselineHistory.

Every MCA baseline a learner submits, in the order they took them. Append-only:
one row per successful POST /apa/baseline/complete, so redoing the baseline
shows how the learner's communication changed instead of erasing the earlier
result. BaselineSnapshot still holds the current (latest) baseline.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.baseline_snapshot import _json_col


class BaselineHistory(Base):
    __tablename__ = "baseline_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Soft reference to session_results.id, as on BaselineSnapshot.
    mca_session_id: Mapped[str] = mapped_column(String(36), nullable=False)

    skill_scores: Mapped[Optional[Dict[str, Any]]] = mapped_column(_json_col(), nullable=True)
    emotion_distribution: Mapped[Optional[Dict[str, Any]]] = mapped_column(_json_col(), nullable=True)
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
