"""One rating per skill per session, however many times the form was submitted.

The self-rating form inserts rather than updates, so re-submitting stores another
row instead of correcting the first. On this account one session held the same
skill six times. Averaging all of them does two wrong things at once: a rating
the learner corrected still counts, and a session submitted six times carries six
times the weight of one submitted once.

Every figure the component shows is downstream of this - the radar, the counts,
the blind spots, the trends - so the tests below fix the behaviour at the point
the data is read, and check that the numbers on the screen agree with each other
afterwards.
"""
from datetime import datetime, timedelta

import pytest

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.services import data_aggregation_service, feedback_analysis_service

# The test database is created once for the whole run and never cleared between
# tests, so ids have to be unique per test rather than relying on a clean table.
# This is the convention the rest of the suite already follows.
USER = "dedup-user"
USER_HISTORY = "dedup-user-history"
SESSION = "dedup-session"
BASE_TIME = datetime(2026, 3, 1, 9, 0, 0)


def _self_rating(db, skill, rating, minutes_later, session_id=SESSION, user_id=USER):
    """One self-rating row, written the way the form writes them."""
    entry = FeedbackEntry(
        user_id=user_id,
        session_id=session_id,
        feedback_type="self",
        skill_area=skill,
        rating=rating,
        created_at=BASE_TIME + timedelta(minutes=minutes_later),
    )
    db.add(entry)
    return entry


@pytest.fixture
def resubmitted_session(db_session):
    """A session rated once, then corrected, then re-submitted four more times.

    Presence reads 75, then 70 four times over - the shape found in the real
    data. The learner's answer is 70; the 75 they corrected is not.
    """
    db_session.add(
        AnalyticsSessionMetric(
            user_id=USER,
            session_id=SESSION,
            eye_contact_score=60.0,
            confidence_score=60.0,
            overall_score=60.0,
            created_at=BASE_TIME,
        )
    )
    _self_rating(db_session, "presence_engagement", 75.0, 0)
    for minute in (1, 2, 3, 4):
        _self_rating(db_session, "presence_engagement", 70.0, minute)
    _self_rating(db_session, "vocal_command", 80.0, 5)
    db_session.commit()
    return db_session


class TestSessionAggregate:
    def test_the_latest_rating_wins_not_the_mean(self, resubmitted_session):
        aggregate = data_aggregation_service.get_session_aggregate(
            resubmitted_session, SESSION
        )
        # mean(75, 70, 70, 70, 70) would be 71.0 - the corrected 75 still counting.
        assert aggregate.feedback.self_rating_averages["presence_engagement"] == 70.0

    def test_a_skill_appears_once_in_the_latest_entries(self, resubmitted_session):
        aggregate = data_aggregation_service.get_session_aggregate(
            resubmitted_session, SESSION
        )
        skills = [
            entry.skill_area
            for entry in aggregate.feedback.latest_entries
            if entry.feedback_type == "self"
        ]
        assert sorted(skills) == ["presence_engagement", "vocal_command"]

    def test_the_row_count_reflects_skills_not_submissions(self, resubmitted_session):
        aggregate = data_aggregation_service.get_session_aggregate(
            resubmitted_session, SESSION
        )
        # Six rows were written; two skills were rated.
        assert aggregate.feedback.by_type["self"] == 2

    def test_a_single_submission_is_unaffected(self, db_session):
        db_session.add(
            AnalyticsSessionMetric(
                user_id=USER, session_id="clean", overall_score=70.0, created_at=BASE_TIME
            )
        )
        _self_rating(db_session, "speech_fluency", 65.0, 0, session_id="clean")
        db_session.commit()
        aggregate = data_aggregation_service.get_session_aggregate(db_session, "clean")
        assert aggregate.feedback.self_rating_averages["speech_fluency"] == 65.0
        assert aggregate.feedback.by_type["self"] == 1


class TestAcrossSessions:
    def test_each_session_keeps_its_own_latest_rating(self, db_session):
        """Deduplication is per session, not per skill.

        Keying on the skill alone would collapse a learner's whole history into
        one rating and destroy every trend built on it.
        """
        for index, (session, rating) in enumerate(
            [("hist-s1", 50.0), ("hist-s2", 60.0), ("hist-s3", 70.0)]
        ):
            db_session.add(
                AnalyticsSessionMetric(
                    user_id=USER_HISTORY,
                    session_id=session,
                    overall_score=55.0,
                    created_at=BASE_TIME + timedelta(days=index),
                )
            )
            _self_rating(
                db_session, "vocal_command", rating, index * 60,
                session_id=session, user_id=USER_HISTORY,
            )
        db_session.commit()

        aggregate = data_aggregation_service.get_user_aggregate(db_session, USER_HISTORY)
        ratings = sorted(
            entry.rating
            for entry in aggregate.feedback.latest_entries
            if entry.feedback_type == "self" and entry.skill_area == "vocal_command"
        )
        assert ratings == [50.0, 60.0, 70.0]


class TestTheTwoServicesAgree:
    """The radar and the blind spot panel must not disagree on one number.

    They are computed by different services. Before deduplication was applied at
    the source, the aggregate averaged every submission while the analysis kept
    the latest, so the same page showed a skill's self-rating as both 71 and 70.
    """

    def test_aggregate_and_analysis_report_the_same_self_rating(
        self, resubmitted_session
    ):
        aggregate = data_aggregation_service.get_session_aggregate(
            resubmitted_session, SESSION
        )
        analysis = feedback_analysis_service.analyze_session_feedback(
            resubmitted_session, SESSION
        )
        from_aggregate = aggregate.feedback.self_rating_averages["presence_engagement"]
        from_analysis = next(
            item.self_rating
            for item in analysis.items
            if item.skill_area == "presence_engagement"
        )
        assert from_aggregate == from_analysis == 70.0
