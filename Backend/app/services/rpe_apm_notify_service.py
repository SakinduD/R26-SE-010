"""
Notifies APM that an RPE session finished, via APM's own real callback:
POST /api/v1/apa/session-feedback (see app/api/v1/pedagogy.py::receive_session_feedback).

Not to be confused with app/services/rpe_apa_service.py — that file is an
explicit dead stub (see Backend/docs handoff notes); this module is the
actual integration path, calling APM's existing endpoint unmodified, the
same way rpe_plan_import_service.fetch_scenario_brief() already calls
APM's scenario-brief endpoint.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import httpx

from app.config import get_settings

if TYPE_CHECKING:
    from app.services.rpe_feedback_service import RpeFeedbackService
    from app.services.rpe_session_service   import RpeSessionService

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 8.0


class RpeApmNotifyService:
    def __init__(
        self,
        session_service:  RpeSessionService,
        feedback_service: RpeFeedbackService,
    ) -> None:
        self._session  = session_service
        self._feedback = feedback_service

    def notify_session_complete(self, session_id: str) -> bool:
        """
        POST this session's feedback report to APM so it can adjust the
        learner's training plan. Fire-and-forget by contract: swallows all
        errors and returns False instead of raising — a failed notification
        must never break the session-complete flow for the learner.

        Deliberately synchronous, not async: generate_feedback() calls
        rpe_coaching_service, which bridges into an async LLM call via
        asyncio.run() — safe only when nothing above it is already running
        on an event loop. Same reason the existing GET /session-feedback
        route is a plain `def`, not `async def`; this follows suit rather
        than fighting FastAPI's threadpool-for-sync-routes behaviour.
        """
        try:
            session = self._session.get_session(session_id)
        except FileNotFoundError:
            return False

        auth_user_id = session.get("auth_user_id")
        if not auth_user_id:
            return False  # guest session — no persistent APM profile to update

        try:
            feedback = self._feedback.generate_feedback(session_id)
        except Exception as exc:
            logger.error("RPE->APM notify: feedback generation failed for %s: %s", session_id, exc)
            return False

        # APM identifies the learner by their real Supabase UUID, not RPE's
        # looser internal user_id (which can be "guest" or a display name).
        payload = {**feedback, "user_id": auth_user_id}

        settings = get_settings()
        url = f"{settings.rpe_base_url.rstrip('/')}/api/v1/apa/session-feedback"

        try:
            with httpx.Client(timeout=DEFAULT_TIMEOUT_S) as client:
                resp = client.post(
                    url, json=payload, headers={"X-Service-Token": settings.apm_service_token}
                )
            if resp.status_code != 200:
                logger.warning(
                    "RPE->APM notify: %s returned %s: %s", url, resp.status_code, resp.text[:200]
                )
                return False
        except httpx.RequestError as exc:
            logger.warning("RPE->APM notify: network error reaching APM: %s", exc)
            return False

        return True
