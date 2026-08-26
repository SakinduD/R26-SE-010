"""Only finished sessions that measured something become analytics.

Two ways in existed and only one checked. The backfill sweep took completed
sessions; the session-end hook posted whatever the screen was holding, which
put seven metric rows in from sessions still marked active - three of them
scoring zero. They moved no skill score, because they carry nothing in the four
columns the tracked skills are read from, but they inflated the learner's
session count from 114 to 121 and dragged the overall average down.

A finished session can also hold nothing: scored by penalty and then pulled
toward the midpoint when there were few observations, a short silent session
lands on 50 in every dimension. Stored, those fifties become skill-card scores
and the latest point every trend and forecast is drawn from.

The danger in both fixes is the same one, so most of these tests are about what
must NOT be rejected. Hiding a real session is worse than showing an odd one.
"""

import pytest
from sqlalchemy import text

from app.services import mca_session_quality_service as quality
from app.services import session_backfill_service


class _Session:
    """The fields the predicate reads, without a database round trip."""

    def __init__(self, **fields):
        self.id = fields.get("id", "session-1")
        self.user_id = fields.get("user_id", "quality-user")
        self.friendly_id = fields.get("friendly_id", "MCA-LIVE-TEST")
        self.status = fields.get("status", "completed")
        self.duration_seconds = fields.get("duration_seconds", 39)
        self.overall_score = fields.get("overall_score", 50)
        self.skill_scores = fields.get("skill_scores", _all(50))
        self.emotion_distribution = fields.get("emotion_distribution", {"neutral": 1.0})
        self.nudge_log = fields.get("nudge_log", [])
        self.score_diagnostics = fields.get("score_diagnostics", None)


def _all(value):
    return {
        "vocal_command": value,
        "speech_fluency": value,
        "presence_engagement": value,
        "emotional_regulation": value,
    }


def _real_session(**overrides):
    """A session that measured something and must always be accepted."""
    fields = {
        "skill_scores": _all(78),
        "overall_score": 78,
        "nudge_log": [{"category": "volume", "severity": "warning"}],
        "emotion_distribution": {"neutral": 0.6, "happy": 0.4},
        "duration_seconds": 240,
    }
    fields.update(overrides)
    return _Session(**fields)


# --------------------------------------------------------------- unfinished

@pytest.mark.parametrize("status", ["active", "abandoned", "", None])
def test_a_session_that_is_not_finished_is_rejected(status):
    reason = quality.rejection_reason(_real_session(status=status))

    assert reason is not None
    assert "not completed" in reason


def test_a_finished_session_that_measured_something_is_accepted():
    assert quality.rejection_reason(_real_session()) is None


def test_a_session_this_module_never_stored_is_not_rejected():
    """The integration endpoint accepts payloads for ids it has never seen.

    Refusing those would break every caller that is not the multimodal engine.
    """
    assert quality.rejection_reason(None) is None


# ---------------------------------------------------------- observed nothing

def test_a_session_that_observed_nothing_is_rejected():
    """39 seconds, no nudges, nothing but neutral, every dimension on 50."""
    reason = quality.rejection_reason(_Session())

    assert reason is not None
    # Without a stored rationale the reason is the fallback wording; the
    # engine's own sentence is asserted separately below.
    assert "nothing to score" in reason


def test_a_quiet_but_real_session_is_kept():
    """Zero nudges is a good session, not an empty one.

    This is the misclassification that would matter: nudges are penalties, so a
    learner who triggered none performed well.
    """
    assert quality.rejection_reason(
        _Session(nudge_log=[], skill_scores=_all(78), overall_score=78)
    ) is None


def test_a_session_with_expression_is_kept():
    assert quality.rejection_reason(
        _Session(emotion_distribution={"neutral": 0.7, "happy": 0.3})
    ) is None


def test_a_session_with_coaching_cues_is_kept():
    assert quality.rejection_reason(
        _Session(nudge_log=[{"category": "pace", "severity": "info"}])
    ) is None


def test_one_dimension_away_from_neutral_is_enough_to_keep_it():
    scores = _all(50)
    scores["vocal_command"] = 71
    assert quality.rejection_reason(_Session(skill_scores=scores)) is None


def test_the_reason_uses_the_engines_own_words():
    session = _Session(
        score_diagnostics={
            "llm_rationale": "The provided transcript contains no utterances from the learner.",
            "scoring_method": "llm",
        }
    )

    reason = quality.rejection_reason(session)

    assert "39 seconds" in reason
    assert "no utterances from the learner" in reason


