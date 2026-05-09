from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.session_result import SessionResult
    from app.models.personality_profile import PersonalityProfile


class User(Base):
    __tablename__ = "users"

    # ID matches Supabase auth.users.id — set from JWT sub on first authenticated request
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    display_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    personality_profile: Mapped[Optional["PersonalityProfile"]] = relationship(
        "PersonalityProfile",
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )

    session_results: Mapped[list["SessionResult"]] = relationship(
        "SessionResult",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="SessionResult.created_at.desc()",
    )
