"""repair_missing_baseline_snapshots

Revision ID: 20260811_002
Revises: 20260811_001
Create Date: 2026-08-11

Repair migration — purely additive, deletes nothing.

Two migration files were authored with the same revision id, "20260509_001":

    20260509_001_add_baseline_snapshots.py
    20260509_001_add_mentoring_recommendations_table.py

Alembic can only keep one node per revision id, so one file shadowed the other:
``mentoring_recommendations`` was created but ``baseline_snapshots`` never was,
even though the version table reports the revision as applied. The missing table
therefore cannot be recovered by re-running the original migration — alembic
considers it done.

This migration recreates the table at the tip of the chain instead. It leaves the
duplicate revision ids untouched so no teammate's local history is rewritten, and
uses IF NOT EXISTS throughout so it is a harmless no-op on any database where the
original migration did land.

The schema below mirrors 20260509_001_add_baseline_snapshots.py exactly.
"""
import sqlalchemy as sa
from alembic import op

revision = "20260811_002"
# Two parents: this is also the merge point that folds the un-shadowed baseline
# revision back into the main line, so `alembic upgrade head` resolves again.
down_revision = ("20260811_001", "20260509_001a")
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS baseline_snapshots (
            id                   UUID PRIMARY KEY,
            user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            mca_session_id       VARCHAR(36) NOT NULL,
            skill_scores         JSONB,
            emotion_distribution JSONB,
            overall_score        FLOAT,
            duration_seconds     INTEGER,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_baseline_snapshots_user_id UNIQUE (user_id)
        );
    """))

    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_baseline_snapshots_user_id "
        "ON baseline_snapshots(user_id);"
    ))


def downgrade() -> None:
    # Intentionally a no-op. This migration only repairs a table that
    # 20260509_001_add_baseline_snapshots.py already owns; dropping it here would
    # destroy baseline data that migration is responsible for. Downgrade that
    # revision instead if the table genuinely needs to go.
    pass
