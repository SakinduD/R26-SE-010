"""
Gemini LLM client wrapper using the new google-genai SDK.

NOTE on SDK choice: this project also has the legacy google-generativeai SDK
in requirements (used by Backend/app/services/llm_service.py for MCA chat).
APM uses ONLY the new google-genai SDK to avoid global state collisions
(legacy SDK uses genai.configure() process-wide; new SDK uses an explicit
Client). Don't mix the two in the same module.
"""
from __future__ import annotations

import asyncio
import json
import logging
from functools import lru_cache
from typing import Any, Literal

from app.config import get_settings

logger = logging.getLogger(__name__)

LLMErrorReason = Literal["timeout", "invalid_json", "api_error", "safety_block"]


class LLMError(Exception):
    """Typed LLM error for the caller to branch on .reason."""

    def __init__(self, reason: LLMErrorReason, message: str = "") -> None:
        super().__init__(message or reason)
        self.reason: LLMErrorReason = reason


class GeminiClient:
    """
    Async-friendly Gemini client. No global state.

    Use generate_json() for response_mime_type='application/json' generation
    with timeout + safety handling. Never logs the API key. Full prompts
    logged at DEBUG only.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.5-flash",
    ) -> None:
        self._api_key = api_key
        self._model_name = model
        self._client = None
        self._types = None

    def _ensure_client(self) -> None:
        if self._client is not None:
            return
        if not self._api_key:
            raise LLMError(
                "api_error",
                "GEMINI_API_KEY is not configured",
            )
        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:  # pragma: no cover (env-dependent)
            raise LLMError(
                "api_error",
                "google-genai SDK not installed. pip install google-genai",
            ) from exc
        self._client = genai.Client(api_key=self._api_key)
        self._types = types

    async def generate_json(
        self,
        prompt: str,
        *,
        timeout_s: float = 8.0,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """Generate JSON via Gemini. Raises LLMError on any failure path."""
        self._ensure_client()
        logger.debug("Gemini prompt: %s", prompt)

        config = self._types.GenerateContentConfig(  # type: ignore[union-attr]
            response_mime_type="application/json",
            temperature=temperature,
        )

        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    self._client.models.generate_content,  # type: ignore[union-attr]
                    model=self._model_name,
                    contents=prompt,
                    config=config,
                ),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError as exc:
            logger.warning("Gemini generation timed out after %.1fs", timeout_s)
            raise LLMError("timeout", f"timed out after {timeout_s}s") from exc
        except Exception as exc:
            msg = str(exc).lower()
            if "safety" in msg or "blocked" in msg or "block_reason" in msg:
                raise LLMError("safety_block", str(exc)) from exc
            logger.warning("Gemini API error: %s", exc)
            raise LLMError("api_error", str(exc)) from exc

        text = (getattr(response, "text", None) or "").strip()
        if not text:
            raise LLMError("invalid_json", "empty response")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            logger.warning("Gemini returned invalid JSON: %s", text[:200])
            raise LLMError("invalid_json", str(exc)) from exc
        if not isinstance(data, dict):
            raise LLMError(
                "invalid_json",
                f"expected JSON object, got {type(data).__name__}",
            )
        return data


@lru_cache(maxsize=1)
def get_llm_client() -> GeminiClient:
    """FastAPI dependency. Cached singleton per process."""
    settings = get_settings()
    model = getattr(settings, "gemini_model", "gemini-2.5-flash")
    return GeminiClient(api_key=settings.gemini_api_key, model=model)
