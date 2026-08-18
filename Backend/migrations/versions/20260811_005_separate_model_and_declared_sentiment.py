"""separate_model_and_declared_sentiment

Revision ID: 20260811_005
Revises: 20260811_004
Create Date: 2026-08-11

Splits "what the sentiment is" into "what the learner said" and "what the NLP
model read", and records how the stored value was produced.

Until now the self-reflection form sent its own sentiment value with every
entry, and the service only ran the sentiment model when no value was supplied.
The result was that the NLP model — Specific Objective 2 — never executed on the
production path at all: every stored label was either the learner's own pick or a
rule derived from a session outcome.

Four columns:

    declared_sentiment       what the author said about themselves
    sentiment_confidence     the model's confidence, when the model produced it
    sentiment_source         'model' | 'rule' | 'declared' — how it was produced
    sentiment_model_version  which model version judged it

``sentiment`` keeps its meaning for existing readers (aggregation counts and the
predictive model's sentiment feature), so nothing downstream changes.

Backfill is deliberate and conservative: every existing row is marked
'rule', because none of them were produced by the model. Marking them otherwise
would misrepresent the record.
"""
import sqlalchemy as sa
from alembic import op

revision = "20260811_005"
down_revision = "20260811_004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("""
        ALTER TABLE feedback_entries
            ADD COLUMN IF NOT EXISTS declared_sentiment      VARCHAR(20),
            ADD COLUMN IF NOT EXISTS sentiment_confidence    FLOAT,
            ADD COLUMN IF NOT EXISTS sentiment_source        VARCHAR(20),
            ADD COLUMN IF NOT EXISTS sentiment_model_version VARCHAR(60);
    """))

    # Every row that exists today was produced by a rule or by the author, never
    # by the model. Record that honestly rather than leaving it ambiguous.
    conn.execute(sa.text("""
        UPDATE feedback_entries
        SET sentiment_source = 'rule'
        WHERE sentiment IS NOT NULL AND sentiment_source IS NULL;
    """))

    conn.execute(sa.text("""
        ALTER TABLE feedback_entries
            DROP CONSTRAINT IF EXISTS ck_feedback_entries_declared_sentiment;
    """))
    conn.execute(sa.text("""
        ALTER TABLE feedback_entries
            ADD CONSTRAINT ck_feedback_entries_declared_sentiment
            CHECK (declared_sentiment IS NULL
                   OR declared_sentiment IN ('positive', 'neutral', 'negative'));
    """))

    conn.execute(sa.text("""
        ALTER TABLE feedback_entries
            DROP CONSTRAINT IF EXISTS ck_feedback_entries_sentiment_source;
    """))
    conn.execute(sa.text("""
        ALTER TABLE feedback_entries
            ADD CONSTRAINT ck_feedback_entries_sentiment_source
            CHECK (sentiment_source IS NULL
                   OR sentiment_source IN ('model', 'rule', 'declared'));
    """))

    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_feedback_entries_sentiment_source "
        "ON feedback_entries(sentiment_source);"
    ))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_feedback_entries_sentiment_source;"))
    conn.execute(sa.text("""
        ALTER TABLE feedback_entries
            DROP CONSTRAINT IF EXISTS ck_feedback_entries_sentiment_source,
            DROP CONSTRAINT IF EXISTS ck_feedback_entries_declared_sentiment,
            DROP COLUMN IF EXISTS sentiment_model_version,
            DROP COLUMN IF EXISTS sentiment_source,
            DROP COLUMN IF EXISTS sentiment_confidence,
            DROP COLUMN IF EXISTS declared_sentiment;
    """))
