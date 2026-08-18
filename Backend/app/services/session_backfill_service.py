"""Integrate completed sessions into analytics without a browser in the loop.

Why this exists
---------------
The integration payload used to be assembled in the browser: the Analytics pages
fetched each component's view of a session and posted the combined picture. That
made a session's analytics conditional on somebody opening the right page while
the session was still selectable. Sessions where the learner closed the tab, lost
connection, or simply went somewhere else were never recorded — on the
development account, 7 of 10 multimodal sessions had no analytics at all.

Everything those payloads were built from is already in the database. Reading it
here removes the browser from the path entirely, and makes the operation
repeatable: a session that was missed weeks ago can still be brought in.

Idempotent. A session that already has metrics is skipped, so this can be run as
often as it is useful without duplicating anything.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric
from app.models.session_result import SessionResult
from app.schemas.analytics import (
    AnalyticsComponentIntegrationRequest,
    SessionBackfillResult,
    SessionBackfillItem,
)
from app.services import analytics_integration_service


logger = logging.getLogger(__name__)

BACKFILL_VERSION = "session-backfill-v1"

# The multimodal engine records this skill under its own name; analytics tracks
# it as emotional_intelligence.
MCA_SKILL_ALIASES = {"emotional_intelligence": ("emotional_intelligence", "emotional_regulation")}

MAX_NUDGES_PER_SESSION = 50


@dataclass(frozen=True)
class _Candidate:
    session_id: str
    source: str
    label: str


def _sessions_with_metrics(db: Session, user_id: str) -> set[str]:
    rows = (
        db.query(AnalyticsSessionMetric.session_id)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .distinct()
        .all()
    )
    return {row[0] for row in rows}


def _mca_candidates(db: Session, user_id: str) -> list[SessionResult]:
    return (
        db.query(SessionResult)
        .filter(
            SessionResult.user_id == user_id,
            SessionResult.status == "completed",
        )
        .order_by(SessionResult.created_at.asc())
        .all()
    )


def _rpe_candidates(db: Session, user_id: str) -> list[dict]:
    """Role-play sessions, read straight from the engine's own table.

    Raw SQL because the role-play engine owns this table and does not expose an
    ORM model to the rest of the application.
    """
    try:
        rows = db.execute(
            text(
                "SELECT session_id, scenario_id, outcome, final_trust, final_escalation, ended_at "
                "FROM rpe_sessions WHERE auth_user_id = :uid OR user_id = :uid "
                "ORDER BY started_at ASC"
            ),
            {"uid": user_id},
        ).mappings().all()
    except Exception:
        logger.exception("Could not read role-play sessions for user %s", user_id)
        return []
    return [dict(row) for row in rows]


def _mca_skill_scores(session: SessionResult) -> dict[str, float] | None:
    raw = session.skill_scores or {}
    if not isinstance(raw, dict):
        return None

    scores: dict[str, float] = {}
    for key in ("vocal_command", "speech_fluency", "presence_engagement", "emotional_intelligence"):
        names = MCA_SKILL_ALIASES.get(key, (key,))
        for name in names:
            value = raw.get(name)
            if value is not None:
                scores[key] = max(0.0, min(100.0, float(value)))
                break

    return scores or None


def _mca_nudges(session: SessionResult) -> list[dict]:
    log = session.nudge_log
    if not isinstance(log, list):
        return []

    nudges = []
    for entry in log[:MAX_NUDGES_PER_SESSION]:
        if not isinstance(entry, dict):
            continue
        nudges.append(
            {
                "emotion": entry.get("emotion"),
                "confidence": _fraction(entry.get("confidence")),
                "nudge": entry.get("nudge") or entry.get("message"),
                "nudge_category": entry.get("nudge_category") or entry.get("category"),
                "nudge_severity": entry.get("nudge_severity") or entry.get("severity"),
            }
        )
    return nudges


def _fraction(value) -> float | None:
    """Nudge confidence is recorded as either 0-1 or 0-100 depending on age."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number > 1:
        number = number / 100
    return max(0.0, min(1.0, number))


