"""rework_users_for_supabase_auth

Revision ID: 20260503_001
Revises: b96927ee964d
Create Date: 2026-05-03 18:00:00.000000

Drop and recreate users table to align with Supabase Auth:
- id is now supplied by Supabase (equals auth.users.id from JWT sub)
- adds display_name column
- removes password column (Supabase owns credentials)
- no FK to auth.users — that schema is inaccessible; link enforced in app logic
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260503_001"
down_revision: Union[str, None] = "b96927ee964d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop dependent table first (FK from personality_profiles → users)
    op.drop_index("ix_personality_profiles_user_id", table_name="personality_profiles")
    op.drop_table("personality_profiles")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    # Recreate users with display_name, no password
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    # Recreate personality_profiles (unchanged schema, just re-added after users)
    op.create_table(
        "personality_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("openness", sa.Float(), nullable=False),
        sa.Column("conscientiousness", sa.Float(), nullable=False),
        sa.Column("extraversion", sa.Float(), nullable=False),
        sa.Column("agreeableness", sa.Float(), nullable=False),
        sa.Column("neuroticism", sa.Float(), nullable=False),
        sa.Column("raw_responses", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("version", sa.String(length=20), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("agreeableness BETWEEN 0.0 AND 100.0", name="ck_agreeableness_range"),
        sa.CheckConstraint(
            "conscientiousness BETWEEN 0.0 AND 100.0", name="ck_conscientiousness_range"
        ),
        sa.CheckConstraint("extraversion BETWEEN 0.0 AND 100.0", name="ck_extraversion_range"),
        sa.CheckConstraint("neuroticism BETWEEN 0.0 AND 100.0", name="ck_neuroticism_range"),
        sa.CheckConstraint("openness BETWEEN 0.0 AND 100.0", name="ck_openness_range"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_personality_profiles_user_id"),
        "personality_profiles",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_personality_profiles_user_id", table_name="personality_profiles")
    op.drop_table("personality_profiles")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    # Restore original users (no display_name)
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "personality_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("openness", sa.Float(), nullable=False),
        sa.Column("conscientiousness", sa.Float(), nullable=False),
        sa.Column("extraversion", sa.Float(), nullable=False),
        sa.Column("agreeableness", sa.Float(), nullable=False),
        sa.Column("neuroticism", sa.Float(), nullable=False),
        sa.Column("raw_responses", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("version", sa.String(length=20), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("agreeableness BETWEEN 0.0 AND 100.0", name="ck_agreeableness_range"),
        sa.CheckConstraint(
            "conscientiousness BETWEEN 0.0 AND 100.0", name="ck_conscientiousness_range"
        ),
        sa.CheckConstraint("extraversion BETWEEN 0.0 AND 100.0", name="ck_extraversion_range"),
        sa.CheckConstraint("neuroticism BETWEEN 0.0 AND 100.0", name="ck_neuroticism_range"),
        sa.CheckConstraint("openness BETWEEN 0.0 AND 100.0", name="ck_openness_range"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_personality_profiles_user_id"),
        "personality_profiles",
        ["user_id"],
        unique=True,
    )
