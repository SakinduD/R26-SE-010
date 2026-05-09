"""
SQLAlchemy model for BaselineSnapshot.

Captures the MCA voice-baseline results for one user before their first RPE session.
One row per user — UPSERT on retry (UNIQUE on user_id).
mca_session_id is a soft reference (string) to session_results.id; no FK so that
deleting an MCA session does not cascade-delete the baseline data.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _json_col():
    """Use JSONB on PostgreSQL, plain JSON on SQLite (test DB)."""
    return JSON().with_variant(JSONB(), "postgresql")


class BaselineSnapshot(Base):
    __tablename__ = "baseline_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_baseline_snapshots_user_id"),
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
    # Soft reference — stored as string so deleting an MCA session doesn't break this row.
    mca_session_id: Mapped[str] = mapped_column(String(36), nullable=False)

    skill_scores: Mapped[Optional[Dict[str, Any]]] = mapped_column(_json_col(), nullable=True)
    emotion_distribution: Mapped[Optional[Dict[str, Any]]] = mapped_column(_json_col(), nullable=True)
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
