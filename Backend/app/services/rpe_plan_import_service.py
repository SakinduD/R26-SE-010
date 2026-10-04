"""
Generates a playable RPE scenario from an APM Training Plan.

APM describes WHAT a scenario must contain (ScenarioGenerationBrief); RPE
writes the scenario itself. This module is the brief -> ScenarioDetail path:

    fetch_scenario_brief()   — HTTP GET to APM's own endpoint (same server,
                                same convention as app/core/rpe_client.py's
                                reverse direction: real HTTP even in-process,
                                so the integration matches a future split).
    map_brief_to_scenario()  — pure, deterministic field mapping + scale
                                conversion. No LLM. Unit-testable in isolation.
    build_prose_prompt()     — prompt for the one non-deterministic step.
    generate_and_persist_scenario() — orchestrates fetch -> map -> prose
                                (via rpe_llm_service.generate_scenario_prose,
                                the only place allowed to call an LLM SDK) ->
                                write the scenario JSON file.

See Backend/docs/RPE_SCENARIO_GENERATION_HANDOFF.md and
Backend/docs/INTEGRATION_TRAINING_PLAN.md for the full contract.
"""
from __future__ import annotations

import json
import logging

import httpx

from app.config import get_settings
from app.contracts.training_plan import ScenarioGenerationBrief
from app.services import rpe_llm_service
from app.services.rpe_scenario_service import SCENARIOS_DIR

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 8.0


def _article(noun: str) -> str:
    return "an" if noun[:1].lower() in "aeiou" else "a"


def _fallback_title(mapped: dict) -> str:
    """
    Last-resort title when generate_scenario_prose() didn't return one (any
    LLM failure there degrades to this rather than a hard error). The
    mechanical "<Domain> with a <Role>" hint built as blueprint.title_hint
    (plan_composer.py) is normally fine, but degrades badly whenever domain
    classification itself already fell through to intent_parser.py's "other"
    catch-all (e.g. its own Gemini call failed and the keyword-only parse
    matched nothing) — "Other with a colleague" tells a learner nothing, and
    stacking two silent fallbacks back to back is exactly how that title got
    shipped. target_skills is always populated regardless of whether domain
    classification succeeded, so anchor to the skill instead of the domain
    word whenever the domain hint would be this uninformative.
    """
    hint = mapped["title"]
    if not hint.lower().startswith("other "):
        return hint

    role = mapped["npc_role"]
    skills = mapped["apa_metadata"]["target_skills"]
    skill_label = skills[0].replace("_", " ").title() if skills else "Difficult Conversation"
    return f"{skill_label} Practice with {_article(role)} {role}"


class PlanImportError(Exception):
    """Raised when the brief can't be fetched or a scenario can't be built."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


async def fetch_scenario_brief(plan_id: str) -> ScenarioGenerationBrief:
    """
    GET /api/v1/apa/training-plan/{plan_id}/scenario-brief using the shared
    service token. Same host as RPE itself — APM and RPE are the same
    FastAPI app today, called over real HTTP anyway (see rpe_client.py's
    docstring for why: it's what a future split into separate services
    would look like, so nothing changes when that happens).
    """
    settings = get_settings()
    base_url = settings.rpe_base_url.rstrip("/")
    url = f"{base_url}/api/v1/apa/training-plan/{plan_id}/scenario-brief"

    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
            resp = await client.get(
                url, headers={"X-Service-Token": settings.apm_service_token}
            )
    except httpx.RequestError as exc:
        raise PlanImportError(f"network error reaching APM: {exc}") from exc

    if resp.status_code != 200:
        raise PlanImportError(
            f"scenario-brief returned {resp.status_code}: {resp.text[:300]}",
            status_code=resp.status_code,
        )
    return ScenarioGenerationBrief.model_validate(resp.json())


async def sync_plan_title(plan_id: str, title: str) -> None:
    """
    PATCH the plan's title_hint to match the scenario's final generated
    title — otherwise the Training Plan page keeps showing the mechanical
    "<Domain> with a <Role>" placeholder forever while the generated
    scenario (and every session played from it) shows a different, more
    specific name. Best-effort and silent on failure: a title cosmetic sync
    must never be able to fail scenario generation itself, so this is called
    after the scenario file is already written, and any error here only
    gets logged.
    """
    settings = get_settings()
    base_url = settings.rpe_base_url.rstrip("/")
    url = f"{base_url}/api/v1/apa/training-plan/{plan_id}/generated-title"

    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
            await client.patch(
                url,
                json={"title": title},
                headers={"X-Service-Token": settings.apm_service_token},
            )
    except httpx.RequestError as exc:
        logger.warning("Failed to sync generated title back to plan %s: %s", plan_id, exc)


def _compress_personality(persona) -> str:
    """counterpart_persona -> RPE's adjective-string npc_personality style."""
    bits = [persona.disposition, persona.communication_style]
    if persona.motivations:
        goals = " and ".join(m.strip().rstrip(".") for m in persona.motivations[:2])
        bits.append(f"wants to {goals}")
    return ", ".join(b.strip().rstrip(".") for b in bits if b)


