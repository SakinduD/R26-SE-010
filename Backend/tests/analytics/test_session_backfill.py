"""Bringing completed multimodal sessions into analytics, and knowing when not to.

The sweep exists because the two components are joined by stored rows rather than
a live call, so a session can finish without its scores ever reaching analytics.
The two rules it has to get right pull in opposite directions:

  * A session whose scores arrived late must still be picked up. The completion
    hook fires before scoring finishes and writes a row of nulls; treating that
    row as proof of integration froze the session out permanently.
  * A session the engine never actually scored must be refused, because storing
    it puts four fabricated fifties into the learner's history and drags every
    trend and forecast drawn from it.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.analytics import AnalyticsSessionMetric
from app.models.session_result import SessionResult
from app.services import session_backfill_service

BASE_TIME = datetime(2026, 5, 1, 8, 0, 0, tzinfo=timezone.utc)

# The sweep is called with a string, which is what the API layer passes and what
# the integration schema requires. Two columns behind it want different types -
# SessionResult.user_id is a UUID, AnalyticsSessionMetric.user_id is a String -
# and the service now converts for each rather than leaving it to the driver.

REAL_SCORES = {
    "vocal_command": 73,
    "speech_fluency": 68,
    "presence_engagement": 70,
    "emotional_regulation": 55,
}
# Exactly 50 on every dimension is what the engine emits when it observed
# nothing on any channel. It is not a result.
UNSCORED = dict.fromkeys(REAL_SCORES, 50)


def _mca_session(db, user_id, skill_scores=None, overall=67, status="completed", minutes=0):
    session = SessionResult(
        id=uuid.uuid4(),
        user_id=user_id,
        session_type="live",
        status=status,
        started_at=BASE_TIME + timedelta(minutes=minutes),
        ended_at=BASE_TIME + timedelta(minutes=minutes + 1),
        duration_seconds=60,
        overall_score=overall,
        skill_scores=skill_scores if skill_scores is not None else dict(REAL_SCORES),
        nudge_log=[],
        created_at=BASE_TIME + timedelta(minutes=minutes),
    )
    db.add(session)
    return session


def _empty_metric_row(db, user_id, session_id):
    """What the completion hook writes before scoring has finished."""
    db.add(
        AnalyticsSessionMetric(
            user_id=str(user_id),
            session_id=str(session_id),
            created_at=BASE_TIME,
        )
    )


class TestARowOfNullsIsNotIntegration:
    """The fix that unblocked two real sessions on this account."""

    def test_a_session_holding_only_nulls_is_still_eligible(self, db_session):
        user_id = uuid.uuid4()
        session = _mca_session(db_session, user_id)
        _empty_metric_row(db_session, user_id, session.id)
        db_session.commit()

        integrated = session_backfill_service._sessions_with_metrics(db_session, str(user_id))
        assert str(session.id) not in integrated

    def test_a_session_holding_a_score_is_not_swept_again(self, db_session):
        user_id = uuid.uuid4()
        session = _mca_session(db_session, user_id)
        db_session.add(
            AnalyticsSessionMetric(
                user_id=str(user_id),
                session_id=str(session.id),
                overall_score=67.0,
                created_at=BASE_TIME,
            )
        )
        db_session.commit()

        integrated = session_backfill_service._sessions_with_metrics(db_session, str(user_id))
        assert str(session.id) in integrated

    def test_any_one_score_column_counts_as_integrated(self, db_session):
        """A session can be scored on some channels and not others."""
        user_id = uuid.uuid4()
        session = _mca_session(db_session, user_id)
        db_session.add(
            AnalyticsSessionMetric(
                user_id=str(user_id),
                session_id=str(session.id),
                overall_score=None,
                speech_volume_score=73.0,
                created_at=BASE_TIME,
            )
        )
        db_session.commit()

        integrated = session_backfill_service._sessions_with_metrics(db_session, str(user_id))
        assert str(session.id) in integrated


class TestTheSweep:
    def test_a_scored_session_is_integrated(self, db_session):
        user_id = uuid.uuid4()
        session = _mca_session(db_session, user_id)
        db_session.commit()

        result = session_backfill_service.backfill_user_sessions(db_session, str(user_id))
        assert result.integrated_count == 1
        assert result.failed_count == 0

        row = (
            db_session.query(AnalyticsSessionMetric)
            .filter(AnalyticsSessionMetric.session_id == str(session.id))
            .one()
        )
        assert row.overall_score == 67.0
        # MCA names the fourth skill emotional_regulation; analytics maps it onto
        # the empathy and emotional-control columns.
        assert row.empathy_score == 55.0
        assert row.emotional_control_score == 55.0

    def test_a_session_stuck_behind_an_empty_row_is_recovered(self, db_session):
        user_id = uuid.uuid4()
        session = _mca_session(db_session, user_id)
        _empty_metric_row(db_session, user_id, session.id)
        db_session.commit()

        result = session_backfill_service.backfill_user_sessions(db_session, str(user_id))
        assert result.integrated_count == 1

        rows = (
            db_session.query(AnalyticsSessionMetric)
            .filter(AnalyticsSessionMetric.session_id == str(session.id))
            .all()
        )
        assert any(row.overall_score == 67.0 for row in rows)

    def test_running_the_sweep_twice_integrates_nothing_the_second_time(self, db_session):
        user_id = uuid.uuid4()
        _mca_session(db_session, user_id)
        db_session.commit()

        first = session_backfill_service.backfill_user_sessions(db_session, str(user_id))
        second = session_backfill_service.backfill_user_sessions(db_session, str(user_id))
        assert first.integrated_count == 1
        assert second.integrated_count == 0

    def test_a_learner_with_no_sessions_is_not_an_error(self, db_session):
        result = session_backfill_service.backfill_user_sessions(db_session, str(uuid.uuid4()))
        assert result.integrated_count == 0
        assert result.examined_count == 0


class TestWhatIsRefused:
    def test_a_session_scored_fifty_everywhere_is_skipped(self, db_session):
        """Not a result - the signature of an engine that observed nothing."""
        user_id = uuid.uuid4()
        _mca_session(db_session, user_id, skill_scores=dict(UNSCORED), overall=50)
        db_session.commit()

        result = session_backfill_service.backfill_user_sessions(db_session, str(user_id))
        assert result.integrated_count == 0
        assert result.skipped_count == 1

    def test_an_unfinished_session_is_skipped(self, db_session):
        user_id = uuid.uuid4()
        _mca_session(db_session, user_id, status="active")
        db_session.commit()

        result = session_backfill_service.backfill_user_sessions(db_session, str(user_id))
        assert result.integrated_count == 0

    def test_a_session_with_nothing_recorded_is_skipped(self, db_session):
        """A session that finished but produced no scores and no nudges."""
        user_id = uuid.uuid4()
        session = _mca_session(db_session, user_id, overall=None)
        session.skill_scores = None
        session.nudge_log = []
        db_session.commit()

        result = session_backfill_service.backfill_user_sessions(db_session, str(user_id))
        assert result.integrated_count == 0
        assert result.skipped_count == 1


class TestTargetedRun:
    def test_naming_a_session_re_reads_it_even_when_it_has_a_row(self, db_session):
        """What a screen calls the moment a session ends.

        The scores are computed a moment after the session closes, so the hook
        that fires on completion can arrive first. Skipping a session that
        already has a row would freeze that empty row in place for good.
        """
        user_id = uuid.uuid4()
        session = _mca_session(db_session, user_id)
        _empty_metric_row(db_session, user_id, session.id)
        db_session.commit()

        result = session_backfill_service.backfill_user_sessions(
            db_session, str(user_id), session_id=str(session.id)
        )
        assert result.integrated_count == 1

    def test_naming_another_learners_session_integrates_nothing(self, db_session):
        user_id = uuid.uuid4()
        _mca_session(db_session, user_id)
        db_session.commit()

        result = session_backfill_service.backfill_user_sessions(
            db_session, str(user_id), session_id=str(uuid.uuid4())
        )
        assert result.integrated_count == 0
