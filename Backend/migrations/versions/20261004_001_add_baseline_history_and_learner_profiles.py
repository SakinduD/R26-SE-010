"""add baseline_history and learner_profiles

Revision ID: 20261004_001
Revises: 20260831_001
Create Date: 2026-10-04

Redoing the MCA baseline used to overwrite the single baseline_snapshots row
and regenerate the training plan. Now every baseline is kept in
baseline_history, and the personalised profile derived from OCEAN + the
current baseline is stored in learner_profiles (one row per user).

Existing real baselines are copied into baseline_history so learners keep
their first entry. learner_profiles starts empty: profiles are computed on
first read.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "20261004_001"
down_revision = "20260831_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "baseline_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mca_session_id", sa.String(36), nullable=False),
        sa.Column("skill_scores", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("emotion_distribution", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_baseline_history_user_id", "baseline_history", ["user_id"])

    op.execute(
        """
        INSERT INTO baseline_history
            (id, user_id, mca_session_id, skill_scores, emotion_distribution,
             overall_score, duration_seconds, created_at)
        SELECT gen_random_uuid(), user_id, mca_session_id, skill_scores,
               emotion_distribution, overall_score, duration_seconds, updated_at
        FROM baseline_snapshots
        WHERE mca_session_id <> 'skipped'
        """
    )

    op.create_table(
        "learner_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("profile_version", sa.String(40), nullable=False),
        sa.Column("source_mca_session_id", sa.String(36), nullable=True),
        sa.Column("ocean_scores", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("baseline_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("strategy_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=False),
        sa.Column("difficulty_rationale", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("priority_skills", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("weak_skills", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", name="uq_learner_profiles_user_id"),
    )
    op.create_index("ix_learner_profiles_user_id", "learner_profiles", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_learner_profiles_user_id", table_name="learner_profiles")
    op.drop_table("learner_profiles")
    op.drop_index("ix_baseline_history_user_id", table_name="baseline_history")
    op.drop_table("baseline_history")
