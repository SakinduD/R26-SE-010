"""add_gamification_tables

Revision ID: 20260811_001
Revises: 20260810_001
Create Date: 2026-08-11

Adds gamified progress tracking for the Feedback System & Predictive Analytics
component (Specific Objective 6): XP, levels, learning streaks and achievement
badges. Both tables are derived caches — they can be rebuilt from
analytics_session_metrics / feedback_entries at any time.
"""
import sqlalchemy as sa
from alembic import op

revision = "20260811_001"
down_revision = "20260810_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS user_gamification_profiles (
            id                  SERIAL PRIMARY KEY,
            user_id             VARCHAR(64) NOT NULL UNIQUE,
            total_xp            INTEGER NOT NULL DEFAULT 0,
            level               INTEGER NOT NULL DEFAULT 1,
            current_streak      INTEGER NOT NULL DEFAULT 0,
            longest_streak      INTEGER NOT NULL DEFAULT 0,
            total_learning_days INTEGER NOT NULL DEFAULT 0,
            last_activity_date  DATE,
            session_count       INTEGER NOT NULL DEFAULT 0,
            skill_xp            JSONB NOT NULL DEFAULT '{}'::jsonb,
            scored_session_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
            rules_version       VARCHAR(40) NOT NULL DEFAULT 'gamification-rules-v1',
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_gamification_total_xp_non_negative CHECK (total_xp >= 0),
            CONSTRAINT ck_gamification_level_min CHECK (level >= 1),
            CONSTRAINT ck_gamification_current_streak_non_negative CHECK (current_streak >= 0),
            CONSTRAINT ck_gamification_longest_streak_non_negative CHECK (longest_streak >= 0)
        );
    """))

    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_user_gamification_profiles_user_id "
        "ON user_gamification_profiles(user_id);"
    ))

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS user_badges (
            id            SERIAL PRIMARY KEY,
            user_id       VARCHAR(64) NOT NULL,
            badge_key     VARCHAR(64) NOT NULL,
            badge_tier    VARCHAR(20) NOT NULL DEFAULT 'bronze',
            skill_area    VARCHAR(80),
            criteria      TEXT NOT NULL,
            evidence      JSONB,
            rules_version VARCHAR(40) NOT NULL DEFAULT 'gamification-rules-v1',
            earned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_user_badges_user_badge UNIQUE (user_id, badge_key),
            CONSTRAINT ck_user_badges_tier CHECK (badge_tier IN ('bronze', 'silver', 'gold'))
        );
    """))

    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_user_badges_user_id ON user_badges(user_id);"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_user_badges_user_earned ON user_badges(user_id, earned_at);"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS user_badges CASCADE;"))
    conn.execute(sa.text("DROP TABLE IF EXISTS user_gamification_profiles CASCADE;"))
