"""Which multimodal sessions are allowed to become analytics.

Two sessions do not belong in a learner's scores, and both were reaching them.

Unfinished sessions
-------------------
The backfill sweep only ever picked up sessions marked ``completed``. The
session-end hook did not: it posts whatever session the screen is holding
straight to ``/integrations/session-complete``, which never looked at status.
On the development account that put 7 metric rows in from sessions still marked
``active`` - four with no scores at all and three with an overall of 0.0.

None of them carried a value in any of the four columns the tracked skills are
read from, so they never moved a skill score. What they did move was the
learner's session count - 121 where 114 sessions had actually been finished -
and the overall average, which three zeros pull down.

Sessions that observed nothing
------------------------------
A session can be finished and still have nothing in it. ``calculate_session_metrics``
scores by penalty and then applies a reliability correction that pulls each
dimension toward the midpoint when there were few observation windows, so a
short silent session lands on 50 across the board. The engine records why:

    "The provided transcript contains no utterances from the learner, making it
     impossible to evaluate their vocal performance, fluency, engagement, or
     emotional state."

That sentence sits in ``score_diagnostics`` on the session. Stored as analytics,
those four fifties become skill-card scores and the most recent point every
trend line and forecast is drawn from.

Detecting the second one
------------------------
The obvious signal is wrong. ``obp_per_dimension`` is all zeros in most healthy
sessions too - zero nudges is a *good* session - so an all-zero OBP cannot mean
"nothing measured".

What separates an empty session from a good quiet one is that nothing was
observed on any channel at once: no nudges fired, no emotion but neutral, and
every dimension left on the neutral default. Any one of those alone is
ordinary; together they mean the recording produced no observations.

The rule is deliberately narrow. Wrongly hiding a real session is worse than
showing an odd one, so all three clauses have to agree.
"""

from __future__ import annotations

from app.models.session_result import SessionResult

QUALITY_VERSION = "mca-session-quality-v2"

# Where the reliability correction leaves a dimension it could not move.
# Not a score - a starting point nothing shifted.
NEUTRAL_SCORE = 50

TRACKED_SKILLS = (
    "vocal_command",
    "speech_fluency",
    "presence_engagement",
    "emotional_regulation",
)


def rejection_reason(session: SessionResult | None) -> str | None:
    """Why this session must not become analytics, or None if it may.

    None for a session this module has no opinion about, including one it has
    never heard of - the integration endpoint accepts payloads for sessions
    that were never stored here, and refusing those would break them.
    """
    if session is None:
        return None
    if not _is_finished(session):
        return (
            f"session is {session.status or 'unfinished'}, not completed - "
            "an unfinished session has no result to record"
        )
    if is_unscored(session):
        return explain(session)
    return None


def _is_finished(session: SessionResult) -> bool:
    return str(session.status or "").lower() == "completed"


def is_unscored(session: SessionResult) -> bool:
    """True when the session recorded no observations on any channel."""
    return (
        not _has_nudges(session)
        and not _has_expressed_emotion(session)
        and _every_score_is_neutral(session)
    )


def explain(session: SessionResult) -> str:
    """What to tell the learner, in their terms rather than the engine's."""
    duration = session.duration_seconds or 0
    length = f"{duration} second{'s' if duration != 1 else ''}"

    rationale = _llm_rationale(session)
    if rationale:
        return (
            f"this session ran {length} and there was nothing in it to measure. "
            f"The scoring engine reported: {rationale}"
        )
    return (
        f"this session ran {length} without picking up speech, expression or any "
        "coaching cue, so there was nothing to score"
    )


def _has_nudges(session: SessionResult) -> bool:
    log = session.nudge_log
    return bool(log) if isinstance(log, list) else bool(log)


def _has_expressed_emotion(session: SessionResult) -> bool:
    """Anything the camera classified as other than neutral, with weight on it.

    ``{"neutral": 1.0}`` is the classifier finding nothing to report, not the
    learner being composed.
    """
    distribution = session.emotion_distribution
    if not isinstance(distribution, dict) or not distribution:
        return False
    return any(
        str(emotion).lower() != "neutral" and float(weight or 0) > 0
        for emotion, weight in distribution.items()
    )


def _every_score_is_neutral(session: SessionResult) -> bool:
    scores = session.skill_scores
    if not isinstance(scores, dict) or not scores:
        return False
    present = [scores.get(skill) for skill in TRACKED_SKILLS]
    if any(value is None for value in present):
        return False
    return all(float(value) == float(NEUTRAL_SCORE) for value in present)


def _llm_rationale(session: SessionResult) -> str | None:
    diagnostics = session.score_diagnostics
    if not isinstance(diagnostics, dict):
        return None
    rationale = diagnostics.get("llm_rationale")
    return str(rationale).strip() if rationale else None
