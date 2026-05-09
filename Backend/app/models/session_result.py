from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class SessionResult(Base):
    """
    Stores the result of a Multimodal Coaching (MCA) session, replacing the legacy score schema.
    Contains rich JSONB payloads for adaptive learning by downstream LLM bots.
    """
    __tablename__ = "session_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    session_type: Mapped[str] = mapped_column(String, nullable=False, default="live")
    
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    chat_turns: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    overall_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    dominant_emotion: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    emotion_distribution: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    nudge_summary: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    
    nudge_log: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)

    skill_scores: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    mechanical_averages: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    
    friendly_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    user: Mapped["User"] = relationship("User", back_populates="session_results")
