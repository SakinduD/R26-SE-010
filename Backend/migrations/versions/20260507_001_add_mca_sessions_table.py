"""add_mca_sessions_table

Revision ID: 20260507_001
Revises: 20260504_001
Create Date: 2026-05-07

Uses raw SQL to avoid SQLAlchemy Enum type conflicts on re-run.
The mca_session_mode and mca_session_status enum types may already exist
from a prior partial migration run — we handle that with IF NOT EXISTS guards.
"""
import sqlalchemy as sa
from alembic import op

revision = "20260507_001"
down_revision = "20260504_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Create enum types only if they don't already exist
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE mca_session_mode AS ENUM ('live', 'ai'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE mca_session_status AS ENUM ('active', 'completed', 'abandoned'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$;"
    ))

    # Create the table using raw SQL to bypass SQLAlchemy Enum auto-create
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS mca_sessions (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            mode        mca_session_mode NOT NULL DEFAULT 'live',
            status      mca_session_status NOT NULL DEFAULT 'active',
            started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at    TIMESTAMPTZ,
            duration_seconds INTEGER,
            result_data JSONB,
            nudge_log   JSONB,
            chat_turns  INTEGER
        );
    """))

    # Index on user_id (IF NOT EXISTS guard)
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mca_sessions_user_id ON mca_sessions(user_id);"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS mca_sessions CASCADE;"))
    conn.execute(sa.text("DROP TYPE IF EXISTS mca_session_status;"))
    conn.execute(sa.text("DROP TYPE IF EXISTS mca_session_mode;"))
