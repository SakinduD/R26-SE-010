"""
LLM provider abstraction for RPE's NPC dialogue.

Routes between OpenAI (via the Responses API, called directly with httpx —
this codebase does not install the `openai` SDK) and Groq depending on
settings.USE_OPENAI. Callers only ever see NPCResponse — they never touch
either SDK directly, and never know which provider answered.

This is the ONLY place RPE talks to an LLM provider SDK for NPC dialogue.
rpe_npc_service.py builds the prompt/messages and calls get_npc_response();
everything provider-specific lives here.
"""
from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from functools import lru_cache
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.services import rpe_llm_debug

logger = logging.getLogger(__name__)

EmotionLabel = Literal[
    "neutral", "happy", "surprised", "frustrated",
    "sad", "skeptical", "angry", "thinking",
]
# Gesture the avatar plays alongside this line. Verified against the
# TalkingHead library's real capabilities (frontend/node_modules/@met4citizen/
# talkinghead) — its actual gestureTemplates are handup | index | ok | thumbup
# | thumbdown | side | shrug | namaste, plus emoji reactions; it has no
# "nodding", "armsCrossed", "leaningForward", "checkingWatch" or "applause",
# so an earlier version of this vocabulary (those five names) silently did
# nothing when played. Every value below maps 1:1 to something TalkingHead
# can actually render — see ANIMATION_TO_GESTURE in RolePlaySession.jsx.
AnimationLabel = Literal[
    "idle",           # no special gesture — just keep talking
    "thumbsUp",       # approval, agreement
    "thumbsDown",     # disapproval, rejection
    "shrug",          # uncertainty, "not my problem", dismissive
    "openHandPause",  # "wait", emphasis, explaining a point
    "pointing",       # assertive emphasis, calling something out
    "handsClasped",   # patient, composed, placating
    "wave",           # dismissive brush-off / goodbye
]
ScenarioProgress = Literal["opening", "building", "peak", "resolution", "complete"]

# Turn-level behavior coding for the USER's message — inspired by the
# utterance-coding pattern in motivational-interviewing training systems
# (MITI-style: classify every utterance into a fixed behavior taxonomy,
# not just a quality score), adapted from therapy talk to workplace
# conflict talk. Scored in the same LLM call that generates the NPC's
# reply, since that call already reads the user's message — no extra
# round trip, no added latency.
UserBehaviorLabel = Literal[
    "assertive_statement",  # clearly stated their own position or need
    "proposal",              # offered a concrete next step or solution
    "acknowledgment",        # recognised the other side's point or constraint
    "de_escalation",         # actively lowered tension (reframe, olive branch)
    "clarifying_question",   # asked to understand before responding
    "concession",            # gave ground without stating their own need
    "deflection",            # avoided the issue rather than answering it
    "escalation",            # raised tension (blame, ultimatum, hostility)
    "unclear",               # doesn't cleanly fit any of the above
]

# When the NPC's own line is asking the user to hand over something concrete
# (a document, report, form, evidence), free-text/voice input is a poor fit —
# STT mangles anything trying to describe a document out loud. Instead the
# frontend shows 2-3 tappable response options in place of the mic for that
# one turn. "quality" is bookkeeping only — never rendered to the user, since
# the point is that they judge quality themselves, not get told the answer.
ResponseOptionQuality = Literal["strong", "adequate", "weak"]

# What kind of thing the NPC's own line is asking the user for — replaces a
# single requestsDeliverable boolean. That boolean used to cover two very
# different situations with one response shape (3 example reply texts):
# "commit to sending something in general terms" (fine — a first-person
# reply describing the handoff is a real, complete thing to say) and
# "hand over the literal content right now" (not fine — the model has no
# actual paragraph/filename/figures to put in a sample reply, so it
# hallucinated placeholders like "[paste text here]" into responseOptions
# text, which then got sent to the NPC verbatim as if it were real content).
# Splitting the type stops the model from ever being asked to invent content
# it doesn't have — content_request/direct_input turns get a short prompt
# instead of fabricated example text, and the frontend renders a real input
# instead of choice cards.
InteractionType = Literal["normal", "deliverable_choice", "content_request", "direct_input"]

# Only meaningful when interactionType is content_request/direct_input — the
# frontend uses this to pick a textarea vs a single-line input (see
# resolveInteraction() in the frontend, frontend/src/lib/rpe/interaction.js).
ContentType = Literal["paragraph", "section", "evidence", "filename", "number", "short_text", "long_text"]

# Conversation Intelligence — structured NPC memory, so the NPC tracks one
# continuous conversation instead of generating isolated replies. Scored in
# the SAME LLM call as the dialogue itself (no second request — see
# get_npc_response() below); the model is given its own PRIOR turn's state
# back in the prompt each turn and asked to evolve it, not regenerate it
# from scratch (see rpe_npc_service._build_system_prompt's conversation
# state block). null/[] whenever the model isn't confident — never a guess.
ConversationPhase = Literal[
    "opening", "clarification", "commitment", "constraint",
    "negotiation", "escalation", "resolution", "closing",
]

# Safety caps enforced in code (not just prompted) — see get_npc_response()
# below. The model is told these limits too, but never trusted alone to
# self-bound an ever-growing list turn after turn.
MAX_LIST_ITEMS = 6
MAX_RECENT_TOPICS = 5

