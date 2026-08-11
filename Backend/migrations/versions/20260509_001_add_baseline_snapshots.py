"""add baseline_snapshots table

Revision ID: 20260509_001a
Revises: 1ab1e9d9712e
Create Date: 2026-05-09 12:00:00.000000

Note: this revision was originally authored as "20260509_001", the same id as
20260509_001_add_mentoring_recommendations_table.py. Alembic keeps only one node
per id, so this file was shadowed and never ran, and `alembic upgrade head` broke
with "Multiple head revisions are present". The id is suffixed with "a" to make it
unique; nothing else about the migration changed. Databases that were already
past this point are repaired by 20260811_002.

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260509_001a"
down_revision: Union[str, None] = "1ab1e9d9712e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "baseline_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mca_session_id", sa.String(36), nullable=False),
        sa.Column(
            "skill_scores",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "emotion_distribution",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", name="uq_baseline_snapshots_user_id"),
    )
    op.create_index(
        "ix_baseline_snapshots_user_id",
        "baseline_snapshots",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_baseline_snapshots_user_id", table_name="baseline_snapshots")
    op.drop_table("baseline_snapshots")
