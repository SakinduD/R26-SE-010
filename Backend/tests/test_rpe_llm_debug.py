"""
Unit tests for the RPE V2 LLM Payload Inspector (Backend/app/services/
rpe_llm_debug.py) — DEV-only observability of the exact per-turn NPC LLM
payload. See Backend/docs/INTEGRATION_RPE_LLM_PAYLOAD_INSPECTOR.md for the
full report this was built against.

Covers: measurement primitives, the request/response capture round trip,
turn-to-turn component diffing, per-field conversation-state diffing,
output grouping, provider aggregation, the public_view() safety strip, and
the DEV-only gate on both the module function and the two new router
endpoints. No real LLM calls — this module never makes one itself, it only
measures values already in scope at the real call sites (tested separately,
implicitly, by test_rpe_gemini_provider.py's existing OpenAI/Gemini mocks
continuing to pass unchanged with the new optional debug_ctx param).
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.services import rpe_llm_debug as dbg


@pytest.fixture(autouse=True)
def clear_debug_store():
    """Module-level in-memory store — reset between tests so one test's
    captures never leak into another's assertions."""
    dbg._captures.clear()
    dbg._session_order.clear()
    dbg._latest = None
    yield
    dbg._captures.clear()
    dbg._session_order.clear()
    dbg._latest = None


# ── measurement primitives ───────────────────────────────────────────────

def test_measure_empty_string():
    m = dbg.measure("")
    assert m == {"chars": 0, "estimated_tokens": 0, "hash": dbg._sha("")}


def test_measure_none_treated_as_empty():
    assert dbg.measure(None) == dbg.measure("")


def test_estimate_tokens_is_chars_over_four():
    assert dbg.estimate_tokens("a" * 400) == 100


def test_measure_hash_is_stable_and_content_sensitive():
    a = dbg.measure("hello world")
    b = dbg.measure("hello world")
    c = dbg.measure("hello there")
    assert a["hash"] == b["hash"]
    assert a["hash"] != c["hash"]


# ── start_capture / finish_capture round trip ────────────────────────────

def _start(session_id="s1", turn=1, prior_state=None, user_message="hi", system_prompt="SYS BASE"):
    return dbg.start_capture(
        session_id=session_id, turn=turn, provider="openai", model="gpt-5-mini",
        system_prompt=system_prompt, state_block_text="",
        prior_conversation_state=prior_state,
        history_messages=[{"role": "assistant", "content": "opening line"}],
        user_message=user_message,
        schema_text='{"type":"object"}', schema_is_exact=True,
    )


def test_start_capture_measures_every_component():
    record = _start()
    component_keys = ("system", "state", "history", "user", "schema")
    for key in component_keys:
        assert record["components"][key]["chars"] >= 0
    assert record["totals"]["chars"] == sum(record["components"][k]["chars"] for k in component_keys)


def test_first_turn_diff_is_baseline():
    record = _start(turn=1)
    assert all(v == "BASELINE" for v in record["diff_vs_previous"].values())


def test_finish_capture_stores_and_get_latest_returns_public_view_safe_fields():
    record = _start(turn=1)
    dbg.finish_capture(
        record, success=True, error=None,
        raw_response_data={"dialogue": "hi there", "emotion": "neutral"},
        actual_input_tokens=42, actual_output_tokens=7,
        request_start=record["timing"]["request_start"],
        response_complete=record["timing"]["request_start"] + 1.0,
        parse_complete=record["timing"]["request_start"] + 1.01,
    )
    latest = dbg.get_latest()
    assert latest is not None
    assert latest["output"]["success"] is True
    assert latest["totals"]["actual_input_tokens"] == 42
    assert latest["output"]["actual_output_tokens"] == 7
    assert round(latest["timing"]["total_llm_latency_ms"]) in range(990, 1030)

    public = dbg.public_view(latest)
    assert "_raw_prior_state" not in public


