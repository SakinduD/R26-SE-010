"""Bringing stored sentiment readings up to the current model.

A reading is written once, when the comment is created, and never looked at
again - so the database holds whatever model was serving on the day each
reflection was written. Swapping the model changes what new entries say and
leaves every older one frozen on the previous model's answer, while the blind
spot detector goes on reading the stored value.

The model itself is not under test here; it has its own tests, and loading the
transformer would make these slow and dependent on a 268MB file. What is tested
is which rows are touched, which are left alone, and what happens when one of
them cannot be read.
"""
import uuid
from datetime import datetime, timedelta

import pytest

from app.models.analytics import FeedbackEntry
from app.services import sentiment_reread_service
from app.schemas.analytics import FeedbackSentimentResult

BASE_TIME = datetime(2026, 6, 1, 12, 0, 0)
NEW_MODEL = "test-model-v2"


@pytest.fixture
def user():
    """A learner nobody else in this run shares.

    The test database is created once and never cleared between tests, so rows
    written by an earlier test are still there. Every assertion here counts rows
    for one learner, which only holds if that learner is unique.
    """
    return f"reread-{uuid.uuid4()}"


@pytest.fixture
def other_user():
    return f"reread-other-{uuid.uuid4()}"


@pytest.fixture
def fixed_model(monkeypatch):
    """Every comment reads as 'mixed' at 0.96, whatever it says.

    A fixed answer is what makes the assertions about *which rows changed*
    readable - the interesting behaviour is the selection, not the classification.
    """
    def _read(text):
        return FeedbackSentimentResult(
            text=text,
            cleaned_text=text.lower(),
            sentiment="mixed",
            confidence=0.96,
            sentiment_score=0.0,
            class_probabilities={"negative": 0.02, "mixed": 0.96, "positive": 0.02},
            model_version=NEW_MODEL,
            model_type="test",
            source="ml_model",
        )

    monkeypatch.setattr(
        sentiment_reread_service.sentiment_analysis_service,
        "analyze_feedback_text",
        _read,
    )
    return _read


def _entry(db, comment, *, source, sentiment, user_id, confidence=0.55, minutes=0):
    entry = FeedbackEntry(
        user_id=user_id,
        session_id=f"reread-{user_id}-{minutes}",
        feedback_type="self",
        skill_area=None,
        rating=None,
        comment=comment,
        sentiment=sentiment,
        declared_sentiment="positive",
        sentiment_confidence=confidence,
        sentiment_source=source,
        sentiment_model_version="test-model-v1",
        created_at=BASE_TIME + timedelta(minutes=minutes),
    )
    db.add(entry)
    return entry


class TestWhichRowsAreTouched:
    def test_only_rows_a_model_judged_are_re_read(self, db_session, fixed_model, user):
        """A rule-derived label belongs to its producer, not to a model.

        Re-reading system-generated feedback would replace a known-correct label
        with a guess about our own wording.
        """
        model_row = _entry(db_session, "I was fine but rushed", source="model",
                           sentiment="negative", minutes=0, user_id=user)
        rule_row = _entry(db_session, "Multimodal average was low", source="rule",
                          sentiment="negative", minutes=1, user_id=user)
        declared_row = _entry(db_session, "No model ran on this", source="declared",
                              sentiment="positive", minutes=2, user_id=user)
        db_session.commit()

        result = sentiment_reread_service.reread_user_sentiment(db_session, user)

        assert result.examined_count == 1
        assert [item.entry_id for item in result.items] == [model_row.id]
        db_session.refresh(rule_row)
        db_session.refresh(declared_row)
        assert rule_row.sentiment == "negative"
        assert declared_row.sentiment == "positive"

    def test_rows_belonging_to_another_learner_are_left_alone(
        self, db_session, fixed_model, user, other_user
    ):
        mine = _entry(db_session, "my reflection", source="model",
                      sentiment="negative", minutes=10, user_id=user)
        theirs = _entry(db_session, "their reflection", source="model",
                        sentiment="negative", user_id=other_user, minutes=11)
        db_session.commit()

        sentiment_reread_service.reread_user_sentiment(db_session, user)

        db_session.refresh(mine)
        db_session.refresh(theirs)
        assert mine.sentiment == "mixed"
        assert theirs.sentiment == "negative"

    def test_an_empty_comment_is_skipped(self, db_session, fixed_model, user):
        _entry(db_session, "   ", source="model", sentiment="negative", minutes=20, user_id=user)
        db_session.commit()

        result = sentiment_reread_service.reread_user_sentiment(db_session, user)
        assert result.items == []
        assert result.updated_count == 0


