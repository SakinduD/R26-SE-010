"""
Unit tests for the deterministic, non-LLM parts of RPE's conversation
intelligence (structured NPC memory — objective/phase/unresolved items/
commitments/deadlines/requested items/constraints/topics).

What this file does NOT test, and why: whether the model actually follows
the prompt's evidentiary rules (records a commitment only when the user
unconditionally committed, marks a deadline "agreed" only once the NPC
explicitly accepts it, etc.) is real LLM behavior — verifying it requires
an actual model call, which is non-deterministic and not something to fake
with a mocked "LLM" that just returns whatever the test wants to see (that
would test the mock, not the feature). That behavior was instead verified
against the real OpenAI-backed endpoint in a live multi-turn session — see
the task's final summary for the actual transcript/state evolution
observed. This file covers what IS deterministic: schema validation and
fallback safety (TEST 11 from the spec), and the array-hygiene helpers
(size cap, "none"/"n/a" filtering) applied to whatever the model returns.
"""
from app.services.rpe_llm_service import (
    NPCResponse,
    _FALLBACK_RESPONSE,
    _drop_empty_markers,
    MAX_LIST_ITEMS,
    MAX_RECENT_TOPICS,
)


def _valid_payload(**overrides) -> dict:
    payload = {
        "dialogue": "Fine. Get me the numbers by five.",
        "emotion": "neutral",
        "animation": "idle",
        "internalNote": "",
        "scenarioProgress": "building",
        "userBehavior": "assertive_statement",
        "interactionType": "normal",
        "responseOptions": None,
        "contentPrompt": None,
        "contentType": None,
        "npcObjective": "Obtain the missing budget figures.",
        "conversationPhase": "clarification",
        "unresolvedItems": ["missing budget figures"],
        "commitments": [],
        "agreedDeadlines": [],
        "requestedItems": ["exact budget figures"],
        "userConstraints": [],
        "recentTopics": ["budget"],
    }
    payload.update(overrides)
    return payload


# ── TEST 11 — invalid structured output falls back safely ──────────────────

def test_valid_payload_parses_with_conversation_intelligence_fields():
    response = NPCResponse.model_validate(_valid_payload())
    assert response.npcObjective == "Obtain the missing budget figures."
    assert response.conversationPhase == "clarification"
    assert response.unresolvedItems == ["missing budget figures"]


def test_invalid_conversation_phase_raises_for_caller_to_catch():
    # _get_npc_response_openai/_groq catch ValidationError and return
    # _FALLBACK_RESPONSE — this test exercises the validation half of that
    # contract directly (model_validate is what actually raises).
    import pytest
    with pytest.raises(Exception):
        NPCResponse.model_validate(_valid_payload(conversationPhase="not_a_real_phase"))


def test_missing_conversation_intelligence_field_raises():
    payload = _valid_payload()
    del payload["unresolvedItems"]
    import pytest
    with pytest.raises(Exception):
        NPCResponse.model_validate(payload)


def test_fallback_response_has_safe_empty_conversation_state():
    """The session must keep working on a malformed LLM response — see
    rpe_llm_service._get_npc_response_openai/_groq's except ValidationError
    branches, both of which return this exact object."""
    assert _FALLBACK_RESPONSE.npcObjective is None
    assert _FALLBACK_RESPONSE.conversationPhase is None
    assert _FALLBACK_RESPONSE.unresolvedItems == []
    assert _FALLBACK_RESPONSE.commitments == []
    assert _FALLBACK_RESPONSE.agreedDeadlines == []
    assert _FALLBACK_RESPONSE.requestedItems == []
    assert _FALLBACK_RESPONSE.userConstraints == []
    assert _FALLBACK_RESPONSE.recentTopics == []
    # And the fields this task explicitly must not touch stay intact too.
    assert _FALLBACK_RESPONSE.dialogue
    assert _FALLBACK_RESPONSE.emotion == "neutral"


# ── Array hygiene: _drop_empty_markers + the size caps applied in
#    get_npc_response() (see MAX_LIST_ITEMS/MAX_RECENT_TOPICS) ─────────────

def test_drop_empty_markers_strips_none_and_na_placeholders():
    assert _drop_empty_markers(["none"]) == []
    assert _drop_empty_markers(["N/A"]) == []
    assert _drop_empty_markers(["  none  "]) == []
    assert _drop_empty_markers(["nothing", "-", ""]) == []


def test_drop_empty_markers_keeps_real_items():
    real = ["missing budget figures", "final numbers"]
    assert _drop_empty_markers(real) == real


def test_drop_empty_markers_mixed_list_keeps_only_real_items():
    assert _drop_empty_markers(["budget figures", "none"]) == ["budget figures"]


def test_max_list_items_caps_are_positive_and_small():
    # Guards against a future accidental edit turning these into something
    # that no longer actually bounds accumulation (spec section 7/12).
    assert 0 < MAX_LIST_ITEMS <= 10
    assert 0 < MAX_RECENT_TOPICS <= 5


# ── Backward compatibility (spec TEST 12 / section 27) ──────────────────────

def test_existing_fields_still_required_and_unaffected():
    """Conversation-intelligence fields are additive — every field that
    existed before this feature must still validate exactly as before."""
    payload = _valid_payload()
    response = NPCResponse.model_validate(payload)
    assert response.dialogue == payload["dialogue"]
    assert response.emotion == payload["emotion"]
    assert response.animation == payload["animation"]
    assert response.userBehavior == payload["userBehavior"]
    assert response.interactionType == payload["interactionType"]
