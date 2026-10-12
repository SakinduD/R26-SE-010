"""add rpe_custom_scenarios table

Revision ID: 20261013_001
Revises: 20261004_001
Create Date: 2026-10-13

Stores dynamically generated RPE scenarios in PostgreSQL/Supabase instead of
local JSON files on the server filesystem.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20261013_001"
down_revision: Union[str, None] = "20261004_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rpe_custom_scenarios",
        sa.Column("id", sa.String(length=100), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "plan_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("difficulty", sa.String(length=50), nullable=False, server_default="intermediate"),
        sa.Column("conflict_type", sa.String(length=100), nullable=False, server_default="general"),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("npc_role", sa.String(length=255), nullable=False),
        sa.Column("npc_personality", sa.Text(), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("opening_npc_line", sa.Text(), nullable=False),
        sa.Column("recommended_turns", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("max_turns", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("end_conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("success_criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("npc_behaviour", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("apa_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_rpe_custom_scenarios_user_id",
        "rpe_custom_scenarios",
        ["user_id"],
    )
    op.create_index(
        "ix_rpe_custom_scenarios_plan_id",
        "rpe_custom_scenarios",
        ["plan_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_rpe_custom_scenarios_plan_id", table_name="rpe_custom_scenarios")
    op.drop_index("ix_rpe_custom_scenarios_user_id", table_name="rpe_custom_scenarios")
    op.drop_table("rpe_custom_scenarios")