# ------------------------------------------------------------- the mapping

def test_no_metric_row_is_built_for_a_rejected_session():
    """Where the fabricated scores actually got in."""
    assert session_backfill_service._payload_for_mca("u", _Session()) is None
    assert session_backfill_service._payload_for_mca("u", _real_session(status="active")) is None


def test_a_real_session_still_builds_its_payload():
    payload = session_backfill_service._payload_for_mca("u", _real_session())

    assert payload is not None
    assert payload.mca_skill_scores["vocal_command"] == 78
    assert payload.mca_overall_score == 78


def test_the_integration_endpoint_accepts_an_unknown_session(client):
    """Nothing that is not a stored multimodal session is refused here."""
    response = client.post(
        "/api/v1/analytics/integrations/session-complete",
        json={
            "user_id": "quality-endpoint-user",
            "session_id": "not-a-multimodal-session",
            "mca_overall_score": 71,
        },
    )

    assert response.status_code == 201


# ------------------------------------- optional component data must not be fatal

def test_an_adaptive_plan_with_a_numeric_difficulty_integrates(client):
    """The bug behind "No component session data was found yet for this session".

    The adaptive plan stores difficulty as an integer 1-10. ComponentAdaptivePlan
    declared it a string, and the service re-validates strictly after FastAPI has
    already accepted the request as a dict - so the integer 5 raised inside the
    handler and the whole integration failed. The screen then reported that no
    component data existed, on a session whose scores were entirely correct.
    """
    response = client.post(
        "/api/v1/analytics/integrations/session-complete",
        json={
            "user_id": "plan-difficulty-user",
            "session_id": "plan-difficulty-session",
            "skill_type": "communication",
            "adaptive_plan": {
                "skill": "communication",
                "difficulty": 5,
                "primary_scenario": "scenario_001",
            },
            "mca_overall_score": 61,
        },
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    "component",
    [
        {"adaptive_plan": {"recommended_scenario_ids": "not-a-list"}},
        {"survey_profile": {"ocean_scores": "not-a-mapping"}},
        {"mca_nudges": [{"confidence": 61, "nudge": "out of range"}]},
    ],
)
def test_component_data_that_does_not_fit_is_dropped_not_fatal(client, component):
    """Every one of these is context, not the result.

    The session's own scores are what the learner sees; a survey profile or an
    adaptive plan is extra. Losing one of those is a smaller loss than losing
    the session, so a component that does not validate is dropped and logged.
    """
    response = client.post(
        "/api/v1/analytics/integrations/session-complete",
        json={
            "user_id": "component-drop-user",
            "session_id": f"component-drop-{abs(hash(str(component))) % 10000}",
            "skill_type": "communication",
            "mca_overall_score": 61,
            **component,
        },
    )

    assert response.status_code == 201


def test_a_bad_nudge_does_not_take_the_good_ones_with_it(client):
    """Dropped entries must leave the list, not sit in it as None.

    A None among the nudges reaches the scorers as if it were one.
    """
    response = client.post(
        "/api/v1/analytics/integrations/session-complete",
        json={
            "user_id": "nudge-mix-user",
            "session_id": "nudge-mix-session",
            "skill_type": "communication",
            "mca_nudges": [
                {"confidence": 61, "nudge": "out of range"},
                {"confidence": 0.5, "nudge": "fine", "nudge_category": "pace"},
            ],
        },
    )

    assert response.status_code == 201
    assert response.json()["source_summary"]["mca_nudge_count"] == 1