def _relevant_big_five_traits(profile) -> list[str]:
    """Traits notably high (>0.65) or low (<0.35) — the ones actually shaping this plan."""
    traits = {
        "openness": profile.openness,
        "conscientiousness": profile.conscientiousness,
        "extraversion": profile.extraversion,
        "agreeableness": profile.agreeableness,
        "neuroticism": profile.neuroticism,
    }
    return [name for name, value in traits.items() if value > 0.65 or value < 0.35]


def map_brief_to_scenario(brief: ScenarioGenerationBrief) -> dict:
    """
    Pure, deterministic mapping: ScenarioGenerationBrief -> the dict shape
    persisted as app/models/rpe/scenarios/*.json. No LLM here — opening_npc_line
    is left as an empty-string placeholder, and title/context are only the
    mechanical "<Domain> with a <Role>" hint and the raw brief text, for the
    caller to refine via rpe_llm_service.generate_scenario_prose(); everything
    else is final.

    Scale conversion (verified against rpe_emotion_service.update_escalation's
    clamp and rpe_scenario_service.py's own default, both max(...,5)):
        initial_trust (0.0-1.0)       -> trust_score      int 0-100  (* 100)
        escalation_ceiling (0.0-1.0)  -> escalation_level  int 0-5   (* 5)
    escalation_ceiling is a cap, never a target — nothing derived below may
    exceed it.
    """
    blueprint = brief.blueprint
    seed = blueprint.escalation_seed
    persona = blueprint.counterpart_persona
    profile = brief.learner_profile

    starting_trust = round(seed.initial_trust * 100)
    escalation_cap = round(seed.escalation_ceiling * 5)

    scenario_id = f"plan_{brief.plan_id}"
    recommended_turns = blueprint.target_turn_count
    max_turns = round(recommended_turns * 2)

    context = (
        f"{blueprint.situation_summary} "
        f"Setting: {blueprint.setting.where}. Stakes: {blueprint.stakes}"
    ).strip()

    return {
        "scenario_id": scenario_id,
        "title": blueprint.title_hint,
        "difficulty": brief.pedagogy.difficulty_band,
        "conflict_type": brief.intent.domain,
        "npc_role": persona.role,
        "npc_personality": _compress_personality(persona),
        "context": context,
        "opening_npc_line": "",  # filled in by generate_scenario_prose()
        "recommended_turns": recommended_turns,
        "max_turns": max_turns,
        "end_conditions": {
            "success_trust_threshold": min(100, starting_trust + 20),
            "success_consecutive_turns": 2,
            "failure_escalation_threshold": escalation_cap,
        },
        "success_criteria": {
            "min_trust_score": max(0, starting_trust - 5),
            "max_escalation_level": max(1, escalation_cap - 2),
        },
        "npc_behaviour": {
            "trust_thresholds": {
                "cooperative": min(100, starting_trust + 20),
                "neutral": starting_trust,
                "hostile": 0,
            },
            "escalation_thresholds": {
                "furious": escalation_cap,
                "irritated": max(1, escalation_cap - 2),
                "controlled": 0,
            },
        },
        "apa_metadata": {
            "target_skills": brief.target_skills,
            "big_five_relevance": _relevant_big_five_traits(profile),
            "recommended_for_profile": brief.user_id,
            "difficulty_weight": round(brief.pedagogy.difficulty / 5.0, 2),
            "plan_generated": {
                "plan_id": brief.plan_id,
                "plan_version": brief.plan_version,
                "required_beats": blueprint.required_beats,
                "hidden_concern": persona.hidden_concern,
                "likely_objections": persona.likely_objections,
                "failure_modes": blueprint.failure_modes,
                "formative_checkpoints": brief.pedagogy.formative_checkpoints,
            },
        },
    }


