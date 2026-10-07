"""
Unit tests for the RPE Gemini NPC-dialogue provider (the A/B experiment —
see Backend/docs/ for the full write-up). All network calls are mocked;
no GEMINI_API_KEY is required to run this file.

Covers: client init / missing key, a successful structured response, an
invalid one, a timeout, fallback to OpenAI, model configuration, and the
GeminiNPCResponse -> NPCResponse schema mapping (the sentinel/empty-default
workarounds for Gemini's real structured-output limitations, confirmed
against the live API during this experiment — see rpe_llm_service.py's
GeminiNPCResponse docstring).
"""
import json
from unittest.mock import MagicMock

import pytest

from app.services import rpe_llm_service
from app.services.rpe_llm_service import (
    GeminiNPCResponse,
    NPCResponse,
    ResponseOption,
    _gemini_to_npc_response,
    _get_gemini_client,
    _get_npc_response_gemini,
    _messages_to_gemini_contents,
    get_npc_response,
)


@pytest.fixture(autouse=True)
def clear_gemini_client_cache():
    """_get_gemini_client is @lru_cache'd — clear between tests so each
    test's own settings/mock state doesn't leak into the next."""
    _get_gemini_client.cache_clear()
    yield
    _get_gemini_client.cache_clear()


def _valid_gemini_json() -> str:
    return json.dumps({
        "dialogue": "Then get me the exact numbers, right now.",
        "emotion": "frustrated",
        "animation": "pointing",
        "internalNote": "Pushing for concrete data.",
        "scenarioProgress": "building",
        "userBehavior": "deflection",
        "interactionType": "normal",
        "responseOptions": [],
        "contentPrompt": "",
        "contentType": "unspecified",
        "npcObjective": "Get the missing figures.",
        "conversationPhase": "clarification",
        "unresolvedItems": ["missing budget figures"],
        "commitments": [],
        "agreedDeadlines": [],
        "requestedItems": ["budget figures"],
        "userConstraints": [],
        "recentTopics": ["budget"],
    })


# ── Client initialization / missing key ─────────────────────────────────

def test_get_gemini_client_returns_none_without_api_key(monkeypatch):
    fake_settings = MagicMock(gemini_api_key="")
    monkeypatch.setattr(rpe_llm_service, "get_settings", lambda: fake_settings)
    assert _get_gemini_client() is None


def test_get_npc_response_gemini_returns_none_without_client(monkeypatch):
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: None)
    result = _get_npc_response_gemini([{"role": "user", "content": "hi"}], "system prompt")
    assert result is None


# ── Successful structured response ──────────────────────────────────────

def test_get_npc_response_gemini_success(monkeypatch):
    fake_response = MagicMock(text=_valid_gemini_json())
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = fake_response
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: fake_client)

    result = _get_npc_response_gemini(
        [{"role": "assistant", "content": "opening line"}, {"role": "user", "content": "hi"}],
        "system prompt",
    )
    assert isinstance(result, NPCResponse)
    assert result.dialogue == "Then get me the exact numbers, right now."
    assert result.emotion == "frustrated"
    assert result.npcObjective == "Get the missing figures."
    assert result.unresolvedItems == ["missing budget figures"]
    # Sentinel/empty-default mapping back to the real NPCResponse contract:
    assert result.contentType is None  # was "unspecified"
    assert result.contentPrompt is None  # was ""
    assert result.responseOptions is None  # interactionType != deliverable_choice


def test_get_npc_response_gemini_passes_configured_model(monkeypatch):
    fake_response = MagicMock(text=_valid_gemini_json())
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = fake_response
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: fake_client)
    fake_settings = MagicMock(rpe_gemini_model="gemini-3.5-flash-lite")
    monkeypatch.setattr(rpe_llm_service, "get_settings", lambda: fake_settings)

    _get_npc_response_gemini([{"role": "user", "content": "hi"}], "system prompt")

    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == "gemini-3.5-flash-lite"


# ── Invalid structured response ─────────────────────────────────────────

def test_get_npc_response_gemini_invalid_json_returns_none(monkeypatch):
    fake_response = MagicMock(text="not valid json{{{")
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = fake_response
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: fake_client)

    result = _get_npc_response_gemini([{"role": "user", "content": "hi"}], "system prompt")
    assert result is None


def test_get_npc_response_gemini_schema_mismatch_returns_none(monkeypatch):
    # Valid JSON, but missing every required field.
    fake_response = MagicMock(text=json.dumps({"unexpected": "shape"}))
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = fake_response
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: fake_client)

    result = _get_npc_response_gemini([{"role": "user", "content": "hi"}], "system prompt")
    assert result is None


def test_get_npc_response_gemini_empty_response_returns_none(monkeypatch):
    fake_response = MagicMock(text="")
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = fake_response
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: fake_client)

    result = _get_npc_response_gemini([{"role": "user", "content": "hi"}], "system prompt")
    assert result is None


# ── Timeout ──────────────────────────────────────────────────────────────

def test_get_npc_response_gemini_timeout_returns_none(monkeypatch):
    import time as time_module

    def slow_generate_content(*args, **kwargs):
        time_module.sleep(0.5)
        return MagicMock(text=_valid_gemini_json())

    fake_client = MagicMock()
    fake_client.models.generate_content.side_effect = slow_generate_content
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: fake_client)
    monkeypatch.setattr(rpe_llm_service, "GEMINI_TIMEOUT_S", 0.05)  # force a timeout fast

    result = _get_npc_response_gemini([{"role": "user", "content": "hi"}], "system prompt")
    assert result is None


