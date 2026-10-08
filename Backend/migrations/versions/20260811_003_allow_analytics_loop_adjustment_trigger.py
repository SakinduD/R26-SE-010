"""allow_analytics_loop_adjustment_trigger

Revision ID: 20260811_003
Revises: 20260811_002
Create Date: 2026-08-11

Widened adjustment_history.trigger to accept 'analytics_loop'.

Superseded by 20260811_004, which narrows it back. The analytics feedback loop
was initially designed to *push* adjustments onto the orchestrator's
training_plans row; that row turned out not to be created by the application the
learner actually uses, so the design moved to a pull — plan_service reads the
analytics signal when composing a plan — and this trigger value is no longer
written by anything.

The migration is kept rather than deleted because it has already been applied:
removing it would leave alembic unable to resolve the recorded revision.
"""
import sqlalchemy as sa
from alembic import op

revision = "20260811_003"
down_revision = "20260811_002"
branch_labels = None
depends_on = None

_OLD = "trigger IN ('survey', 'session_end', 'live_signal', 'manual')"
_NEW = "trigger IN ('survey', 'session_end', 'live_signal', 'manual', 'analytics_loop')"


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE adjustment_history DROP CONSTRAINT IF EXISTS ck_adjustment_history_trigger;"
    ))
    conn.execute(sa.text(
        f"ALTER TABLE adjustment_history ADD CONSTRAINT ck_adjustment_history_trigger CHECK ({_NEW});"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE adjustment_history SET trigger = 'manual' WHERE trigger = 'analytics_loop';"
    ))
    conn.execute(sa.text(
        "ALTER TABLE adjustment_history DROP CONSTRAINT IF EXISTS ck_adjustment_history_trigger;"
    ))
    conn.execute(sa.text(
        f"ALTER TABLE adjustment_history ADD CONSTRAINT ck_adjustment_history_trigger CHECK ({_OLD});"
    ))
