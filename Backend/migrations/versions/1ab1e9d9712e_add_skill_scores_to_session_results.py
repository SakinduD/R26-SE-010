"""add skill_scores to session_results

Revision ID: 1ab1e9d9712e
Revises: 6f71857bea75
Create Date: 2026-05-09 11:17:07.763101

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '1ab1e9d9712e'
down_revision: Union[str, None] = '6f71857bea75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('session_results', sa.Column('skill_scores', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('session_results', 'skill_scores')
