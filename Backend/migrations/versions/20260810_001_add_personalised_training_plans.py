"""add personalised_training_plans

Revision ID: 20260810_001
Revises: 20260615_001
Create Date: 2026-08-10

Goal-conditioned training plans for the APM Training Plan API.

Distinct from `training_plans`, which stays a single upserted adaptive-state
row per user. This table is versioned and status-tracked: one row per goal the
learner asks to practise, archived rather than overwritten on regenerate.

Two existing migrations share the `20260509_001` prefix, so this one uses an
unambiguous id and chains off `20260615_001`, the single current head.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260810_001"
down_revision: Union[str, None] = "20260615_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "personalised_training_plans",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("schema_version", sa.String(length=16), nullable=False),
        sa.Column(
            "plan_version", sa.Integer(), nullable=False, server_default="1"
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="active",
        ),
        sa.Column("domain", sa.String(length=40), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=False),
        sa.Column("title_hint", sa.String(length=200), nullable=False),
        sa.Column(
            "intent",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "blueprint",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "pedagogy",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "adaptation",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "inputs_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "generation_sources",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "target_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("personalisation_brief", sa.Text(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "difficulty BETWEEN 1 AND 10",
            name="ck_personalised_plans_difficulty_range",
        ),
        sa.CheckConstraint(
            "plan_version >= 1",
            name="ck_personalised_plans_version_positive",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'consumed', 'archived')",
            name="ck_personalised_plans_status",
        ),
    )
    op.create_index(
        "ix_personalised_training_plans_user_id",
        "personalised_training_plans",
        ["user_id"],
    )
    op.create_index(
        "ix_personalised_plans_user_status",
        "personalised_training_plans",
        ["user_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_personalised_plans_user_status",
        table_name="personalised_training_plans",
    )
    op.drop_index(
        "ix_personalised_training_plans_user_id",
        table_name="personalised_training_plans",
    )
    op.drop_table("personalised_training_plans")
