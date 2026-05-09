"""add brief_json to training_plans

Revision ID: 20260509_003
Revises: 20260509_002
Create Date: 2026-05-09 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260509_003"
down_revision: Union[str, None] = "20260509_002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "training_plans",
        sa.Column(
            "brief_json",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("training_plans", "brief_json")
