"""Which multimodal sessions are allowed to become analytics.

Two kinds are kept out:
- Unfinished sessions (not ``completed``): they inflate session counts and
  drag averages down with zero scores.
- Sessions that observed nothing: scoring leaves every skill at 50 when there
  is no evidence. Rejected only when there are also no nudges and no
  non-neutral emotion, so a genuinely good quiet session is never hidden.
"""

from __future__ import annotations

from app.models.session_result import SessionResult

QUALITY_VERSION = "mca-session-quality-v2"

# What scoring gives a skill with no evidence.
NEUTRAL_SCORE = 50

TRACKED_SKILLS = (
    "vocal_command",
    "speech_fluency",
    "presence_engagement",
    "emotional_regulation",
)


def rejection_reason(session: SessionResult | None) -> str | None:
    """Why this session must not become analytics, or None if it may (including unknown sessions)."""
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
    """Any non-neutral emotion with weight (all-neutral means nothing was detected)."""
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
