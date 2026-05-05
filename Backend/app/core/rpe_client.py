"""
RPE HTTP Client — async wrapper around the in-process RPE module.

Even though RPE runs in the same FastAPI app for now, we call it over HTTP so
the integration matches what production would look like (RPE could be split
into a separate service later without touching APM code).

Configured via settings.rpe_base_url (default http://localhost:8000).
"""
from __future__ import annotations

import logging

import httpx

from app.config import get_settings
from app.contracts.rpe import (
    ApaLearnerProfile,
    ScenarioDetail,
    ScenarioSummary,
)

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 5.0


class RpeClientError(Exception):
    """Raised when RPE returns a non-2xx or is unreachable."""

    def __init__(
        self, message: str, *, status_code: int | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code


class RpeClient:
    """
    Async client for RPE's /api/v1/rpe/* endpoints.

    Endpoints used by APM:
        POST /api/v1/rpe/apa/recommend
        GET  /api/v1/rpe/scenarios/detail/{scenario_id}
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        self._base_url = (base_url or get_settings().rpe_base_url).rstrip("/")
        self._timeout = timeout_s

    async def recommend_scenarios(
        self, profile: ApaLearnerProfile
    ) -> list[ScenarioSummary]:
        url = f"{self._base_url}/api/v1/rpe/apa/recommend"
        payload = profile.model_dump()
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, json=payload)
        except httpx.RequestError as exc:
            logger.warning("RPE recommend network error: %s", exc)
            raise RpeClientError(f"network error: {exc}") from exc

        if resp.status_code != 200:
            raise RpeClientError(
                f"recommend returned {resp.status_code}: {resp.text[:200]}",
                status_code=resp.status_code,
            )
        return [ScenarioSummary.model_validate(item) for item in resp.json()]

    async def get_scenario_detail(self, scenario_id: str) -> ScenarioDetail:
        url = (
            f"{self._base_url}/api/v1/rpe/scenarios/detail/{scenario_id}"
        )
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url)
        except httpx.RequestError as exc:
            raise RpeClientError(f"network error: {exc}") from exc

        if resp.status_code != 200:
            raise RpeClientError(
                f"detail returned {resp.status_code}: {resp.text[:200]}",
                status_code=resp.status_code,
            )
        return ScenarioDetail.model_validate(resp.json())


def get_rpe_client() -> RpeClient:
    """FastAPI dependency."""
    return RpeClient()
