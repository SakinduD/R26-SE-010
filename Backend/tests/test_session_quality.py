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
