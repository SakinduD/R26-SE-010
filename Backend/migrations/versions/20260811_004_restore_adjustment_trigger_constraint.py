"""restore_adjustment_trigger_constraint

Revision ID: 20260811_004
Revises: 20260811_003
Create Date: 2026-08-11

Narrows adjustment_history.trigger back to the four values the pedagogy module
originally defined, undoing 20260811_003.

The analytics feedback loop no longer pushes adjustments onto training_plans —
that row is not created by the plan wizard the learner actually uses, so a push
there would have had no effect. The loop now feeds plan_service instead, which
reads the analytics signal when it composes a plan. Nothing writes
'analytics_loop', so the constraint should not advertise it.

Safe on any database: rows carrying the retired value are retagged before the
narrower constraint is applied, so nothing is deleted and nothing fails.
"""
import sqlalchemy as sa
from alembic import op

revision = "20260811_004"
down_revision = "20260811_003"
branch_labels = None
depends_on = None

_ORIGINAL = "trigger IN ('survey', 'session_end', 'live_signal', 'manual')"
_WIDENED = "trigger IN ('survey', 'session_end', 'live_signal', 'manual', 'analytics_loop')"


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE adjustment_history SET trigger = 'manual' WHERE trigger = 'analytics_loop';"
    ))
    conn.execute(sa.text(
        "ALTER TABLE adjustment_history DROP CONSTRAINT IF EXISTS ck_adjustment_history_trigger;"
    ))
    conn.execute(sa.text(
        f"ALTER TABLE adjustment_history ADD CONSTRAINT ck_adjustment_history_trigger CHECK ({_ORIGINAL});"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE adjustment_history DROP CONSTRAINT IF EXISTS ck_adjustment_history_trigger;"
    ))
    conn.execute(sa.text(
        f"ALTER TABLE adjustment_history ADD CONSTRAINT ck_adjustment_history_trigger CHECK ({_WIDENED});"
    ))