def build_prose_prompt(brief: ScenarioGenerationBrief, mapped: dict) -> str:
    """Prompt for rpe_llm_service.generate_scenario_prose() — the one non-deterministic step."""
    blueprint = brief.blueprint
    persona = blueprint.counterpart_persona
    constraints = "\n".join(f"- {c}" for c in blueprint.content_constraints)
    beats = "\n".join(f"- {b}" for b in blueprint.required_beats)

    return (
        f"You are writing the opening moment of a workplace roleplay training scenario.\n\n"
        f"Situation: {mapped['context']}\n"
        f"NPC: {persona.role}, {mapped['npc_personality']}\n"
        f"Difficulty: {mapped['difficulty']}\n"
        f"Triggering event (an event, NOT a line to paste in verbatim): {blueprint.trigger_event}\n\n"
        f"The scenario must be able to contain these moments over the course of the conversation:\n{beats}\n\n"
        f"Hard content rules — never violate these:\n{constraints}\n\n"
        f"Write:\n"
        f"1. title — a short, specific scenario name (3-6 words) a learner would see on a card in a "
        f"practice library and want to click. Name the actual tension or stakes of THIS situation, not "
        f"a generic label like 'Conflict with a Colleague' or 'Difficult Conversation'. No quotation "
        f"marks, no clickbait punctuation, title case.\n"
        f"2. opening_npc_line — the NPC's actual first spoken line, in character. Keep it short and "
        f"plain, the way a real person actually opens a tense conversation, not a corporate memo — "
        f"no throat-clearing, no stacking three clauses to set up context the scene itself already "
        f"establishes. Scale the length to the difficulty: beginner scenarios get one short, direct "
        f"sentence; intermediate/advanced scenarios may use up to two short sentences only if the "
        f"situation genuinely needs it. Never more than two sentences. Original dialogue consistent "
        f"with the triggering event, not a paraphrase of it.\n"
        f"3. context — a short third-person scene-setting paragraph (2-4 sentences) a game master "
        f"would read before the scene starts. No dialogue in it.\n\n"
        f'Respond ONLY with valid JSON: {{"title": string, "opening_npc_line": string, "context": string}}'
    )


async def generate_and_persist_scenario(plan_id: str) -> str:
    """
    Fetch the brief, map it, generate prose, write the scenario JSON file.
    Returns the new scenario_id. Idempotent per plan_id: re-running for the
    same plan_id overwrites the same file (matches the brief endpoint's own
    "retries are safe" contract — a regenerated plan gets a new plan_id per
    hard rule #4, so this never silently clobbers a different scenario).
    """
    brief = await fetch_scenario_brief(plan_id)
    mapped = map_brief_to_scenario(brief)

    prompt = build_prose_prompt(brief, mapped)
    prose = rpe_llm_service.generate_scenario_prose(
        prompt,
        trigger_event=brief.blueprint.trigger_event,
        situation_summary=brief.blueprint.situation_summary,
        fallback_title=mapped["title"],  # the mechanical "<Domain> with a <Role>" hint
    )
    mapped["title"] = prose.title or _fallback_title(mapped)
    mapped["opening_npc_line"] = prose.opening_npc_line
    mapped["context"] = prose.context or mapped["context"]

    scenario_id = mapped["scenario_id"]
    path = SCENARIOS_DIR / f"{scenario_id}.json"
    path.write_text(json.dumps(mapped, indent=2))
    logger.info("Generated RPE scenario %s from plan %s", scenario_id, plan_id)

    await sync_plan_title(plan_id, mapped["title"])

    return scenario_id
