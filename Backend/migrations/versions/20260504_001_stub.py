"""Stub for lost revision 20260504_001 — this migration was already applied to the DB.

This file exists only to keep the Alembic revision chain intact.
No DDL is emitted by upgrade() or downgrade().

Revision ID: 20260504_001
Revises: 20260503_002
Create Date: 2026-05-04
"""
from alembic import op

revision = "20260504_001"
down_revision = "20260503_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Already applied — no-op stub.
    pass


def downgrade() -> None:
    pass
