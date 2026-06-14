"""add score_diagnostics to session_results

Revision ID: 20260615_001
Revises: 1ab1e9d9712e
Create Date: 2026-06-15

Closes the gap between calculate_session_metrics() and the database:
the diagnostics dict (obp_per_dimension, max_opportunities,
emotion_valence_raw, session_minutes) was previously computed but
discarded. This column persists it for adaptive learning and debugging.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '20260615_001'
down_revision: Union[str, None] = '1ab1e9d9712e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'session_results',
        sa.Column(
            'score_diagnostics',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('session_results', 'score_diagnostics')
