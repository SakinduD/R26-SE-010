"""
RPE V2 — LLM PAYLOAD INSPECTOR (observability only — see
Backend/docs/INTEGRATION_RPE_LLM_PAYLOAD_INSPECTOR.md for the full report).

Captures the REAL per-turn NPC-dialogue payload sent to OpenAI/Gemini —
measured immediately before the provider request and immediately after the
response — so the exact system/state/history/user/schema breakdown, turn-to-
turn diffs, and latency can be inspected without guessing from source code.

This module does NOT change the prompt, the schema, the model, the provider,
or any conversation/scoring behavior. It only watches and measures what
rpe_llm_service.py was already about to send.

DEV-only: every write is a no-op unless debug_enabled() (settings.debug —
the same DEBUG=True .env flag already gating this project's other dev-only
behavior) is true, and the FastAPI endpoints in router.py 404 outside that
gate too — so this adds zero surface area in production.

SAFETY (see section 16 of the spec this was built against): never stores
API keys/tokens/passwords, and never stores the raw text of anything that
could carry a real learner's own words — user message, conversation
history, and the conversation-intelligence state block are all measured as
length / estimated-tokens / hash ONLY, never persisted verbatim. The system
prompt template and JSON schema are 100% app-authored (no learner content),
so those two are the only components whose measurement additionally
includes their own text hash-comparable byte length; even those are never
returned or logged as raw text by this module, only counts and hashes.

Storage: in-memory only, process-lifetime, bounded (see _MAX_SESSIONS /
_MAX_TURNS_PER_SESSION) — same "DEV-only in-memory cache, no persistence"
pattern as TTSManager's dev cache. Restarting the backend clears it.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import deque
from typing import Any, Literal

from app.config import get_settings

Provider = Literal["openai", "gemini"]

# ── gating ──────────────────────────────────────────────────────────────

def debug_enabled() -> bool:
    return get_settings().debug


# ── measurement primitives ──────────────────────────────────────────────

def _sha(text: str) -> str:
    """Non-reversible fingerprint — used to spot identical blocks across
    turns without ever storing or comparing raw text (section 7)."""
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


def estimate_tokens(text: str) -> int:
    """
    chars / 4, rounded — the same order-of-magnitude heuristic OpenAI's own
    docs use for English text, and the method behind this project's earlier
    "~19,242 chars / ~4,810 estimated input tokens" figure (19242/4≈4810).
    This is explicitly an ESTIMATE, not a real tokenizer count — see
    actual_input_tokens/actual_output_tokens (from the provider's own
    `usage` field, when the provider exposes one) for the real number.
    """
    if not text:
        return 0
    return max(1, round(len(text) / 4))


def measure(text: str | None) -> dict:
    text = text or ""
    return {"chars": len(text), "estimated_tokens": estimate_tokens(text), "hash": _sha(text)}


# ── in-memory store ──────────────────────────────────────────────────────

_LOCK = threading.Lock()
_MAX_TURNS_PER_SESSION = 40
_MAX_SESSIONS = 60
_captures: dict[str, list[dict]] = {}
_session_order: deque[str] = deque()  # eviction order, oldest first
_latest: dict | None = None


def _store(record: dict) -> None:
    session_id = record["session_id"]
    with _LOCK:
        if session_id not in _captures:
            _captures[session_id] = []
            _session_order.append(session_id)
            if len(_session_order) > _MAX_SESSIONS:
                oldest = _session_order.popleft()
                _captures.pop(oldest, None)
        _captures[session_id].append(record)
        if len(_captures[session_id]) > _MAX_TURNS_PER_SESSION:
            _captures[session_id].pop(0)
        global _latest
        _latest = record


def get_latest() -> dict | None:
    with _LOCK:
        return _latest


def get_session_captures(session_id: str) -> list[dict]:
    with _LOCK:
        return list(_captures.get(session_id, []))


def list_sessions() -> list[str]:
    with _LOCK:
        return list(_session_order)


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    f, c = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def get_provider_comparison() -> list[dict]:
    """
    Aggregates every captured turn (across every session still in memory)
    by (provider, prompt_version) — section 20's "provider comparison" and
    the Prompt V2 pass's 4-configuration benchmark matrix (OpenAI/Gemini x
    current/compact) — computed on read, never stored as a separate
    structure. Latencies are only counted for successful calls — a timeout/
    failure's latency isn't a meaningful "how fast did this config answer".
    """
    with _LOCK:
        all_records = [r for turns in _captures.values() for r in turns]

    groups: dict[tuple[str, str], list[dict]] = {}
    for r in all_records:
        key = (r["provider"], r.get("prompt_version", "current"))
        groups.setdefault(key, []).append(r)

    out = []
    for (provider, prompt_version), records in groups.items():
        successes = [r for r in records if r["output"].get("success")]
        failures = [r for r in records if r["output"].get("success") is False]
        timeouts = [r for r in failures if "timeout" in (r["output"].get("error") or "").lower()]
        latencies = sorted(
            r["timing"]["total_llm_latency_ms"] for r in successes
            if r["timing"].get("total_llm_latency_ms") is not None
        )
        input_totals = [r["totals"]["chars"] for r in records]
        output_totals = [r["output"]["total_chars"] for r in successes if r["output"].get("total_chars") is not None]
        models = sorted({r["model"] for r in records})
        out.append({
            "provider": provider,
            "prompt_version": prompt_version,
            "models": models,
            "turn_count": len(records),
            "success_count": len(successes),
            "failure_count": len(failures),
            "timeout_count": len(timeouts),
            "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
            "min_latency_ms": round(latencies[0]) if latencies else None,
            "max_latency_ms": round(latencies[-1]) if latencies else None,
            "p50_latency_ms": round(_percentile(latencies, 0.50)) if latencies else None,
            "p95_latency_ms": round(_percentile(latencies, 0.95)) if latencies else None,
            "avg_input_chars": round(sum(input_totals) / len(input_totals)) if input_totals else None,
            "avg_output_chars": round(sum(output_totals) / len(output_totals)) if output_totals else None,
        })
    return out


# ── output field grouping (section 5/12) ─────────────────────────────────
# Spec names six logical output groups but doesn't map fields to them —
# this mapping is this module's own reasonable, documented choice.
_OUTPUT_GROUPS: dict[str, list[str]] = {
    "dialogue": ["dialogue"],
    "emotion_animation": ["emotion", "animation"],
    "interaction": ["interactionType", "responseOptions", "contentPrompt", "contentType"],
    "conversation_intelligence": ["npcObjective", "conversationPhase"],
    "memory": [
        "unresolvedItems", "commitments", "agreedDeadlines",
        "requestedItems", "userConstraints", "recentTopics",
    ],
    "evaluation_debug": ["internalNote", "scenarioProgress", "userBehavior"],
}

_STATE_FIELDS = [
    "npcObjective", "conversationPhase", "unresolvedItems", "commitments",
    "agreedDeadlines", "requestedItems", "userConstraints", "recentTopics",
]
_STATE_FIELD_TO_PRIOR_KEY = {
    "npcObjective": "npc_objective",
    "conversationPhase": "conversation_phase",
    "unresolvedItems": "unresolved_items",
    "commitments": "commitments",
    "agreedDeadlines": "agreed_deadlines",
    "requestedItems": "requested_items",
    "userConstraints": "user_constraints",
    "recentTopics": "recent_topics",
}


def _group_chars(data: dict, fields: list[str]) -> int:
    subset = {k: data.get(k) for k in fields if k in data}
    return len(json.dumps(subset, ensure_ascii=False))


def _field_chars(data: dict, field: str) -> int:
    if field not in data:
        return 0
    return len(json.dumps(data[field], ensure_ascii=False))


# ── request-side capture (called immediately BEFORE the provider request) ─

def start_capture(
    *,
    session_id: str,
    turn: int,
    provider: Provider,
    model: str,
    system_prompt: str,
    state_block_text: str,
    prior_conversation_state: dict | None,
    history_messages: list[dict],
    user_message: str,
    schema_text: str,
    schema_is_exact: bool,
    prompt_version: str = "current",
    reasoning_effort: str | None = None,
) -> dict:
    """
    Builds the full request-side measurement record from exactly the
    values rpe_llm_service.py was already about to send — nothing here
    re-derives an approximation from source, every number comes from the
    real strings/objects in scope at the real call site.

    system component = system_prompt with the state block text removed
    once (state_block_text is a verbatim substring of system_prompt, built
    by the same _format_conversation_state() call rpe_npc_service.py uses
    to build the real prompt) — this is how "system" and "state" end up as
    two separate measurements even though the provider receives them
    concatenated into one system-role string.
    """
    system_only = system_prompt.replace(state_block_text, "", 1) if state_block_text else system_prompt
    history_text = "\n".join(m.get("content", "") for m in history_messages)

    system_m = measure(system_only)
    state_m = measure(state_block_text)
    history_m = measure(history_text)
    user_m = measure(user_message)
    schema_m = measure(schema_text)
    schema_m["exact"] = schema_is_exact

    total_chars = system_m["chars"] + state_m["chars"] + history_m["chars"] + user_m["chars"] + schema_m["chars"]
    total_est_tokens = (
        system_m["estimated_tokens"] + state_m["estimated_tokens"] + history_m["estimated_tokens"]
        + user_m["estimated_tokens"] + schema_m["estimated_tokens"]
    )

    def pct(part: int) -> float:
        return round((part / total_chars) * 100, 1) if total_chars else 0.0

    previous = _last_capture_for_session(session_id)
    diff_vs_previous = {
        "system": _component_diff(previous, "system", system_m["hash"]),
        "state": _component_diff(previous, "state", state_m["hash"]),
        "history": _component_diff(previous, "history", history_m["hash"]),
        "user": _component_diff(previous, "user", user_m["hash"]),
        "schema": _component_diff(previous, "schema", schema_m["hash"]),
    }

    state_fields = _diff_state_fields(previous, prior_conversation_state)

    record: dict[str, Any] = {
        "session_id": session_id,
        "turn": turn,
        "provider": provider,
        "model": model,
        "prompt_version": prompt_version,
        "reasoning_effort": reasoning_effort,
        "timestamp": time.time(),
        "components": {
            "system": system_m,
            "state": state_m,
            "history": {**history_m, "message_count": len(history_messages), "turn_count": len(history_messages) // 2},
            "user": user_m,
            "schema": schema_m,
        },
        "totals": {
            "chars": total_chars,
            "estimated_input_tokens": total_est_tokens,
            "actual_input_tokens": None,  # filled in finish_capture() if the provider exposes it
        },
        "percentages": {
            "system": pct(system_m["chars"]), "state": pct(state_m["chars"]),
            "history": pct(history_m["chars"]), "user": pct(user_m["chars"]),
            "schema": pct(schema_m["chars"]),
        },
        "diff_vs_previous": diff_vs_previous,
        "state_fields": state_fields,
        "output": {"success": None, "error": None, "total_chars": None,
                   "estimated_output_tokens": None, "actual_output_tokens": None,
                   "groups": None, "fields": None},
        "cache": {"status": "UNKNOWN", "cached_tokens": None, "cache_write_tokens": None,
                  "reasoning_tokens": None, "raw": None},
        "timing": {
            "request_start": time.time(),
            "first_response_chunk_ms": None,  # see module docstring / report §14 — no streaming today
            "response_complete_ms": None,
            "parse_complete_ms": None,
            "request_to_first_response_ms": None,
            "request_to_complete_ms": None,
            "parse_time_ms": None,
            "total_llm_latency_ms": None,
            "server_processing_s": None,
        },
        # This turn's OWN input state (what it was actually told) — kept
        # only so the NEXT turn's start_capture can diff against it (see
        # _diff_state_fields). Stripped before any record leaves this
        # module — see public_view().
        "_raw_prior_state": prior_conversation_state,
    }
    return record


def _last_capture_for_session(session_id: str) -> dict | None:
    with _LOCK:
        turns = _captures.get(session_id)
        return turns[-1] if turns else None


def _component_diff(previous: dict | None, component: str, current_hash: str) -> str:
    if previous is None:
        return "BASELINE"
    prev_hash = previous["components"][component]["hash"]
    return "UNCHANGED" if prev_hash == current_hash else "CHANGED"


def _diff_state_fields(previous: dict | None, prior_state: dict | None) -> dict:
    """
    Section 11 — per-field breakdown of the conversation-intelligence state
    actually fed back into the prompt this turn (prior_conversation_state),
    compared against what was fed back on the PREVIOUS turn for this same
    session. Answers "is the model repeatedly receiving identical state?"
    field by field, not just as one opaque block.
    """
    prior_state = prior_state or {}
    prev_state = (previous or {}).get("_raw_prior_state") or {}

    out = {}
    for field in _STATE_FIELDS:
        key = _STATE_FIELD_TO_PRIOR_KEY[field]
        current_val = prior_state.get(key)
        prev_val = prev_state.get(key)
        chars = len(json.dumps(current_val, ensure_ascii=False)) if current_val is not None else 0
        if isinstance(current_val, list) or isinstance(prev_val, list):
            current_list = current_val or []
            prev_list = prev_val or []
            out[field] = {
                "chars": chars,
                "changed": current_list != prev_list,
                "added": [i for i in current_list if i not in prev_list],
                "removed": [i for i in prev_list if i not in current_list],
            }
        else:
            out[field] = {"chars": chars, "changed": current_val != prev_val}
    return out


def _extract_cache_info(usage_raw: dict | None) -> dict:
    """
    Real field names confirmed by inspecting a live OpenAI Responses API
    reply during this experiment (not assumed from docs):
      usage.input_tokens_details.cached_tokens
      usage.input_tokens_details.cache_write_tokens
      usage.output_tokens_details.reasoning_tokens
    Gemini's SDK (0.8.0) usage_metadata has no equivalent cache fields —
    callers pass usage_raw=None for Gemini, which reports UNKNOWN here
    rather than a false MISS (§12 of the spec this was built against: only
    report what the provider actually exposes).
    """
    if not usage_raw:
        return {
            "status": "UNKNOWN", "cached_tokens": None,
            "cache_write_tokens": None, "reasoning_tokens": None,
            "raw": None,
        }
    input_details = usage_raw.get("input_tokens_details") or {}
    output_details = usage_raw.get("output_tokens_details") or {}
    cached_tokens = input_details.get("cached_tokens")
    if cached_tokens is None:
        status = "UNKNOWN"
    elif cached_tokens > 0:
        status = "HIT"
    else:
        status = "MISS"
    return {
        "status": status,
        "cached_tokens": cached_tokens,
        "cache_write_tokens": input_details.get("cache_write_tokens"),
        "reasoning_tokens": output_details.get("reasoning_tokens"),
        # Full raw usage object — small, provider-authored, zero learner
        # content (just integers) — safe to keep for anyone who wants to
        # check a field this module didn't anticipate.
        "raw": usage_raw,
    }


# ── response-side capture (called immediately AFTER the provider responds) ─

def finish_capture(
    record: dict,
    *,
    success: bool,
    error: str | None,
    raw_response_data: dict | None,
    actual_input_tokens: int | None,
    actual_output_tokens: int | None,
    request_start: float,
    response_complete: float,
    parse_complete: float,
    usage_raw: dict | None = None,
    server_processing_s: int | None = None,
) -> None:
    """
    usage_raw: the provider's own usage object, passed through verbatim and
    unmodified where possible — cache_status/etc below are DERIVED from it,
    never assumed independent of it. None (the default) means the caller
    didn't capture a usage object; every cache field below then reports
    "UNKNOWN"/None rather than guessing.
    """
    record["output"]["success"] = success
    record["output"]["error"] = error
    record["totals"]["actual_input_tokens"] = actual_input_tokens
    record["cache"] = _extract_cache_info(usage_raw)

    if success and raw_response_data is not None:
        total_chars = len(json.dumps(raw_response_data, ensure_ascii=False))
        record["output"]["total_chars"] = total_chars
        record["output"]["estimated_output_tokens"] = estimate_tokens(json.dumps(raw_response_data, ensure_ascii=False))
        record["output"]["actual_output_tokens"] = actual_output_tokens
        record["output"]["groups"] = {
            name: _group_chars(raw_response_data, fields) for name, fields in _OUTPUT_GROUPS.items()
        }
        record["output"]["fields"] = {
            field: _field_chars(raw_response_data, field)
            for fields in _OUTPUT_GROUPS.values() for field in fields
        }

    record["timing"]["response_complete_ms"] = round((response_complete - request_start) * 1000)
    record["timing"]["parse_complete_ms"] = round((parse_complete - request_start) * 1000)
    record["timing"]["request_to_complete_ms"] = record["timing"]["response_complete_ms"]
    record["timing"]["parse_time_ms"] = round((parse_complete - response_complete) * 1000)
    record["timing"]["total_llm_latency_ms"] = record["timing"]["parse_complete_ms"]
    record["timing"]["server_processing_s"] = server_processing_s

    _store(record)


def public_view(record: dict) -> dict:
    """Strips internal-only bookkeeping (the raw prior-state dict used for
    next-turn diffing) before a record is returned over the API."""
    return {k: v for k, v in record.items() if not k.startswith("_")}
