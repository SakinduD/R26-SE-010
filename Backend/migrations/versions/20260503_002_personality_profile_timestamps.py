"""personality_profile: rename computed_at to created_at, add updated_at

Revision ID: 20260503_002
Revises: 20260502_001
Create Date: 2026-05-03
"""

import sqlalchemy as sa
from alembic import op

revision = "20260503_002"
down_revision = "20260503_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("personality_profiles", "computed_at", new_column_name="created_at")
    op.add_column(
        "personality_profiles",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )


def downgrade() -> None:
    op.drop_column("personality_profiles", "updated_at")
    op.alter_column("personality_profiles", "created_at", new_column_name="computed_at")