def test_second_turn_unchanged_when_nothing_changed():
    r1 = _start(session_id="s2", turn=1, system_prompt="SAME SYS", user_message="msg1")
    dbg.finish_capture(r1, success=True, error=None, raw_response_data={"dialogue": "a"},
                        actual_input_tokens=None, actual_output_tokens=None,
                        request_start=r1["timing"]["request_start"],
                        response_complete=r1["timing"]["request_start"],
                        parse_complete=r1["timing"]["request_start"])

    r2 = _start(session_id="s2", turn=2, system_prompt="SAME SYS", user_message="msg1")
    assert r2["diff_vs_previous"]["system"] == "UNCHANGED"
    assert r2["diff_vs_previous"]["user"] == "UNCHANGED"


def test_second_turn_changed_when_user_message_differs():
    r1 = _start(session_id="s3", turn=1, user_message="first message")
    dbg.finish_capture(r1, success=True, error=None, raw_response_data={"dialogue": "a"},
                        actual_input_tokens=None, actual_output_tokens=None,
                        request_start=r1["timing"]["request_start"],
                        response_complete=r1["timing"]["request_start"],
                        parse_complete=r1["timing"]["request_start"])

    r2 = _start(session_id="s3", turn=2, user_message="a totally different message")
    assert r2["diff_vs_previous"]["user"] == "CHANGED"


# ── state field diffing (section 11) ─────────────────────────────────────

def test_state_field_diff_detects_added_and_removed_items():
    prior_turn1 = {"unresolved_items": ["a", "b"], "npc_objective": "get the numbers"}
    r1 = _start(session_id="s4", turn=1, prior_state=prior_turn1)
    dbg.finish_capture(r1, success=True, error=None, raw_response_data={"dialogue": "x"},
                        actual_input_tokens=None, actual_output_tokens=None,
                        request_start=r1["timing"]["request_start"],
                        response_complete=r1["timing"]["request_start"],
                        parse_complete=r1["timing"]["request_start"])

    prior_turn2 = {"unresolved_items": ["b", "c"], "npc_objective": "get the numbers"}
    r2 = _start(session_id="s4", turn=2, prior_state=prior_turn2)

    unresolved = r2["state_fields"]["unresolvedItems"]
    assert unresolved["added"] == ["c"]
    assert unresolved["removed"] == ["a"]
    assert unresolved["changed"] is True

    objective = r2["state_fields"]["npcObjective"]
    assert objective["changed"] is False


def test_state_field_diff_none_state_is_zero_chars_not_error():
    r1 = _start(session_id="s5", turn=1, prior_state=None)
    for field in dbg._STATE_FIELDS:
        assert r1["state_fields"][field]["chars"] == 0


# ── output grouping ───────────────────────────────────────────────────────

def test_output_groups_and_fields_computed_on_success():
    record = _start(session_id="s6", turn=1)
    raw = {
        "dialogue": "Fine.", "emotion": "neutral", "animation": "idle",
        "interactionType": "normal", "npcObjective": "obj", "conversationPhase": "opening",
        "unresolvedItems": [], "internalNote": "note", "scenarioProgress": "opening",
        "userBehavior": "unclear",
    }
    dbg.finish_capture(record, success=True, error=None, raw_response_data=raw,
                        actual_input_tokens=None, actual_output_tokens=None,
                        request_start=record["timing"]["request_start"],
                        response_complete=record["timing"]["request_start"],
                        parse_complete=record["timing"]["request_start"])
    latest = dbg.get_latest()
    assert set(latest["output"]["groups"].keys()) == {
        "dialogue", "emotion_animation", "interaction",
        "conversation_intelligence", "memory", "evaluation_debug",
    }
    assert latest["output"]["groups"]["dialogue"] > 0


def test_failed_call_never_computes_output_groups():
    record = _start(session_id="s7", turn=1)
    dbg.finish_capture(record, success=False, error="boom", raw_response_data=None,
                        actual_input_tokens=None, actual_output_tokens=None,
                        request_start=record["timing"]["request_start"],
                        response_complete=record["timing"]["request_start"],
                        parse_complete=record["timing"]["request_start"])
    latest = dbg.get_latest()
    assert latest["output"]["success"] is False
    assert latest["output"]["groups"] is None
    assert latest["output"]["error"] == "boom"


# ── provider comparison ────────────────────────────────────────────────

