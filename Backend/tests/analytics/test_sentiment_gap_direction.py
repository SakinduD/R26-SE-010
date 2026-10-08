"""The sentiment blind spot may only fire in the directions the model earned.

Measured on the hand-labelled workplace validation set at the serving confidence
gate, the fine-tuned classifier reads "positive" at 0.91 precision and "mixed" at
0.73, but "negative" at only 0.69 - and what it gets wrong there is mostly
positive or judgement-free text. Only the first two support telling a learner
something about themselves.

These tests exist so that restriction cannot be dropped silently. If a future
model is good enough in both directions, the right move is to re-measure it on
that validation set and then change these tests deliberately - not to widen the
rule and discover the consequence in front of a user.
"""

from datetime import datetime

from app.models.analytics import FeedbackEntry
from app.services import blind_spot_service


def _entry(declared: str, detected: str, confidence: float = 0.85) -> FeedbackEntry:
    return FeedbackEntry(
        user_id="u-1",
        session_id="s-1",
        feedback_type="self",
        skill_area="vocal_command",
        comment="A written reflection long enough to be analysed.",
        declared_sentiment=declared,
        sentiment=detected,
        sentiment_confidence=confidence,
        sentiment_source="model",
        sentiment_model_version="test-model",
        created_at=datetime(2026, 8, 19, 12, 0, 0),
    )


def test_reading_the_learner_more_kindly_than_they_rated_is_reported():
    gap = blind_spot_service._sentiment_gap_from_entry(_entry("negative", "positive"))

    assert gap is not None
    assert gap.declared_sentiment == "negative"
    assert gap.detected_sentiment == "positive"
    assert gap.severity == "high"


def test_reading_the_learner_more_harshly_than_they_rated_is_not_reported():
    """The direction measured at 0.69 precision stays out of the findings.

    A confident wrong reading here would tell a learner their own account
    betrays a difficulty they never described.
    """
    gap = blind_spot_service._sentiment_gap_from_entry(_entry("positive", "negative"))

    assert gap is None


def test_high_confidence_does_not_buy_back_the_untrusted_direction():
    """Raising confidence does not make the negative reading safe.

    On the validation set the wrong negative readings are among the most
    confident: "I used the practice plan that was assigned to me" is read as
    negative at 0.99.
    """
    assert blind_spot_service._sentiment_gap_from_entry(
        _entry("positive", "negative", confidence=0.99)
    ) is None


def test_low_confidence_is_still_rejected_in_the_trusted_direction():
    assert blind_spot_service._sentiment_gap_from_entry(
        _entry("negative", "positive", confidence=0.51)
    ) is None


def test_agreement_is_not_a_gap():
    assert blind_spot_service._sentiment_gap_from_entry(
        _entry("positive", "positive")
    ) is None


def test_a_mixed_reading_is_reported():
    """The class real learners' reflections actually fall into.

    Every reflection collected from a real user so far is either positive or
    mixed; none is negative or judgement-free.
    """
    gap = blind_spot_service._sentiment_gap_from_entry(_entry("positive", "mixed"))

    assert gap is not None
    assert gap.detected_sentiment == "mixed"
    assert gap.recommendation


def test_trusted_set_is_explicit_about_what_it_excludes():
    """A guard on the constant itself, so widening it is a deliberate edit."""
    assert blind_spot_service.TRUSTED_DETECTED_SENTIMENTS == frozenset(
        {"positive", "mixed"}
    )