def _payload_for_mca(user_id: str, session: SessionResult) -> AnalyticsComponentIntegrationRequest | None:
    """None when the session recorded nothing worth analysing.

    An abandoned session carries no scores and no nudges. Creating a metric row
    for it would add a session to the learner's count while contributing no
    evidence, which quietly drags every average toward nothing.
    """
    skill_scores = _mca_skill_scores(session)
    nudges = _mca_nudges(session)
    if skill_scores is None and session.overall_score is None and not nudges:
        return None

    return AnalyticsComponentIntegrationRequest(
        user_id=user_id,
        session_id=str(session.id),
        skill_type="communication",
        mca_skill_scores=skill_scores,
        mca_overall_score=(
            max(0.0, min(100.0, float(session.overall_score)))
            if session.overall_score is not None
            else None
        ),
        mca_nudges=nudges,
    )


def _payload_for_rpe(user_id: str, row: dict) -> AnalyticsComponentIntegrationRequest | None:
    """None when the role-play row holds no outcome, trust or escalation.

    The engine writes a row when a session starts, so an abandoned conversation
    leaves one behind with every field empty.
    """
    if row.get("outcome") is None and row.get("final_trust") is None and row.get("final_escalation") is None:
        return None

    return AnalyticsComponentIntegrationRequest(
        user_id=user_id,
        session_id=str(row["session_id"]),
        scenario_id=row.get("scenario_id"),
        skill_type="communication",
        rpe_session={
            "session_id": str(row["session_id"]),
            "scenario_id": row.get("scenario_id"),
            "outcome": row.get("outcome"),
            "final_trust": row.get("final_trust"),
            "final_escalation": row.get("final_escalation"),
        },
    )


def backfill_user_sessions(
    db: Session,
    user_id: str,
    include_rpe: bool = True,
) -> SessionBackfillResult:
    """Bring every completed session that has no analytics into the module.

    Returns a per-session account of what happened, so a caller can show the
    learner what was recovered rather than silently changing their numbers.
    """
    already = _sessions_with_metrics(db, user_id)
    items: list[SessionBackfillItem] = []

    skipped = 0

    for session in _mca_candidates(db, user_id):
        session_id = str(session.id)
        if session_id in already:
            continue
        payload = _payload_for_mca(user_id, session)
        if payload is None:
            skipped += 1
            continue
        items.append(_integrate(db, payload, "mca", session.friendly_id or session_id))

    if include_rpe:
        for row in _rpe_candidates(db, user_id):
            session_id = str(row["session_id"])
            if session_id in already:
                continue
            payload = _payload_for_rpe(user_id, row)
            if payload is None:
                skipped += 1
                continue
            items.append(_integrate(db, payload, "rpe", session_id))

    integrated = [item for item in items if item.integrated]

    # Downstream effects were suppressed per session; run them once now that the
    # learner's history is complete.
    if integrated:
        _sync_downstream(db, user_id)

    return SessionBackfillResult(
        user_id=user_id,
        examined_count=len(items) + skipped,
        integrated_count=len(integrated),
        skipped_count=skipped,
        failed_count=len(items) - len(integrated),
        items=items,
        backfill_version=BACKFILL_VERSION,
    )


def _sync_downstream(db: Session, user_id: str) -> None:
    """Refresh what depends on the learner's full history, once."""
    try:
        from app.services import gamification_service

        gamification_service.sync_user_gamification(db, user_id)
    except Exception:
        logger.exception("Gamification sync after backfill failed for user %s", user_id)


def _integrate(
    db: Session,
    payload: AnalyticsComponentIntegrationRequest,
    source: str,
    label: str,
) -> SessionBackfillItem:
    try:
        result = analytics_integration_service.integrate_component_session_data(
            db, payload, run_downstream=False
        )
        return SessionBackfillItem(
            session_id=payload.session_id,
            source=source,
            label=label,
            integrated=True,
            overall_score=result.metric.overall_score,
        )
    except Exception as exc:
        # One unusable session must not stop the rest from being recovered.
        db.rollback()
        logger.exception("Backfill failed for %s session %s", source, payload.session_id)
        return SessionBackfillItem(
            session_id=payload.session_id,
            source=source,
            label=label,
            integrated=False,
            reason=str(exc)[:200],
        )