def test_provider_comparison_aggregates_across_sessions():
    for i, provider in enumerate(["openai", "openai", "gemini"]):
        r = dbg.start_capture(
            session_id=f"prov-{i}", turn=1, provider=provider, model="m",
            system_prompt="sys", state_block_text="", prior_conversation_state=None,
            history_messages=[], user_message="hi", schema_text="{}", schema_is_exact=True,
        )
        dbg.finish_capture(r, success=True, error=None, raw_response_data={"dialogue": "x"},
                            actual_input_tokens=None, actual_output_tokens=None,
                            request_start=r["timing"]["request_start"],
                            response_complete=r["timing"]["request_start"] + 0.5,
                            parse_complete=r["timing"]["request_start"] + 0.5)

    comparison = {p["provider"]: p for p in dbg.get_provider_comparison()}
    assert comparison["openai"]["turn_count"] == 2
    assert comparison["gemini"]["turn_count"] == 1


# ── DEV-only gate ─────────────────────────────────────────────────────────

def test_debug_enabled_reflects_settings(monkeypatch):
    fake_settings = MagicMock(debug=True)
    monkeypatch.setattr(dbg, "get_settings", lambda: fake_settings)
    assert dbg.debug_enabled() is True

    fake_settings.debug = False
    assert dbg.debug_enabled() is False


# ── router endpoints ──────────────────────────────────────────────────────

def test_reasoning_effort_defaults_to_minimal_unless_settings_override(monkeypatch):
    """rpe_openai_reasoning_effort defaults to 'minimal' — the exact
    pre-existing hardcoded value — so a deployment that never sets the new
    env var sends byte-identical payloads to before this experiment."""
    from app.services import rpe_llm_service

    captured_payload = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"output_text": '{"dialogue":"hi","emotion":"neutral","animation":"idle","internalNote":"","scenarioProgress":"opening","userBehavior":"unclear","interactionType":"normal","responseOptions":null,"contentPrompt":null,"contentType":null,"npcObjective":null,"conversationPhase":null,"unresolvedItems":[],"commitments":[],"agreedDeadlines":[],"requestedItems":[],"userConstraints":[],"recentTopics":[]}'}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            captured_payload.update(json)
            return FakeResponse()

    import httpx as httpx_module
    monkeypatch.setattr(httpx_module, "Client", lambda timeout=None: FakeClient())
    fake_settings = MagicMock(openai_api_key="x", rpe_openai_model="gpt-5-mini", openai_base_url="https://api.openai.com/v1")
    del fake_settings.rpe_openai_reasoning_effort  # simulate an old Settings object without the new field
    monkeypatch.setattr(rpe_llm_service, "get_settings", lambda: fake_settings)

    rpe_llm_service._get_npc_response_openai([{"role": "user", "content": "hi"}], "SYS")
    assert captured_payload["reasoning"]["effort"] == "minimal"


def test_llm_debug_endpoints_404_when_debug_mode_off(monkeypatch):
    from app.main import app as fastapi_app
    monkeypatch.setattr(dbg, "debug_enabled", lambda: False)
    client = TestClient(fastapi_app)

    assert client.get("/api/v1/rpe/llm/debug/latest").status_code == 404
    assert client.get("/api/v1/rpe/llm/debug/session/whatever").status_code == 404
    assert client.get("/api/v1/rpe/llm/debug/sessions").status_code == 404
    assert client.get("/api/v1/rpe/llm/debug/providers").status_code == 404


# ── cache telemetry (latency + prompt-cache experiment) ──────────────────

def test_extract_cache_info_none_usage_reports_unknown():
    info = dbg._extract_cache_info(None)
    assert info["status"] == "UNKNOWN"
    assert info["cached_tokens"] is None


def test_extract_cache_info_hit():
    usage = {"input_tokens_details": {"cached_tokens": 3200, "cache_write_tokens": 0},
              "output_tokens_details": {"reasoning_tokens": 0}}
    info = dbg._extract_cache_info(usage)
    assert info["status"] == "HIT"
    assert info["cached_tokens"] == 3200
    assert info["reasoning_tokens"] == 0
    assert info["raw"] == usage


