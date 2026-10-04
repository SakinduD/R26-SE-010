"""add_has_seen_tour_to_users

Revision ID: 20260831_001
Revises: 20260819_001_allow_mixed_sentiment
Create Date: 2026-08-31

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "20260831_001"
down_revision = "20260819_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "has_seen_tour",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "has_seen_tour")