def test_a_scenario_object_in_scenario_id_is_rejected_clearly(client):
    """What the browser was actually sending.

    The adaptive plan endpoint returns `primary_scenario` as the whole scenario -
    title, context, npc_role, thresholds - and three screens passed it straight
    into `scenario_id`. Every integration request came back 422 and the pages
    reported "No component session data was found yet for this session ID." on
    sessions whose scores were entirely correct.

    The frontend now extracts the id (scenarioIdOf). This pins the server side of
    the contract: a scenario object is not an id, and saying so with a 422 is
    right - it should not be quietly accepted and stored as one.
    """
    response = client.post(
        "/api/v1/analytics/integrations/session-complete",
        json={
            "user_id": "scenario-object-user",
            "session_id": "scenario-object-session",
            "scenario_id": {
                "scenario_id": "scenario_004",
                "title": "Sabotaged from Within",
                "npc_role": "Undermining Colleague",
            },
            "mca_overall_score": 61,
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "scenario_id"]


def test_the_extracted_scenario_id_is_accepted(client):
    response = client.post(
        "/api/v1/analytics/integrations/session-complete",
        json={
            "user_id": "scenario-object-user",
            "session_id": "scenario-string-session",
            "scenario_id": "scenario_004",
            "mca_overall_score": 61,
        },
    )

    assert response.status_code == 201
    assert response.json()["scenario_id"] == "scenario_004"


# ------------------------------------------------------- role-play must not enter

@pytest.fixture
def rpe_sessions_table(db_session):
    """The other component's table, for the duration of one test.

    The test database has no rpe_sessions - this component does not own it and
    does not model it. The guard has to be exercised against a real one, and the
    absence of one is itself a case worth pinning, so it is created and dropped
    here rather than in conftest.
    """
    db_session.execute(text("DROP TABLE IF EXISTS rpe_sessions"))
    db_session.execute(
        text("CREATE TABLE rpe_sessions (session_id TEXT PRIMARY KEY, user_id TEXT)")
    )
    db_session.commit()
    yield db_session
    db_session.execute(text("DROP TABLE IF EXISTS rpe_sessions"))
    db_session.commit()


def _integrate(client, session_id: str, **extra):
    return client.post(
        "/api/v1/analytics/integrations/session-complete",
        json={
            "user_id": "role-play-boundary-user",
            "session_id": session_id,
            "skill_type": "communication",
            # The shape a role-play session actually posts: no speech_pace, no
            # eye_contact, no speech_volume - only the secondary fields that the
            # skill composites fall back to.
            "mca_skill_scores": {"clarity": 100, "confidence": 93.75, "empathy": 0},
            "mca_overall_score": 100,
            **extra,
        },
    )


def test_a_role_play_session_is_refused(client, rpe_sessions_table):
    """What put empathy 0 on the latest point of a 114-session history.

    Role-play ids reach this endpoint as ids it has never seen, and unknown ids
    are accepted on purpose. The row that acceptance stored carried clarity,
    confidence and empathy but none of the three multimodal channels, and the
    composites read a secondary when the primary is absent - so it became the
    latest observation of three of the four skills.
    """
    rpe_sessions_table.execute(
        text("INSERT INTO rpe_sessions (session_id, user_id) VALUES ('rpe-1', 'u')")
    )
    rpe_sessions_table.commit()

    response = _integrate(client, "rpe-1")

    assert response.status_code == 409
    assert "role-play" in response.json()["detail"]


def test_an_unknown_session_is_still_accepted_when_the_table_exists(
    client, rpe_sessions_table
):
    """Only role-play ids are turned away, not every id this endpoint cannot place.

    The guard narrows one thing. If it started refusing unknown ids in general it
    would break every caller that is not the multimodal engine, which is the
    contract test_the_integration_endpoint_accepts_an_unknown_session pins.
    """
    assert _integrate(client, "not-a-role-play-session").status_code == 201


def test_the_guard_fails_open_when_the_table_is_missing(client):
    """This component does not own rpe_sessions and cannot rely on it existing.

    Reading another component's schema at request time is a dependency on their
    release, not ours. If they rename or drop that table, refusing every
    integration would be a far worse failure than admitting the rows this guard
    exists to stop - so a lookup that raises lets the payload through.
    """
    assert _integrate(client, "table-is-absent-session").status_code == 201


# ------------------------------------------- the other way role-play data got in

def test_the_apm_analytics_writer_is_off_by_default():
    """The endpoint guard was not the whole boundary, and this is the rest of it.

    `pedagogy/analytics_writer` writes AnalyticsSessionMetric, FeedbackEntry and
    SkillPrediction rows with the ORM directly. Nothing it does passes through
    this component's integration endpoint, so the 409 guard there never saw it.
    It is what actually put the two role-play rows on a 114-session history, and
    what put three predictions about trust_building, assertiveness and
    political_awareness - none of them skills tracked here - into the
    predictions table under this component's own model_version string.

    It is feature-flagged, so the boundary is drawn by leaving the flag off
    rather than by changing a line of APM code. This asserts the default, which
    is the part a future edit could quietly reverse.
    """
    from app.config import Settings

    assert Settings.model_fields["apm_write_analytics"].default is False


def test_the_writer_does_nothing_while_that_default_stands(db_session):
    """The flag is read through one predicate; this is the predicate."""
    from app.services.pedagogy import analytics_writer

    assert analytics_writer._analytics_enabled() is False