def test_extract_cache_info_miss():
    usage = {"input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0}}
    info = dbg._extract_cache_info(usage)
    assert info["status"] == "MISS"


def test_extract_cache_info_missing_details_is_unknown_not_miss():
    """A provider (e.g. Gemini) that has no cache field at all must report
    UNKNOWN, never a false MISS — section 12 of the spec this was built
    against: never claim cache telemetry the provider didn't actually give."""
    usage = {"prompt_token_count": 100, "candidates_token_count": 20}
    info = dbg._extract_cache_info(usage)
    assert info["status"] == "UNKNOWN"
    assert info["cached_tokens"] is None


def test_finish_capture_populates_cache_and_reasoning_effort():
    record = _start(session_id="cache-test", turn=1)
    record["reasoning_effort"] = "minimal"
    dbg.finish_capture(
        record, success=True, error=None, raw_response_data={"dialogue": "hi"},
        actual_input_tokens=3289, actual_output_tokens=300,
        request_start=record["timing"]["request_start"],
        response_complete=record["timing"]["request_start"] + 1,
        parse_complete=record["timing"]["request_start"] + 1,
        usage_raw={"input_tokens_details": {"cached_tokens": 3200}},
    )
    latest = dbg.get_latest()
    assert latest["cache"]["status"] == "HIT"
    assert latest["cache"]["cached_tokens"] == 3200
    assert latest["reasoning_effort"] == "minimal"


def test_call_openai_json_threads_prompt_version_from_debug_ctx(monkeypatch):
    """Regression test: start_capture()/finish_capture() gained a
    prompt_version param, but the actual call sites in rpe_llm_service.py
    (_call_openai_json, _get_npc_response_gemini) forgot to pass
    debug_ctx['prompt_version'] through to it — every capture silently
    defaulted to 'current' even when the real prompt sent was compact.
    Caught via real captured data (system-component char count didn't
    match the label), not by inspection alone — this test pins the fix."""
    import httpx as httpx_module
    from app.services import rpe_llm_service

    monkeypatch.setattr(dbg, "debug_enabled", lambda: True)

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"output_text": '{"dialogue":"hi","emotion":"neutral","animation":"idle","internalNote":"","scenarioProgress":"opening","userBehavior":"unclear","interactionType":"normal","responseOptions":null,"contentPrompt":null,"contentType":null,"npcObjective":null,"conversationPhase":null,"unresolvedItems":[],"commitments":[],"agreedDeadlines":[],"requestedItems":[],"userConstraints":[],"recentTopics":[]}'}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, *a, **k):
            return FakeResponse()

    monkeypatch.setattr(httpx_module, "Client", lambda timeout=None: FakeClient())
    fake_settings = MagicMock(openai_api_key="x", rpe_openai_model="gpt-5-mini", openai_base_url="https://api.openai.com/v1")
    monkeypatch.setattr(rpe_llm_service, "get_settings", lambda: fake_settings)

    debug_ctx = {
        "session_id": "thread-test", "turn": 1, "prompt_version": "compact",
        "state_block_text": "", "prior_conversation_state": None,
        "history_messages": [], "user_message": "hi",
    }
    rpe_llm_service._get_npc_response_openai(
        [{"role": "user", "content": "hi"}], "SYS PROMPT", debug_ctx=debug_ctx,
    )

    latest = dbg.get_latest()
    assert latest["prompt_version"] == "compact"


def test_llm_debug_latest_returns_capture_when_debug_mode_on(monkeypatch):
    from app.main import app as fastapi_app
    monkeypatch.setattr(dbg, "debug_enabled", lambda: True)

    record = _start(session_id="router-test", turn=1)
    dbg.finish_capture(record, success=True, error=None, raw_response_data={"dialogue": "hi"},
                        actual_input_tokens=None, actual_output_tokens=None,
                        request_start=record["timing"]["request_start"],
                        response_complete=record["timing"]["request_start"],
                        parse_complete=record["timing"]["request_start"])

    client = TestClient(fastapi_app)
    resp = client.get("/api/v1/rpe/llm/debug/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["session_id"] == "router-test"
    assert "_raw_prior_state" not in body
