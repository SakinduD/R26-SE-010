"""Add SessionResult

Revision ID: 6f71857bea75
Revises: 20260507_001
Create Date: 2026-05-07 14:43:13.985022

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = '6f71857bea75'
down_revision: Union[str, None] = '20260507_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('session_results',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('session_type', sa.String(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('duration_seconds', sa.Integer(), nullable=True),
    sa.Column('chat_turns', sa.Integer(), nullable=True),
    sa.Column('overall_score', sa.Integer(), nullable=True),
    sa.Column('dominant_emotion', sa.String(), nullable=True),
    sa.Column('emotion_distribution', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('nudge_summary', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('nudge_log', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('mechanical_averages', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_session_results_user_id'), 'session_results', ['user_id'], unique=False)
    
    # Try dropping mca_sessions if it exists
    op.execute("DROP TABLE IF EXISTS mca_sessions CASCADE")


def downgrade() -> None:
    op.drop_index(op.f('ix_session_results_user_id'), table_name='session_results')
    op.drop_table('session_results')
