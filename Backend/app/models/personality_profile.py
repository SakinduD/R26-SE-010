from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class PersonalityProfile(Base):
    __tablename__ = "personality_profiles"
    __table_args__ = (
        CheckConstraint("openness BETWEEN 0.0 AND 100.0", name="ck_openness_range"),
        CheckConstraint(
            "conscientiousness BETWEEN 0.0 AND 100.0",
            name="ck_conscientiousness_range",
        ),
        CheckConstraint(
            "extraversion BETWEEN 0.0 AND 100.0", name="ck_extraversion_range"
        ),
        CheckConstraint(
            "agreeableness BETWEEN 0.0 AND 100.0", name="ck_agreeableness_range"
        ),
        CheckConstraint(
            "neuroticism BETWEEN 0.0 AND 100.0", name="ck_neuroticism_range"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    openness: Mapped[float] = mapped_column(nullable=False)
    conscientiousness: Mapped[float] = mapped_column(nullable=False)
    extraversion: Mapped[float] = mapped_column(nullable=False)
    agreeableness: Mapped[float] = mapped_column(nullable=False)
    neuroticism: Mapped[float] = mapped_column(nullable=False)
    raw_responses: Mapped[dict] = mapped_column(JSONB, nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="bfi-44-v1")
    computed_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship("User", back_populates="personality_profile")
