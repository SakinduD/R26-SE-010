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
from functools import lru_cache
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings

logger = logging.getLogger(__name__)

EmotionLabel = Literal[
    "neutral", "happy", "surprised", "frustrated",
    "sad", "skeptical", "angry", "thinking",
]
AnimationLabel = Literal[
    "idle", "nodding", "armsCrossed", "leaningForward",
    "checkingWatch", "dismissiveWave", "applause",
]
ScenarioProgress = Literal["opening", "building", "peak", "resolution", "complete"]


class NPCResponse(BaseModel):
    dialogue: str
    emotion: EmotionLabel
    animation: AnimationLabel
    internalNote: str
    scenarioProgress: ScenarioProgress


_FALLBACK_RESPONSE = NPCResponse(
    dialogue="Give me a moment.",
    emotion="neutral",
    animation="idle",
    internalNote="",
    scenarioProgress="building",
)

_NPC_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "dialogue": {"type": "string"},
        "emotion": {"type": "string", "enum": list(EmotionLabel.__args__)},
        "animation": {"type": "string", "enum": list(AnimationLabel.__args__)},
        "internalNote": {"type": "string"},
        "scenarioProgress": {"type": "string", "enum": list(ScenarioProgress.__args__)},
    },
    "required": ["dialogue", "emotion", "animation", "internalNote", "scenarioProgress"],
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
    """
    settings = get_settings()
    if not settings.groq_api_key:
        return None
    from groq import Groq
    return Groq(api_key=settings.groq_api_key)


def _call_openai_json(
    input_messages: list[dict], schema: dict, schema_name: str
) -> dict[str, Any] | None:
    """
    POST to OpenAI's Responses API with strict JSON-schema structured output.
    Mirrors llm_mentoring_service.py's _call_openai_mentoring — same
    Responses API shape, same raw-httpx approach (no `openai` package
    installed in this project). Returns None on any failure so callers can
    fall back safely.
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
        "reasoning": {"effort": "minimal"},
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
        return _parse_openai_response(response.json())
    except Exception as exc:
        logger.warning("RPE OpenAI call failed: %s", exc)
        return None


def _parse_openai_response(response_data: dict[str, Any]) -> dict[str, Any]:
    if response_data.get("output_text"):
        return json.loads(response_data["output_text"])
    for output in response_data.get("output", []):
        for content in output.get("content", []):
            text = content.get("text")
            if text:
                return json.loads(text)
    return {}


def _get_npc_response_openai(messages: list[dict], system_prompt: str) -> NPCResponse:
    input_messages = [{"role": "system", "content": system_prompt}, *messages]
    data = _call_openai_json(input_messages, _NPC_RESPONSE_SCHEMA, "npc_response")
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
            model="llama-3.3-70b-versatile",
            messages=groq_messages,
            max_tokens=300,
            response_format={"type": "json_object"},
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


async def get_npc_response(
    messages: list[dict],
    system_prompt: str,
    scenario_context: dict,
) -> NPCResponse:
    """
    Get the NPC's next turn. Routes to OpenAI or Groq based on
    settings.USE_OPENAI — callers never see which provider answered.

    messages: OpenAI-style [{"role": "user"|"assistant", "content": str}, ...]
              turns only (no system role — pass that via system_prompt).
    """
    settings = get_settings()
    if settings.USE_OPENAI:
        response = _get_npc_response_openai(messages, system_prompt)
    else:
        response = _get_npc_response_groq(messages, system_prompt)

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
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0,
            response_format={"type": "json_object"},
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
    """Matches the shape rpe_coaching_service.py has always parsed — unchanged in this step."""
    overall_rating: Literal["excellent", "good", "needs_work"]
    summary: str
    advice: list[str]
    strengths: list[str]
    focus_areas: list[str]


_COACHING_SCHEMA = {
    "type": "object",
    "properties": {
        "overall_rating": {"type": "string", "enum": ["excellent", "good", "needs_work"]},
        "summary": {"type": "string"},
        "advice": {"type": "array", "items": {"type": "string"}},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "focus_areas": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["overall_rating", "summary", "advice", "strengths", "focus_areas"],
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
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": prompt},
            ],
            max_tokens=600,
            response_format={"type": "json_object"},
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
    opening_npc_line: str
    context: str


def _scenario_prose_fallback(trigger_event: str, situation_summary: str) -> ScenarioProseResponse:
    return ScenarioProseResponse(
        opening_npc_line="Alright, let's talk about this.",
        context=f"{situation_summary} {trigger_event}".strip(),
    )


def generate_scenario_prose(prompt: str, trigger_event: str, situation_summary: str) -> ScenarioProseResponse:
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
        return _scenario_prose_fallback(trigger_event, situation_summary)

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.8,
            response_format={"type": "json_object"},
        )
        raw: str = response.choices[0].message.content.strip()
        data: Any = json.loads(raw)
        return ScenarioProseResponse.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("RPE scenario prose returned invalid/schema-mismatched JSON: %s", exc)
        return _scenario_prose_fallback(trigger_event, situation_summary)
    except Exception as exc:
        logger.warning("RPE scenario prose Groq call failed: %s", exc)
        return _scenario_prose_fallback(trigger_event, situation_summary)