class TestWhatIsWritten:
    def test_the_reading_and_its_version_are_stored(self, db_session, fixed_model, user):
        entry = _entry(db_session, "two feelings at once", source="model",
                       sentiment="negative", confidence=0.55, minutes=30, user_id=user)
        db_session.commit()

        result = sentiment_reread_service.reread_user_sentiment(db_session, user)

        db_session.refresh(entry)
        assert entry.sentiment == "mixed"
        assert entry.sentiment_confidence == 0.96
        assert entry.sentiment_model_version == NEW_MODEL
        assert result.model_version == NEW_MODEL
        assert result.updated_count == 1

    def test_a_row_the_model_reads_the_same_way_is_reported_unchanged(
        self, db_session, fixed_model, user
    ):
        _entry(db_session, "already mixed", source="model", sentiment="mixed", minutes=40, user_id=user)
        db_session.commit()

        result = sentiment_reread_service.reread_user_sentiment(db_session, user)
        assert result.updated_count == 1
        assert result.changed_count == 0
        assert result.items[0].changed is False

    def test_the_before_and_after_are_both_reported(self, db_session, fixed_model, user):
        _entry(db_session, "was read as negative", source="model",
               sentiment="negative", confidence=0.55, minutes=50, user_id=user)
        db_session.commit()

        item = sentiment_reread_service.reread_user_sentiment(db_session, user).items[0]
        assert (item.before, item.before_confidence) == ("negative", 0.55)
        assert (item.after, item.after_confidence) == ("mixed", 0.96)
        assert item.changed is True


class TestDryRun:
    def test_a_dry_run_reports_without_writing(self, db_session, fixed_model, user):
        """So the effect on a learner's history can be seen before it is applied."""
        entry = _entry(db_session, "unchanged on disk", source="model",
                       sentiment="negative", minutes=60, user_id=user)
        db_session.commit()

        result = sentiment_reread_service.reread_user_sentiment(
            db_session, user, dry_run=True
        )

        assert result.changed_count == 1
        assert result.updated_count == 0
        db_session.refresh(entry)
        assert entry.sentiment == "negative"
        assert entry.sentiment_model_version == "test-model-v1"


class TestFailureIsContained:
    def test_one_unreadable_comment_does_not_stop_the_rest(self, db_session, monkeypatch, user):
        def _read(text):
            if "poison" in text:
                raise RuntimeError("model blew up on this one")
            return FeedbackSentimentResult(
                text=text,
                cleaned_text=text,
                sentiment="mixed",
                confidence=0.9,
                sentiment_score=0.0,
                class_probabilities={"negative": 0.05, "mixed": 0.9, "positive": 0.05},
                model_version=NEW_MODEL,
                model_type="test",
                source="ml_model",
            )

        monkeypatch.setattr(
            sentiment_reread_service.sentiment_analysis_service,
            "analyze_feedback_text",
            _read,
        )
        _entry(db_session, "poison comment", source="model", sentiment="negative", minutes=70, user_id=user)
        good = _entry(db_session, "ordinary comment", source="model",
                      sentiment="negative", minutes=71, user_id=user)
        db_session.commit()

        result = sentiment_reread_service.reread_user_sentiment(db_session, user)

        assert result.failed_count == 1
        assert result.updated_count == 1
        db_session.refresh(good)
        assert good.sentiment == "mixed"