_EMPTY_MARKERS = {"none", "n/a", "na", "nothing", "-", ""}


def _drop_empty_markers(items: list[str]) -> list[str]:
    """[] is the correct way to say "nothing here" — strip a literal
    "none"/"n/a" item some models write instead, which would otherwise
    read as a real (fabricated) unresolved item, constraint, etc."""
    return [i for i in items if i.strip().lower() not in _EMPTY_MARKERS]


class ResponseOption(BaseModel):
    label: str
    text: str
    quality: ResponseOptionQuality


class NPCResponse(BaseModel):
    dialogue: str
    emotion: EmotionLabel
    animation: AnimationLabel
    internalNote: str
    scenarioProgress: ScenarioProgress
    userBehavior: UserBehaviorLabel
    interactionType: InteractionType
    responseOptions: list[ResponseOption] | None
    contentPrompt: str | None
    contentType: ContentType | None
    # Conversation Intelligence — see the block comment above ContentType.
    npcObjective: str | None
    conversationPhase: ConversationPhase | None
    unresolvedItems: list[str]
    commitments: list[str]
    agreedDeadlines: list[str]
    requestedItems: list[str]
    userConstraints: list[str]
    recentTopics: list[str]


_FALLBACK_RESPONSE = NPCResponse(
    dialogue="Give me a moment.",
    emotion="neutral",
    animation="idle",
    internalNote="",
    scenarioProgress="building",
    userBehavior="unclear",
    interactionType="normal",
    responseOptions=None,
    contentPrompt=None,
    contentType=None,
    npcObjective=None,
    conversationPhase=None,
    unresolvedItems=[],
    commitments=[],
    agreedDeadlines=[],
    requestedItems=[],
    userConstraints=[],
    recentTopics=[],
)

# ── Gemini structured-output schema (A/B experiment — see GeminiNPCResponse
# docstring below for why this can't just reuse NPCResponse directly) ──────

_GEMINI_UNSPECIFIED = "unspecified"
GeminiConversationPhase = Literal[
    "opening", "clarification", "commitment", "constraint",
    "negotiation", "escalation", "resolution", "closing", "unspecified",
]
GeminiContentType = Literal[
    "paragraph", "section", "evidence", "filename", "number",
    "short_text", "long_text", "unspecified",
]


class GeminiNPCResponse(BaseModel):
    """
    Same fields as NPCResponse, same enum values, but reshaped around two
    real Gemini structured-output limitations confirmed by hand against the
    live API during this A/B experiment (not assumed from docs):

    1. A nullable array-of-objects (NPCResponse.responseOptions:
       list[ResponseOption] | None) makes Gemini's schema converter emit an
       invalid partial schema — "properties[responseOptions].items: missing
       field" — a real 400 from the API, not a validation nicety. Fixed by
       making it a plain list (default []); "no options" is represented by
       an empty list instead of null.
    2. Gemini rejects an empty string as an enum value ("enum[...]: cannot
       be empty") — so the existing "null means not confident" convention
       for conversationPhase/contentType can't use "" as NPCResponse does
       for its plain-string fields. Uses a literal "unspecified" sentinel
       enum value instead, mapped back to None in _to_npc_response() below
       so every OTHER caller in the codebase still sees the exact same
       NPCResponse contract, null included.

    contentPrompt/npcObjective stay plain strings (not enums) — Gemini was
    fine with "" for those; only true enum fields needed the sentinel.
    """
    dialogue: str
    emotion: EmotionLabel
    animation: AnimationLabel
    internalNote: str
    scenarioProgress: ScenarioProgress
    userBehavior: UserBehaviorLabel
    interactionType: InteractionType
    responseOptions: list[ResponseOption] = []
    contentPrompt: str = ""
    contentType: GeminiContentType = _GEMINI_UNSPECIFIED
    npcObjective: str = ""
    conversationPhase: GeminiConversationPhase = _GEMINI_UNSPECIFIED
    unresolvedItems: list[str] = []
    commitments: list[str] = []
    agreedDeadlines: list[str] = []
    requestedItems: list[str] = []
    userConstraints: list[str] = []
    recentTopics: list[str] = []


def _gemini_to_npc_response(g: GeminiNPCResponse) -> NPCResponse:
    """Maps GeminiNPCResponse back onto the one true NPCResponse contract
    every other caller in the codebase already expects — sentinels/empty
    defaults become None, exactly matching NPCResponse's own semantics."""
    return NPCResponse(
        dialogue=g.dialogue, emotion=g.emotion, animation=g.animation,
        internalNote=g.internalNote, scenarioProgress=g.scenarioProgress,
        userBehavior=g.userBehavior, interactionType=g.interactionType,
        responseOptions=(g.responseOptions or None) if g.interactionType == "deliverable_choice" else None,
        contentPrompt=g.contentPrompt or None,
        contentType=None if g.contentType == _GEMINI_UNSPECIFIED else g.contentType,
        npcObjective=g.npcObjective or None,
        conversationPhase=None if g.conversationPhase == _GEMINI_UNSPECIFIED else g.conversationPhase,
        unresolvedItems=g.unresolvedItems, commitments=g.commitments,
        agreedDeadlines=g.agreedDeadlines, requestedItems=g.requestedItems,
        userConstraints=g.userConstraints, recentTopics=g.recentTopics,
    )


