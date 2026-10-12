from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def json_column_type():
    return JSON().with_variant(JSONB(), "postgresql")


class RpeCustomScenario(Base):
    """
    Stores dynamically generated RPE scenarios (e.g. from an APM Training Plan)
    in the database instead of local JSON files on the server disk.
    """
    __tablename__ = "rpe_custom_scenarios"

    # scenario_id string format: 'plan_<uuid>' or arbitrary scenario key
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(50), nullable=False, default="intermediate")
    conflict_type: Mapped[str] = mapped_column(String(100), nullable=False, default="general")
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    npc_role: Mapped[str] = mapped_column(String(255), nullable=False)
    npc_personality: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str] = mapped_column(Text, nullable=False)
    opening_npc_line: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_turns: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    max_turns: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    end_conditions: Mapped[dict] = mapped_column(json_column_type(), nullable=False, default=dict)
    success_criteria: Mapped[dict] = mapped_column(json_column_type(), nullable=False, default=dict)
    npc_behaviour: Mapped[dict] = mapped_column(json_column_type(), nullable=False, default=dict)
    apa_metadata: Mapped[dict] = mapped_column(json_column_type(), nullable=False, default=dict)

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
