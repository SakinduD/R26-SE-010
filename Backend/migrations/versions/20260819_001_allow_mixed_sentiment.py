"""Allow 'mixed' as a sentiment value.

The sentiment vocabulary was positive / neutral / negative, inherited from the
Sentiment140 model, which could only answer the first and third of those.

Measurement against hand-labelled workplace text showed that vocabulary does not
fit what learners write. Every real reflection collected so far carries two
opposing judgements at once - "I perform well but I don't have enough time" -
and that is not neutrality. Neutral text passes no judgement; mixed text passes
two. Forcing the second into either pole loses the more interesting half of what
the learner said, and in practice the old model resolved 13 of 15 such
reflections to 'negative'.

The replacement classifier (DistilBERT fine-tuned on three-class workplace review
data) predicts 'mixed' directly, at 0.99 confidence on the learner's own
reflections. This widens the constraints so that reading can be stored.

Both columns widen. `declared_sentiment` is what the learner said about their own
feedback, and they need the same word available to them - otherwise a learner
whose reflection genuinely is mixed has no way to say so, and every such entry
records a disagreement with the model that is an artefact of the form's options
rather than a fact about the learner.

Revision ID: 20260819_001
Revises: 20260811_005
"""

from alembic import op


revision = "20260819_001"
down_revision = "20260811_005"
branch_labels = None
depends_on = None


SENTIMENT_VALUES_NEW = "('positive', 'neutral', 'negative', 'mixed')"
SENTIMENT_VALUES_OLD = "('positive', 'neutral', 'negative')"

CONSTRAINTS = (
    ("ck_feedback_entries_sentiment", "sentiment"),
    ("ck_feedback_entries_declared_sentiment", "declared_sentiment"),
)


def upgrade() -> None:
    for name, column in CONSTRAINTS:
        op.drop_constraint(name, "feedback_entries", type_="check")
        op.create_check_constraint(
            name,
            "feedback_entries",
            f"{column} IS NULL OR {column} IN {SENTIMENT_VALUES_NEW}",
        )


def downgrade() -> None:
    # Rows already storing 'mixed' would violate the narrower constraint. They
    # are set to NULL rather than guessed at: 'mixed' means the text carried two
    # opposing judgements, and there is no honest way to collapse that into one
    # pole after the fact. NULL says "not known", which is true.
    for _, column in CONSTRAINTS:
        op.execute(
            f"UPDATE feedback_entries SET {column} = NULL WHERE {column} = 'mixed'"
        )

    for name, column in CONSTRAINTS:
        op.drop_constraint(name, "feedback_entries", type_="check")
        op.create_check_constraint(
            name,
            "feedback_entries",
            f"{column} IS NULL OR {column} IN {SENTIMENT_VALUES_OLD}",
        )