_RESPONSE_OPTION_SCHEMA = {
    "type": "object",
    "properties": {
        "label":   {"type": "string"},
        "text":    {"type": "string"},
        "quality": {"type": "string", "enum": list(ResponseOptionQuality.__args__)},
    },
    "required": ["label", "text", "quality"],
    "additionalProperties": False,
}

_NPC_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "dialogue": {"type": "string"},
        "emotion": {"type": "string", "enum": list(EmotionLabel.__args__)},
        "animation": {"type": "string", "enum": list(AnimationLabel.__args__)},
        "internalNote": {"type": "string"},
        "scenarioProgress": {"type": "string", "enum": list(ScenarioProgress.__args__)},
        "userBehavior": {"type": "string", "enum": list(UserBehaviorLabel.__args__)},
        "interactionType": {"type": "string", "enum": list(InteractionType.__args__)},
        "responseOptions": {
            "type": ["array", "null"],
            "items": _RESPONSE_OPTION_SCHEMA,
        },
        "contentPrompt": {"type": ["string", "null"]},
        "contentType": {"type": ["string", "null"], "enum": list(ContentType.__args__) + [None]},
        "npcObjective": {"type": ["string", "null"]},
        "conversationPhase": {"type": ["string", "null"], "enum": list(ConversationPhase.__args__) + [None]},
        "unresolvedItems": {"type": "array", "items": {"type": "string"}},
        "commitments": {"type": "array", "items": {"type": "string"}},
        "agreedDeadlines": {"type": "array", "items": {"type": "string"}},
        "requestedItems": {"type": "array", "items": {"type": "string"}},
        "userConstraints": {"type": "array", "items": {"type": "string"}},
        "recentTopics": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "dialogue", "emotion", "animation", "internalNote",
        "scenarioProgress", "userBehavior",
        "interactionType", "responseOptions", "contentPrompt", "contentType",
        "npcObjective", "conversationPhase", "unresolvedItems", "commitments",
        "agreedDeadlines", "requestedItems", "userConstraints", "recentTopics",
    ],
    "additionalProperties": False,
}

_END_CHECK_SCHEMA = {
    "type": "object",
    "properties": {"resolved": {"type": "boolean"}},
    "required": ["resolved"],
    "additionalProperties": False,
}


@lru_cache(maxsize=1)
def _get_groq_client():
    """
    RPE's single shared Groq client (fallback provider + conversation-end
    check). Returns None if GROQ_API_KEY isn't configured — callers must
    handle that. Cached so we don't construct a new SDK client per call.

    timeout/max_retries: unlike every OpenAI-path call in this file (raw
    httpx, explicit timeout=15.0 — see _call_openai_json), the Groq SDK's
    own default timeout/retry behavior was never overridden here, so a slow
    Groq API moment had no bound at all. classify_conversation_end() always
    prefers Groq (regardless of USE_OPENAI) and sits in the critical path
    of every turn from turn 5 onward — an unbounded Groq call there could
    push one turn's total latency well past what a live conversation can
    tolerate (this is what a real 30s+ frontend timeout traced back to).

    max_retries=0, not 1: the SDK's own retry logic re-attempts the FULL
    request on failure, each attempt bounded by `timeout` independently —
    so timeout=15.0 with max_retries=1 (this function's previous setting)
    has a worst case of 2x15s=30s, not 15s. Confirmed for real during this
    optimization pass's Groq-vs-OpenAI benchmark: one otherwise-identical
    call took 28006ms, consistent with one slow attempt plus a retry. For
    a call that already has its own safe fallback on failure
    (should_conversation_end returns False; get_npc_response's Groq path
    returns _FALLBACK_RESPONSE), retrying is pure latency risk with no
    correctness upside — failing once, fast, and falling back is strictly
    better here than trying twice and doubling the worst case.
    """
    settings = get_settings()
    if not settings.groq_api_key:
        return None
    from groq import Groq
    return Groq(api_key=settings.groq_api_key, timeout=15.0, max_retries=0)


