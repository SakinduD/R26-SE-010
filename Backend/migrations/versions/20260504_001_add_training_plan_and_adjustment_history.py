"""add training_plan and adjustment_history tables

Revision ID: 20260504_001
Revises: 20260503_002
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260504_001"
down_revision = "20260503_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "training_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "skill",
            sa.String(length=40),
            nullable=False,
            server_default="job_interview",
        ),
        sa.Column("strategy_json", postgresql.JSONB(), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=False),
        sa.Column(
            "recommended_scenario_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("primary_scenario_json", postgresql.JSONB(), nullable=True),
        sa.Column("generation_source", sa.String(length=40), nullable=False),
        sa.Column(
            "generation_status",
            sa.String(length=40),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("last_adjusted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_training_plans_user_id"),
        sa.CheckConstraint(
            "difficulty BETWEEN 1 AND 10",
            name="ck_training_plans_difficulty_range",
        ),
        sa.CheckConstraint(
            "generation_source IN ('rpe_library', 'gemini_fallback', 'rpe_then_gemini')",
            name="ck_training_plans_generation_source",
        ),
        sa.CheckConstraint(
            "generation_status IN ('pending', 'completed', 'scenario_failed')",
            name="ck_training_plans_generation_status",
        ),
    )
    op.create_index(
        "ix_training_plans_user_id", "training_plans", ["user_id"], unique=False
    )

    op.create_table(
        "adjustment_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trigger", sa.String(length=40), nullable=False),
        sa.Column("previous_strategy", postgresql.JSONB(), nullable=False),
        sa.Column("new_strategy", postgresql.JSONB(), nullable=False),
        sa.Column("previous_difficulty", sa.Integer(), nullable=False),
        sa.Column("new_difficulty", sa.Integer(), nullable=False),
        sa.Column(
            "signals_summary",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["plan_id"], ["training_plans.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "trigger IN ('survey', 'session_end', 'live_signal', 'manual')",
            name="ck_adjustment_history_trigger",
        ),
        sa.CheckConstraint(
            "previous_difficulty BETWEEN 1 AND 10",
            name="ck_adjustment_history_prev_difficulty",
        ),
        sa.CheckConstraint(
            "new_difficulty BETWEEN 1 AND 10",
            name="ck_adjustment_history_new_difficulty",
        ),
    )
    op.create_index(
        "ix_adjustment_history_user_id",
        "adjustment_history",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_adjustment_history_plan_id",
        "adjustment_history",
        ["plan_id"],
        unique=False,
    )
    op.create_index(
        "ix_adjustment_history_created_at",
        "adjustment_history",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_adjustment_history_created_at", table_name="adjustment_history"
    )
    op.drop_index("ix_adjustment_history_plan_id", table_name="adjustment_history")
    op.drop_index("ix_adjustment_history_user_id", table_name="adjustment_history")
    op.drop_table("adjustment_history")

    op.drop_index("ix_training_plans_user_id", table_name="training_plans")
    op.drop_table("training_plans")
