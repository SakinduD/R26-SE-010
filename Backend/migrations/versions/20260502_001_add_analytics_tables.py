"""add analytics tables

Revision ID: 20260502_001
Revises:
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260502_001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analytics_session_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("scenario_id", sa.String(length=64), nullable=True),
        sa.Column("skill_type", sa.String(length=80), nullable=True),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("clarity_score", sa.Float(), nullable=True),
        sa.Column("empathy_score", sa.Float(), nullable=True),
        sa.Column("listening_score", sa.Float(), nullable=True),
        sa.Column("adaptability_score", sa.Float(), nullable=True),
        sa.Column("emotional_control_score", sa.Float(), nullable=True),
        sa.Column("professionalism_score", sa.Float(), nullable=True),
        sa.Column("eye_contact_score", sa.Float(), nullable=True),
        sa.Column("speech_pace_score", sa.Float(), nullable=True),
        sa.Column("speech_volume_score", sa.Float(), nullable=True),
        sa.Column("response_quality_score", sa.Float(), nullable=True),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100",
            name="ck_analytics_confidence_score_range",
        ),
        sa.CheckConstraint(
            "clarity_score IS NULL OR clarity_score BETWEEN 0 AND 100",
            name="ck_analytics_clarity_score_range",
        ),
        sa.CheckConstraint(
            "empathy_score IS NULL OR empathy_score BETWEEN 0 AND 100",
            name="ck_analytics_empathy_score_range",
        ),
        sa.CheckConstraint(
            "overall_score IS NULL OR overall_score BETWEEN 0 AND 100",
            name="ck_analytics_overall_score_range",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_analytics_session_metrics_id"), "analytics_session_metrics", ["id"], unique=False)
    op.create_index(op.f("ix_analytics_session_metrics_scenario_id"), "analytics_session_metrics", ["scenario_id"], unique=False)
    op.create_index(op.f("ix_analytics_session_metrics_session_id"), "analytics_session_metrics", ["session_id"], unique=False)
    op.create_index(op.f("ix_analytics_session_metrics_user_id"), "analytics_session_metrics", ["user_id"], unique=False)
    op.create_index("ix_analytics_metrics_user_session", "analytics_session_metrics", ["user_id", "session_id"], unique=False)

    op.create_table(
        "feedback_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("feedback_type", sa.String(length=20), nullable=False),
        sa.Column("skill_area", sa.String(length=80), nullable=True),
        sa.Column("rating", sa.Float(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("sentiment", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "feedback_type IN ('self', 'peer', 'system', 'mentor')",
            name="ck_feedback_entries_type",
        ),
        sa.CheckConstraint(
            "rating IS NULL OR rating BETWEEN 0 AND 100",
            name="ck_feedback_entries_rating_range",
        ),
        sa.CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_feedback_entries_sentiment",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_feedback_entries_id"), "feedback_entries", ["id"], unique=False)
    op.create_index(op.f("ix_feedback_entries_session_id"), "feedback_entries", ["session_id"], unique=False)
    op.create_index(op.f("ix_feedback_entries_user_id"), "feedback_entries", ["user_id"], unique=False)
    op.create_index("ix_feedback_entries_user_session", "feedback_entries", ["user_id", "session_id"], unique=False)

    op.create_table(
        "skill_predictions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("predicted_skill", sa.String(length=80), nullable=False),
        sa.Column("predicted_score", sa.Float(), nullable=True),
        sa.Column("current_score", sa.Float(), nullable=True),
        sa.Column("trend_label", sa.String(length=20), nullable=True),
        sa.Column("risk_level", sa.String(length=20), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=True),
        sa.Column("model_version", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "predicted_score IS NULL OR predicted_score BETWEEN 0 AND 100",
            name="ck_skill_predictions_predicted_score_range",
        ),
        sa.CheckConstraint(
            "current_score IS NULL OR current_score BETWEEN 0 AND 100",
            name="ck_skill_predictions_current_score_range",
        ),
        sa.CheckConstraint(
            "trend_label IS NULL OR trend_label IN ('improving', 'stable', 'declining')",
            name="ck_skill_predictions_trend_label",
        ),
        sa.CheckConstraint(
            "risk_level IN ('low', 'medium', 'high')",
            name="ck_skill_predictions_risk_level",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_skill_predictions_id"), "skill_predictions", ["id"], unique=False)
    op.create_index(op.f("ix_skill_predictions_session_id"), "skill_predictions", ["session_id"], unique=False)
    op.create_index(op.f("ix_skill_predictions_user_id"), "skill_predictions", ["user_id"], unique=False)
    op.create_index("ix_skill_predictions_user_skill", "skill_predictions", ["user_id", "predicted_skill"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_skill_predictions_user_skill", table_name="skill_predictions")
    op.drop_index(op.f("ix_skill_predictions_user_id"), table_name="skill_predictions")
    op.drop_index(op.f("ix_skill_predictions_session_id"), table_name="skill_predictions")
    op.drop_index(op.f("ix_skill_predictions_id"), table_name="skill_predictions")
    op.drop_table("skill_predictions")

    op.drop_index("ix_feedback_entries_user_session", table_name="feedback_entries")
    op.drop_index(op.f("ix_feedback_entries_user_id"), table_name="feedback_entries")
    op.drop_index(op.f("ix_feedback_entries_session_id"), table_name="feedback_entries")
    op.drop_index(op.f("ix_feedback_entries_id"), table_name="feedback_entries")
    op.drop_table("feedback_entries")

    op.drop_index("ix_analytics_metrics_user_session", table_name="analytics_session_metrics")
    op.drop_index(op.f("ix_analytics_session_metrics_user_id"), table_name="analytics_session_metrics")
    op.drop_index(op.f("ix_analytics_session_metrics_session_id"), table_name="analytics_session_metrics")
    op.drop_index(op.f("ix_analytics_session_metrics_scenario_id"), table_name="analytics_session_metrics")
    op.drop_index(op.f("ix_analytics_session_metrics_id"), table_name="analytics_session_metrics")
    op.drop_table("analytics_session_metrics")