def _call_openai_json(
    input_messages: list[dict], schema: dict, schema_name: str,
    debug_ctx: dict | None = None, reasoning_effort: str = "minimal",
) -> dict[str, Any] | None:
    """
    POST to OpenAI's Responses API with strict JSON-schema structured output.
    Mirrors llm_mentoring_service.py's _call_openai_mentoring — same
    Responses API shape, same raw-httpx approach (no `openai` package
    installed in this project). Returns None on any failure so callers can
    fall back safely.

    debug_ctx: only set (by _get_npc_response_openai) for the per-turn NPC
    dialogue call, never for the end-detection/coaching/scenario-prose
    calls that also route through this function — see rpe_llm_debug.py.
    None is always a safe no-op here, in production or when
    settings.debug is off.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        logger.warning("RPE OpenAI call skipped: OPENAI_API_KEY not configured")
        return None

    payload = {
        "model": settings.rpe_openai_model,
        # RPE is a live conversation — every extra second of reasoning is
        # dead air for the user. "minimal" cut a trivial NPC turn from
        # ~15.7s to ~5.2s in testing; mentoring (async, non-interactive)
        # uses "low" instead since its latency isn't user-facing.
        # reasoning_effort defaults to "minimal" (unchanged for every
        # caller except _get_npc_response_openai, which is the only one
        # that ever passes settings.rpe_openai_reasoning_effort through —
        # see the latency-investigation pass's own benchmark for why
        # "minimal" measurably remains the right default: low/medium/high
        # were 1.8x/3.3x/6x+ slower on this same model, real numbers, not
        # assumed. Coaching/end-detection calls through this same function
        # are untouched by that setting on purpose — this override exists
        # only to benchmark NPC-dialogue latency, not to change every
        # OpenAI call in this file at once.
        "reasoning": {"effort": reasoning_effort},
        "input": input_messages,
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "schema": schema,
                "strict": True,
            }
        },
    }

    # LLM Payload Inspector — capture the EXACT payload just built above,
    # immediately before it goes over the wire. input_messages[0] is always
    # {"role": "system", "content": system_prompt} here (see
    # _get_npc_response_openai) so system_prompt is recovered from it
    # rather than threaded as a second copy of the same string.
    capture = None
    if debug_ctx is not None and rpe_llm_debug.debug_enabled():
        system_prompt = input_messages[0]["content"]
        capture = rpe_llm_debug.start_capture(
            session_id=debug_ctx["session_id"], turn=debug_ctx["turn"],
            provider="openai", model=settings.rpe_openai_model,
            system_prompt=system_prompt, state_block_text=debug_ctx["state_block_text"],
            prior_conversation_state=debug_ctx["prior_conversation_state"],
            history_messages=debug_ctx["history_messages"], user_message=debug_ctx["user_message"],
            schema_text=json.dumps(schema, sort_keys=True), schema_is_exact=True,
            prompt_version=debug_ctx.get("prompt_version", "current"),
            reasoning_effort=reasoning_effort,
        )

    request_start = time.time()
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{settings.openai_base_url.rstrip('/')}/responses",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
        response_complete = time.time()
        response_json = response.json()
        parsed = _parse_openai_response(response_json)
        parse_complete = time.time()
        if capture is not None:
            usage = response_json.get("usage") or {}
            # created_at/completed_at — real fields on the Responses API's
            # own response envelope (confirmed by inspecting a live reply
            # during this experiment), integer Unix seconds only (1s
            # resolution — not precise enough for a sub-second breakdown,
            # but the closest thing to "server-side processing time" this
            # non-streaming API exposes, separate from our own client-side
            # network+queueing overhead). None if either field is missing.
            server_processing_s = None
            if response_json.get("completed_at") is not None and response_json.get("created_at") is not None:
                server_processing_s = response_json["completed_at"] - response_json["created_at"]
            rpe_llm_debug.finish_capture(
                capture, success=True, error=None, raw_response_data=parsed,
                actual_input_tokens=usage.get("input_tokens"),
                actual_output_tokens=usage.get("output_tokens"),
                request_start=request_start, response_complete=response_complete,
                parse_complete=parse_complete, usage_raw=usage,
                server_processing_s=server_processing_s,
            )
        return parsed
    except Exception as exc:
        if capture is not None:
            rpe_llm_debug.finish_capture(
                capture, success=False, error=str(exc), raw_response_data=None,
                actual_input_tokens=None, actual_output_tokens=None,
                request_start=request_start, response_complete=time.time(),
                parse_complete=time.time(),
            )
        logger.warning("RPE OpenAI call failed: %s", exc)
        return None


_DASH_RUN = re.compile(r"\s*(?:-{2,}|[–—])\s*")


def _strip_llm_dashes(text: str) -> str:
    """
    Both OpenAI and Groq habitually punctuate with "--" or an em-dash for a
    mid-sentence interruption/pause — reads fine in prose, looks like a
    formatting glitch in a chat bubble. Swap it for ", " and tidy up the
    punctuation/spacing that leaves behind.
    """
    cleaned = _DASH_RUN.sub(", ", text)
    cleaned = re.sub(r",\s*,", ",", cleaned)
    cleaned = re.sub(r"\s+([,.!?])", r"\1", cleaned)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _parse_openai_response(response_data: dict[str, Any]) -> dict[str, Any]:
    if response_data.get("output_text"):
        return json.loads(response_data["output_text"])
    for output in response_data.get("output", []):
        for content in output.get("content", []):
            text = content.get("text")
            if text:
                return json.loads(text)
    return {}


def _get_npc_response_openai(
    messages: list[dict], system_prompt: str, debug_ctx: dict | None = None,
) -> NPCResponse:
    input_messages = [{"role": "system", "content": system_prompt}, *messages]
    reasoning_effort = getattr(get_settings(), "rpe_openai_reasoning_effort", "minimal")
    data = _call_openai_json(
        input_messages, _NPC_RESPONSE_SCHEMA, "npc_response",
        debug_ctx=debug_ctx, reasoning_effort=reasoning_effort,
    )
    if not data:
        return _FALLBACK_RESPONSE
    try:
        return NPCResponse.model_validate(data)
    except ValidationError as exc:
        logger.warning("RPE OpenAI returned schema-invalid JSON: %s", exc)
        return _FALLBACK_RESPONSE


def _get_npc_response_groq(messages: list[dict], system_prompt: str) -> NPCResponse:
    client = _get_groq_client()
    if not client:
        logger.warning("RPE Groq fallback: GROQ_API_KEY not configured")
        return _FALLBACK_RESPONSE

    groq_messages = [{"role": "system", "content": system_prompt}, *messages]

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=groq_messages,
            # Bumped from 500 — conversation-intelligence fields (objective +
            # up to 6 short arrays) added real output surface; 500 risked
            # truncating valid JSON mid-array under strict schema mode,
            # which reads as a schema-invalid response and needlessly
            # engages the fallback.
            max_tokens=700,
            reasoning_effort="low",
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "npc_response", "schema": _NPC_RESPONSE_SCHEMA, "strict": True},
            },
        )
        raw: str = response.choices[0].message.content.strip()
        data: Any = json.loads(raw)
        return NPCResponse.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("RPE Groq returned invalid/schema-mismatched JSON: %s", exc)
        return _FALLBACK_RESPONSE
    except Exception as exc:
        logger.warning("RPE Groq call failed: %s", exc)
        return _FALLBACK_RESPONSE


# ── Gemini (A/B experiment — see rpe_llm_service module docstring's own
# "RPE_LLM_PROVIDER" note and Backend/docs for the full write-up) ─────────

GEMINI_TIMEOUT_S = 15.0  # same bound as the OpenAI httpx client and the Groq SDK client


@lru_cache(maxsize=1)
def _get_gemini_client():
    """
    RPE's own Gemini client for the NPC-dialogue experiment — deliberately
    separate from app.core.llm_client.GeminiClient (APM's client): that one
    is shared with pedagogy/APM code this task must not touch, and its
    generate_json_from_contents() uses plain response_mime_type=
    'application/json' rather than a real response_schema, which is what
    section 6 of this task explicitly requires (schema-validated structured
    output, not "please return JSON"). Returns None if GEMINI_API_KEY isn't
    configured — callers must handle that (clean fail, no crash).
    """
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    from google import genai
    return genai.Client(api_key=settings.gemini_api_key)


def _messages_to_gemini_contents(messages: list[dict]) -> list[dict]:
    """OpenAI-style {"role": "user"|"assistant", "content": str} -> Gemini's
    {"role": "user"|"model", "parts": [{"text": str}]}. Gemini has no
    "assistant" role — "model" is its NPC-turn equivalent."""
    contents = []
    for m in messages:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    return contents


def _get_npc_response_gemini(
    messages: list[dict], system_prompt: str, debug_ctx: dict | None = None,
) -> NPCResponse | None:
    """
    Returns None (never _FALLBACK_RESPONSE directly) on any failure, so
    get_npc_response()'s dispatcher can tell "Gemini didn't answer" apart
    from "Gemini's real answer happened to be the fallback text" and decide
    what to fall back to itself, per section 14's fallback-order rules.

    No retry — deliberate. This session's own Groq-timeout investigation
    found that even ONE retry on a bounded-timeout call can double the
    worst-case wait (timeout x (1 + retries)) for a call that already has a
    safe fallback on failure; the same reasoning applies here. Fail once,
    fast, and let the caller fall back rather than trying twice.

    debug_ctx: see _call_openai_json's own docstring — same idea, this is
    the ONLY Gemini call this codebase makes for NPC dialogue, so there's
    no schema_name-style filtering needed here.
    """
    client = _get_gemini_client()
    if not client:
        logger.warning("RPE Gemini: GEMINI_API_KEY not configured")
        return None

    from google.genai import types
    settings = get_settings()
    contents = _messages_to_gemini_contents(messages)
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=GeminiNPCResponse,
        system_instruction=system_prompt,
        # No thinking_config here — this SDK version (0.8.0, pinned; see
        # Backend/docs for why it can't be upgraded without breaking
        # Supabase's httpx pin) has no thinking_budget field. gemini-3.6-
        # flash's default thinking made it measurably unusable for this
        # (~25-30s per turn, confirmed over 3 real trials) — that model is
        # NOT the recommended default here for exactly that reason. No
        # explicit temperature/top_p — same "use provider defaults" stance
        # the existing OpenAI/Groq calls already take.
    )

    # LLM Payload Inspector capture — same contents/system_instruction the
    # SDK call below actually receives. The JSON *schema* Gemini's SDK
    # derives from response_schema=GeminiNPCResponse isn't inspectable as a
    # literal wire string in this SDK version (0.8.0) before the call goes
    # out, so schema size here is reconstructed from
    # GeminiNPCResponse.model_json_schema() — an approximation of the
    # converted schema, not a byte-exact capture (schema_is_exact=False,
    # surfaced as such in the debug API — see rpe_llm_debug.py).
    capture = None
    if debug_ctx is not None and rpe_llm_debug.debug_enabled():
        capture = rpe_llm_debug.start_capture(
            session_id=debug_ctx["session_id"], turn=debug_ctx["turn"],
            provider="gemini", model=settings.rpe_gemini_model,
            system_prompt=system_prompt, state_block_text=debug_ctx["state_block_text"],
            prior_conversation_state=debug_ctx["prior_conversation_state"],
            history_messages=debug_ctx["history_messages"], user_message=debug_ctx["user_message"],
            schema_text=json.dumps(GeminiNPCResponse.model_json_schema(), sort_keys=True),
            schema_is_exact=False,
            prompt_version=debug_ctx.get("prompt_version", "current"),
        )

    def _fail(error: str) -> None:
        if capture is not None:
            now = time.time()
            rpe_llm_debug.finish_capture(
                capture, success=False, error=error, raw_response_data=None,
                actual_input_tokens=None, actual_output_tokens=None,
                request_start=capture["timing"]["request_start"],
                response_complete=now, parse_complete=now,
            )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            client.models.generate_content,
            model=settings.rpe_gemini_model,
            contents=contents,
            config=config,
        )
        try:
            response = future.result(timeout=GEMINI_TIMEOUT_S)
        except FuturesTimeoutError:
            logger.warning("RPE Gemini call timed out after %.1fs", GEMINI_TIMEOUT_S)
            _fail(f"timeout after {GEMINI_TIMEOUT_S}s")
            return None
        except Exception as exc:
            logger.warning("RPE Gemini call failed: %s", exc)
            _fail(str(exc))
            return None
    response_complete = time.time()

    text = (getattr(response, "text", None) or "").strip()
    if not text:
        logger.warning("RPE Gemini returned an empty response")
        _fail("empty response")
        return None
    try:
        data = json.loads(text)
        gemini_response = GeminiNPCResponse.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("RPE Gemini returned invalid/schema-mismatched JSON: %s", exc)
        _fail(f"schema-invalid: {exc}")
        return None
    parse_complete = time.time()

    if capture is not None:
        usage = getattr(response, "usage_metadata", None)
        # google-genai 0.8.0's usage_metadata has no cache-related field —
        # confirmed by inspecting its real attributes, not assumed absent.
        # Passed through as a plain dict anyway (not None) so
        # _extract_cache_info reports UNKNOWN from an actual absence of a
        # cache key, the same as it would for any other provider that
        # simply doesn't expose one, rather than a blanket "no usage at all".
        usage_raw = (
            {"prompt_token_count": getattr(usage, "prompt_token_count", None),
             "candidates_token_count": getattr(usage, "candidates_token_count", None),
             "total_token_count": getattr(usage, "total_token_count", None)}
            if usage else None
        )
        rpe_llm_debug.finish_capture(
            capture, success=True, error=None, raw_response_data=data,
            actual_input_tokens=getattr(usage, "prompt_token_count", None) if usage else None,
            actual_output_tokens=getattr(usage, "candidates_token_count", None) if usage else None,
            request_start=capture["timing"]["request_start"],
            response_complete=response_complete, parse_complete=parse_complete,
            usage_raw=usage_raw,
        )

    return _gemini_to_npc_response(gemini_response)


async def get_npc_response(
    messages: list[dict],
    system_prompt: str,
    scenario_context: dict,
    debug_ctx: dict | None = None,
) -> NPCResponse:
    """
    Get the NPC's next turn. Routes by settings.rpe_llm_provider first
    ("gemini" — the A/B experiment — vs. the original "openai" default,
    which preserves the exact pre-existing settings.USE_OPENAI routing
    unchanged); callers never see which provider actually answered.

    messages: OpenAI-style [{"role": "user"|"assistant", "content": str}, ...]
              turns only (no system role — pass that via system_prompt).

    debug_ctx: optional {"session_id", "turn", "state_block_text",
    "prior_conversation_state", "history_messages", "user_message"} — see
    rpe_npc_service.generate_response's own comment for how it's built, and
    rpe_llm_debug.py for what happens with it. None (the default) is a
    total no-op — every existing caller/test keeps working unchanged.
    """
    settings = get_settings()
    provider = getattr(settings, "rpe_llm_provider", "openai")

    if provider == "gemini":
        # Fallback order per section 14: Gemini -> OpenAI/Groq (whichever
        # USE_OPENAI already selects) -> that path's own existing
        # _FALLBACK_RESPONSE safety net, untouched.
        response = _get_npc_response_gemini(messages, system_prompt, debug_ctx=debug_ctx)
        if response is None:
            logger.warning("RPE Gemini unavailable this turn, falling back to %s",
                            "OpenAI" if settings.USE_OPENAI else "Groq")
            response = (
                _get_npc_response_openai(messages, system_prompt, debug_ctx=debug_ctx) if settings.USE_OPENAI
                else _get_npc_response_groq(messages, system_prompt)
            )
    elif settings.USE_OPENAI:
        response = _get_npc_response_openai(messages, system_prompt, debug_ctx=debug_ctx)
        # Secondary fallback per section 14: only when explicitly opted in
        # (RPE_LLM_FALLBACK_PROVIDER=gemini) — default "" leaves today's
        # behavior (OpenAI failure -> _FALLBACK_RESPONSE, nothing else)
        # completely unchanged.
        if response is _FALLBACK_RESPONSE and getattr(settings, "rpe_llm_fallback_provider", "") == "gemini":
            gemini_response = _get_npc_response_gemini(messages, system_prompt, debug_ctx=debug_ctx)
            if gemini_response is not None:
                response = gemini_response
    else:
        response = _get_npc_response_groq(messages, system_prompt)

    response.dialogue = _strip_llm_dashes(response.dialogue)
    if response.responseOptions:
        for option in response.responseOptions:
            option.text = _strip_llm_dashes(option.text)
    if response.contentPrompt:
        response.contentPrompt = _strip_llm_dashes(response.contentPrompt)

    # Safety cap, not just a prompt instruction (see MAX_LIST_ITEMS/
    # MAX_RECENT_TOPICS above) — the model is told to keep these short, but
    # a code-level bound is what actually prevents unbounded accumulation
    # turn after turn if it doesn't. Keeps the *most recent* entries, since
    # those are the ones still relevant to the live conversation.
    # _drop_empty_markers first: an empty list is the correct way to say
    # "nothing to report" — observed in testing the model sometimes writes
    # a literal "none"/"n/a" item instead, which would otherwise read as a
    # real (fabricated) unresolved item / constraint.
    response.unresolvedItems = _drop_empty_markers(response.unresolvedItems)[-MAX_LIST_ITEMS:]
    response.commitments = _drop_empty_markers(response.commitments)[-MAX_LIST_ITEMS:]
    response.agreedDeadlines = _drop_empty_markers(response.agreedDeadlines)[-MAX_LIST_ITEMS:]
    response.requestedItems = _drop_empty_markers(response.requestedItems)[-MAX_LIST_ITEMS:]
    response.userConstraints = _drop_empty_markers(response.userConstraints)[-MAX_LIST_ITEMS:]
    response.recentTopics = _drop_empty_markers(response.recentTopics)[-MAX_RECENT_TOPICS:]

    if response.internalNote:
        logger.info(
            "RPE internal note | npc_role=%s | %s",
            scenario_context.get("npc_role"), response.internalNote,
        )
    return response


def _build_end_detection_prompt(context: str) -> str:
    return (
        "You are evaluating a workplace roleplay conversation "
        "between an employee (User) and their manager (NPC).\n\n"
        f"{context}\n"
        "Has this conversation reached a natural conclusion? "
        "A natural conclusion means both sides have agreed on "
        "something, the issue is resolved, or there is nothing "
        "more productive to discuss.\n\n"
        'Respond ONLY with valid JSON matching this schema: {"resolved": true or false}\n'
        "Do not include any text outside the JSON object."
    )


def _classify_conversation_end_openai(prompt: str) -> bool:
    data = _call_openai_json(
        [{"role": "user", "content": prompt}], _END_CHECK_SCHEMA, "conversation_end_check"
    )
    if not data:
        return False
    return data.get("resolved") is True


def _classify_conversation_end_groq(prompt: str) -> bool:
    client = _get_groq_client()
    if not client:
        return False
    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
            temperature=0,
            reasoning_effort="low",
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "conversation_end_check", "schema": _END_CHECK_SCHEMA, "strict": True},
            },
        )
        raw = response.choices[0].message.content.strip()
        data = json.loads(raw)
        return data.get("resolved") is True
    except Exception as exc:
        logger.warning("RPE conversation-end Groq check failed: %s", exc)
        return False


async def classify_conversation_end(context: str) -> bool:
    """
    Ask the LLM whether a roleplay conversation has reached a natural
    conclusion, given a formatted transcript excerpt (`context`).

    Unlike get_npc_response(), this does NOT follow settings.USE_OPENAI —
    it always prefers Groq. This call sits in the critical path of every
    turn from turn 5 onward (session_respond calls it synchronously right
    after generating the NPC's dialogue), and it's a trivial yes/no
    classification, not writing — Groq answers it in well under a second,
    versus several seconds for an OpenAI reasoning-model round trip. Routing
    it through OpenAI too was doubling the user-facing wait on every later
    turn for no quality benefit. Falls back to OpenAI only if Groq isn't
    configured at all.

    Returns False on any failure — a detection failure should never end
    a session on its own.
    """
    settings = get_settings()
    prompt = _build_end_detection_prompt(context)
    if settings.groq_api_key:
        return _classify_conversation_end_groq(prompt)
    if settings.USE_OPENAI:
        return _classify_conversation_end_openai(prompt)
    return False


class CoachingResponse(BaseModel):
    """Matches the shape rpe_coaching_service.py has always parsed."""
    overall_rating: Literal["excellent", "good", "needs_work"]
    summary: str
    advice: list[str]
    strengths: list[str]
    focus_areas: list[str]
    # Debrief highlights — need the real turn-by-turn transcript to compute,
    # so rpe_coaching_service now sends that alongside the aggregate stats it
    # always has. Nullable: a very short/incomplete session may not have a
    # clear best/worst moment to point at.
    strongest_turn:        int | None = None
    strongest_turn_note:   str | None = None
    improvement_turn:       int | None = None
    improvement_original:   str | None = None
    improvement_suggested:  str | None = None


_COACHING_SCHEMA = {
    "type": "object",
    "properties": {
        "overall_rating": {"type": "string", "enum": ["excellent", "good", "needs_work"]},
        "summary": {"type": "string"},
        "advice": {"type": "array", "items": {"type": "string"}},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "focus_areas": {"type": "array", "items": {"type": "string"}},
        "strongest_turn":       {"type": ["integer", "null"]},
        "strongest_turn_note":  {"type": ["string", "null"]},
        "improvement_turn":      {"type": ["integer", "null"]},
        "improvement_original":  {"type": ["string", "null"]},
        "improvement_suggested": {"type": ["string", "null"]},
    },
    "required": [
        "overall_rating", "summary", "advice", "strengths", "focus_areas",
        "strongest_turn", "strongest_turn_note",
        "improvement_turn", "improvement_original", "improvement_suggested",
    ],
    "additionalProperties": False,
}


def _coaching_fallback(outcome: str | None) -> CoachingResponse:
    rating = "good" if outcome == "success" else "needs_work"
    return CoachingResponse(
        overall_rating=rating,
        summary="Session complete. Review your turn-by-turn performance below.",
        advice=[
            "Focus on staying calm and assertive throughout the conversation.",
            "Use empathetic language early to build trust with the NPC.",
            "When escalation rises, slow down and acknowledge the NPC's concern.",
        ],
        strengths=["Completed the session"],
        focus_areas=["Trust building", "Escalation management"],
    )


def _get_coaching_response_openai(
    prompt: str, system_prompt: str, outcome: str | None
) -> CoachingResponse:
    input_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]
    data = _call_openai_json(input_messages, _COACHING_SCHEMA, "coaching_response")
    if not data:
        return _coaching_fallback(outcome)
    try:
        return CoachingResponse.model_validate(data)
    except ValidationError as exc:
        logger.warning("RPE coaching OpenAI returned schema-invalid JSON: %s", exc)
        return _coaching_fallback(outcome)


def _get_coaching_response_groq(
    prompt: str, system_prompt: str, outcome: str | None
) -> CoachingResponse:
    client = _get_groq_client()
    if not client:
        return _coaching_fallback(outcome)

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": prompt},
            ],
            max_tokens=900,
            reasoning_effort="low",
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "coaching_response", "schema": _COACHING_SCHEMA, "strict": True},
            },
        )
        raw: str = response.choices[0].message.content.strip()
        data: Any = json.loads(raw)
        return CoachingResponse.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("RPE coaching Groq returned invalid/schema-mismatched JSON: %s", exc)
        return _coaching_fallback(outcome)
    except Exception as exc:
        logger.warning("RPE coaching Groq call failed: %s", exc)
        return _coaching_fallback(outcome)


async def get_coaching_response(
    prompt: str,
    system_prompt: str,
    outcome: str | None = None,
) -> CoachingResponse:
    """
    Generate post-session coaching advice. Routes to OpenAI or Groq based on
    settings.USE_OPENAI, same pattern as get_npc_response(). Never raises —
    returns a safe, outcome-aware fallback CoachingResponse on any failure.
    """
    settings = get_settings()
    if settings.USE_OPENAI:
        return _get_coaching_response_openai(prompt, system_prompt, outcome)
    return _get_coaching_response_groq(prompt, system_prompt, outcome)


class ScenarioProseResponse(BaseModel):
    """Generated prose for a plan-imported scenario — see rpe_plan_import_service.py."""
    title: str
    opening_npc_line: str
    context: str


_SCENARIO_PROSE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "opening_npc_line": {"type": "string"},
        "context": {"type": "string"},
    },
    "required": ["title", "opening_npc_line", "context"],
    "additionalProperties": False,
}


def _scenario_prose_fallback(trigger_event: str, situation_summary: str, fallback_title: str) -> ScenarioProseResponse:
    return ScenarioProseResponse(
        title=fallback_title,
        opening_npc_line="Alright, let's talk about this.",
        context=f"{situation_summary} {trigger_event}".strip(),
    )


def generate_scenario_prose(
    prompt: str, trigger_event: str, situation_summary: str, fallback_title: str
) -> ScenarioProseResponse:
    """
    Write the opening NPC line + scene-setting context for a scenario
    generated from an APM Training Plan brief. Called once at scenario
    creation time (not per-turn), so this is a one-shot, non-latency-critical
    generation — Groq only, no OpenAI routing, per the APM handoff doc's
    explicit suggestion (rpe_plan_import_service.py builds the prompt from
    the brief's blueprint fields; this just runs it).

    Falls back to a generic line built from the brief's own text on any
    failure — scenario creation should never hard-fail because prose
    generation had a bad moment.
    """
    client = _get_groq_client()
    if not client:
        return _scenario_prose_fallback(trigger_event, situation_summary, fallback_title)

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=700,
            temperature=0.8,
            reasoning_effort="low",
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "scenario_prose", "schema": _SCENARIO_PROSE_SCHEMA, "strict": True},
            },
        )
        raw: str = response.choices[0].message.content.strip()
        data: Any = json.loads(raw)
        return ScenarioProseResponse.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("RPE scenario prose returned invalid/schema-mismatched JSON: %s", exc)
        return _scenario_prose_fallback(trigger_event, situation_summary, fallback_title)
    except Exception as exc:
        logger.warning("RPE scenario prose Groq call failed: %s", exc)
        return _scenario_prose_fallback(trigger_event, situation_summary, fallback_title)
