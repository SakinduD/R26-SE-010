"""add baseline_summary_json to training_plans

Revision ID: 20260509_002
Revises: 20260509_001
Create Date: 2026-05-09 13:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260509_002"
down_revision: Union[str, None] = "20260509_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "training_plans",
        sa.Column(
            "baseline_summary_json",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("training_plans", "baseline_summary_json")
