"""add_mentoring_recommendations_table

Revision ID: 20260509_001
Revises: 1ab1e9d9712e
Create Date: 2026-05-09

Create table to store persisted mentoring recommendations.
"""
import sqlalchemy as sa
from alembic import op

revision = "20260509_001"
down_revision = "1ab1e9d9712e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Create recommendation_type enum
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE recommendation_type_enum AS ENUM ('session_specific', 'overall_user'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    ))

    # Create priority enum
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE recommendation_priority_enum AS ENUM ('high', 'medium', 'low'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    ))

    # Create source enum
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE recommendation_source_enum AS ENUM ('llm', 'rule_based', 'cached'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    ))

    # Create the table
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS mentoring_recommendations (
            id                  SERIAL PRIMARY KEY,
            user_id             VARCHAR(64) NOT NULL,
            session_id          VARCHAR(64),
            recommendation_type recommendation_type_enum NOT NULL,
            title               VARCHAR(255) NOT NULL,
            description         TEXT NOT NULL,
            reason              TEXT,
            detail              TEXT,
            next_action         TEXT,
            priority            recommendation_priority_enum NOT NULL DEFAULT 'medium',
            skill_area          VARCHAR(80),
            confidence          FLOAT,
            evidence            JSONB,
            source              recommendation_source_enum NOT NULL DEFAULT 'llm',
            model_version       VARCHAR(40) NOT NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """))

    # Create indexes
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mentoring_recommendations_user_session "
        "ON mentoring_recommendations(user_id, session_id);"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mentoring_recommendations_user_type "
        "ON mentoring_recommendations(user_id, recommendation_type);"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS mentoring_recommendations CASCADE;"))
    conn.execute(sa.text("DROP TYPE IF EXISTS recommendation_type_enum;"))
    conn.execute(sa.text("DROP TYPE IF EXISTS recommendation_priority_enum;"))
    conn.execute(sa.text("DROP TYPE IF EXISTS recommendation_source_enum;"))
