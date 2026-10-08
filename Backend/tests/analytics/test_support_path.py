"""Where the support offer may appear, and where it may not.

Three properties matter more than the detection itself, which is covered in
test_reflection_support.py:

  * It is scoped to the session the words were written on. Offered across a whole
    history it would sit beside advice drawn from months of sessions with nothing
    to attach it to - a standing statement about the person rather than a reply
    to something they wrote.
  * It is never stored. Recommendations are written to the database; a learner's
    distress is not a record this product should keep.
  * The reflection that produced it is withheld from the language model, so the
    model cannot write coaching advice shaped by it.
"""
from datetime import datetime, timedelta

import pytest

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.services import llm_mentoring_service

USER = "support-path-user"
DISTRESSED_SESSION = "support-path-distressed"
ORDINARY_SESSION = "support-path-ordinary"
BASE_TIME = datetime(2026, 4, 1, 10, 0, 0)


def _reflection(db, session_id, comment):
    """A written reflection, stored the way the form stores one: no skill, no rating."""
    db.add(
        FeedbackEntry(
            user_id=USER,
            session_id=session_id,
            feedback_type="self",
            skill_area=None,
            rating=None,
            comment=comment,
            declared_sentiment="positive",
            created_at=BASE_TIME,
        )
    )


@pytest.fixture
def two_sessions(db_session):
    """One session written about a life, one written about a presentation."""
    for index, (session_id, comment) in enumerate(
        [
            (DISTRESSED_SESSION, "I have been burnt out for weeks and I can't sleep"),
            (ORDINARY_SESSION, "I was nervous and I rushed my opening"),
        ]
    ):
        db_session.add(
            AnalyticsSessionMetric(
                user_id=USER,
                session_id=session_id,
                overall_score=65.0,
                created_at=BASE_TIME + timedelta(days=index),
            )
        )
        _reflection(db_session, session_id, comment)
    db_session.commit()
    return db_session


class TestScope:
    def test_the_session_written_about_gets_the_offer(self, two_sessions):
        path = llm_mentoring_service.support_path(two_sessions, DISTRESSED_SESSION)
        assert path is not None
        assert path.level == "support"

    def test_an_ordinary_session_gets_nothing(self, two_sessions):
        assert llm_mentoring_service.support_path(two_sessions, ORDINARY_SESSION) is None

    def test_a_session_with_no_reflection_gets_nothing(self, two_sessions):
        assert llm_mentoring_service.support_path(two_sessions, "no-such-session") is None

    def test_the_helper_cannot_be_called_across_a_history(self):
        """The signature enforces the scope rather than leaving it to the caller.

        An earlier version accepted a user id as well, so a whole history could be
        swept for anything ever written. Removing that argument is what stops the
        offer reappearing weeks after the sentence that caused it.
        """
        import inspect

        parameters = list(inspect.signature(llm_mentoring_service.support_path).parameters)
        assert parameters == ["db", "session_id"]


class TestNotStored:
    def test_the_offer_is_not_a_recommendation(self, two_sessions):
        """It must not reach the recommendations list, which is what gets saved."""
        result = llm_mentoring_service.generate_session_mentoring_recommendations(
            two_sessions, DISTRESSED_SESSION
        )
        assert result.support_path is not None

        written = " ".join(
            f"{item.title} {item.reason} {item.detail} {item.next_action}"
            for item in result.recommendations
        ).lower()
        for number in ("1333", "1926", "011 269 6666"):
            assert number not in written

    def test_the_save_path_never_writes_it(self, two_sessions):
        """The saver reads result.recommendations and nothing else."""
        import inspect

        source = inspect.getsource(llm_mentoring_service._save_recommendations_to_db)
        assert "support_path" not in source


class TestWithheldFromThePrompt:
    def test_a_distressed_reflection_does_not_reach_the_model(self):
        """The prompt already forbids answering it; this withholds it as well.

        Forbidding was not enough on its own: the words stayed in the evidence and
        the model is asked for one recommendation per skill, so a sentence about
        someone's week still shaped the emotional_intelligence card without ever
        being named.
        """
        entry = {
            "feedback_type": "self",
            "skill_area": None,
            "rating": None,
            "sentiment": "negative",
            "comment": "I have been burnt out for weeks and I can't sleep",
        }
        compacted = llm_mentoring_service._compact_feedback(entry)
        assert compacted["comment"] is None
        # The rating and the sentiment are about the session, and stay.
        assert compacted["sentiment"] == "negative"

    def test_an_ordinary_reflection_reaches_the_model_intact(self):
        entry = {
            "feedback_type": "self",
            "skill_area": "vocal_command",
            "rating": 75.0,
            "sentiment": "negative",
            "comment": "I rushed my opening and forgot the second point",
        }
        compacted = llm_mentoring_service._compact_feedback(entry)
        assert compacted["comment"] == "I rushed my opening and forgot the second point"


class TestEndpoint:
    def test_the_endpoint_returns_the_offer(self, client, two_sessions):
        response = client.get(
            f"/api/v1/analytics/sessions/{DISTRESSED_SESSION}/reflection-support"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["level"] == "support"
        assert [contact["number"] for contact in body["contacts"]] == [
            "1333", "1926", "011 269 6666",
        ]

    def test_the_endpoint_returns_null_when_there_is_nothing_to_offer(
        self, client, two_sessions
    ):
        response = client.get(
            f"/api/v1/analytics/sessions/{ORDINARY_SESSION}/reflection-support"
        )
        assert response.status_code == 200
        assert response.json() is None