def test_get_npc_response_gemini_api_error_returns_none(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.side_effect = RuntimeError("500 internal error")
    monkeypatch.setattr(rpe_llm_service, "_get_gemini_client", lambda: fake_client)

    result = _get_npc_response_gemini([{"role": "user", "content": "hi"}], "system prompt")
    assert result is None


# ── Fallback to OpenAI (get_npc_response dispatcher) ────────────────────

@pytest.mark.asyncio
async def test_get_npc_response_falls_back_to_openai_when_gemini_fails(monkeypatch):
    fake_settings = MagicMock(rpe_llm_provider="gemini", USE_OPENAI=True)
    monkeypatch.setattr(rpe_llm_service, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(rpe_llm_service, "_get_npc_response_gemini", lambda *a, **k: None)

    openai_fallback = rpe_llm_service._FALLBACK_RESPONSE.model_copy(update={"dialogue": "OpenAI answered instead."})
    monkeypatch.setattr(rpe_llm_service, "_get_npc_response_openai", lambda *a, **k: openai_fallback)

    result = await get_npc_response([{"role": "user", "content": "hi"}], "system prompt", {})
    assert result.dialogue == "OpenAI answered instead."


@pytest.mark.asyncio
async def test_get_npc_response_uses_gemini_when_configured_and_healthy(monkeypatch):
    fake_settings = MagicMock(rpe_llm_provider="gemini", USE_OPENAI=True)
    monkeypatch.setattr(rpe_llm_service, "get_settings", lambda: fake_settings)

    gemini_success = rpe_llm_service._FALLBACK_RESPONSE.model_copy(update={"dialogue": "Gemini answered."})
    monkeypatch.setattr(rpe_llm_service, "_get_npc_response_gemini", lambda *a, **k: gemini_success)
    monkeypatch.setattr(rpe_llm_service, "_get_npc_response_openai", lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not be called")))

    result = await get_npc_response([{"role": "user", "content": "hi"}], "system prompt", {})
    assert result.dialogue == "Gemini answered."


@pytest.mark.asyncio
async def test_get_npc_response_openai_default_never_calls_gemini_unless_configured(monkeypatch):
    """The exact pre-existing behavior — rpe_llm_provider='openai' and no
    fallback configured — must never touch Gemini at all."""
    fake_settings = MagicMock(rpe_llm_provider="openai", rpe_llm_fallback_provider="", USE_OPENAI=True)
    monkeypatch.setattr(rpe_llm_service, "get_settings", lambda: fake_settings)

    openai_success = rpe_llm_service._FALLBACK_RESPONSE.model_copy(update={"dialogue": "OpenAI, as always."})
    monkeypatch.setattr(rpe_llm_service, "_get_npc_response_openai", lambda *a, **k: openai_success)
    monkeypatch.setattr(rpe_llm_service, "_get_npc_response_gemini", lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not be called")))

    result = await get_npc_response([{"role": "user", "content": "hi"}], "system prompt", {})
    assert result.dialogue == "OpenAI, as always."


# ── Message format conversion ────────────────────────────────────────────

def test_messages_to_gemini_contents_maps_assistant_to_model_role():
    messages = [
        {"role": "assistant", "content": "opening line"},
        {"role": "user", "content": "user reply"},
    ]
    contents = _messages_to_gemini_contents(messages)
    assert contents == [
        {"role": "model", "parts": [{"text": "opening line"}]},
        {"role": "user", "parts": [{"text": "user reply"}]},
    ]


# ── Schema mapping (GeminiNPCResponse -> NPCResponse) ───────────────────

def test_gemini_to_npc_response_maps_sentinels_to_none():
    g = GeminiNPCResponse(
        dialogue="Fine.", emotion="neutral", animation="idle", internalNote="",
        scenarioProgress="building", userBehavior="unclear", interactionType="normal",
        responseOptions=[], contentPrompt="", contentType="unspecified",
        npcObjective="", conversationPhase="unspecified",
        unresolvedItems=[], commitments=[], agreedDeadlines=[],
        requestedItems=[], userConstraints=[], recentTopics=[],
    )
    result = _gemini_to_npc_response(g)
    assert result.contentType is None
    assert result.contentPrompt is None
    assert result.npcObjective is None
    assert result.conversationPhase is None
    assert result.responseOptions is None


def test_gemini_to_npc_response_preserves_real_deliverable_choice_options():
    g = GeminiNPCResponse(
        dialogue="Send me a summary.", emotion="neutral", animation="idle", internalNote="",
        scenarioProgress="building", userBehavior="unclear", interactionType="deliverable_choice",
        responseOptions=[ResponseOption(label="Clean summary", text="I'll send a one-pager.", quality="strong")],
        contentPrompt="", contentType="unspecified",
        npcObjective="Get a commitment.", conversationPhase="commitment",
        unresolvedItems=[], commitments=[], agreedDeadlines=[],
        requestedItems=[], userConstraints=[], recentTopics=[],
    )
    result = _gemini_to_npc_response(g)
    assert result.responseOptions is not None
    assert len(result.responseOptions) == 1
    assert result.responseOptions[0].label == "Clean summary"
    assert result.npcObjective == "Get a commitment."
    assert result.conversationPhase == "commitment"
