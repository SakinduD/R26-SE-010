"""
Hybrid Scenario Selector.

Strategy:
    1. Convert OceanScores 0-100 → ApaLearnerProfile 0.0-1.0 via adapter.
    2. Call RPE /apa/recommend.
    3. Score each returned scenario for fit (skill overlap, difficulty match,
       trait relevance — weights in named constants).
    4. If best match_score >= MATCH_THRESHOLD → use RPE library.
    5. Else → call Gemini to generate ONE scenario in ScenarioDetail-compatible
       shape. If Gemini fails → return best RPE scenario with a warning in
       rationale.

No raw OCEAN numbers go into the Gemini prompt — only low/mid/high levels.
Never raises: always returns a ScenarioSelectionResult.
"""
from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel, Field

from app.contracts.rpe import ScenarioDetail, ScenarioSummary
from app.core.llm_client import GeminiClient, LLMError
from app.core.rpe_client import RpeClient, RpeClientError
from app.services.pedagogy.adapter import (
    difficulty_int_to_label,
    infer_weak_skills,
    to_rpe_profile,
)
from app.services.pedagogy.types import OceanScores, TeachingStrategy

logger = logging.getLogger(__name__)

# match-score weights (sum to 1.0)
MATCH_WEIGHT_SKILL_OVERLAP = 0.5
MATCH_WEIGHT_DIFFICULTY = 0.3
MATCH_WEIGHT_TRAIT = 0.2

MATCH_THRESHOLD = 0.6   # below this → Gemini fallback
TOP_N_RECOMMENDED = 3

GenerationSource = Literal[
    "rpe_library", "gemini_fallback", "rpe_then_gemini"
]


class ScenarioSelectionResult(BaseModel):
    primary_scenario: dict
    recommended_scenario_ids: list[str] = Field(default_factory=list)
    match_score: float = 0.0
    generation_source: GenerationSource
    rationale: list[str] = Field(default_factory=list)


def _ocean_level(score: float) -> str:
    if score < 40:
        return "low"
    if score > 60:
        return "high"
    return "mid"


def _difficulty_match_score(scenario_difficulty: str, plan_label: str) -> float:
    """1.0 if exact label match, 0.5 if adjacent band, 0.0 otherwise."""
    if scenario_difficulty == plan_label:
        return 1.0
    order = ["beginner", "intermediate", "advanced"]
    try:
        return (
            0.5
            if abs(order.index(scenario_difficulty) - order.index(plan_label))
            == 1
            else 0.0
        )
    except ValueError:
        return 0.0


def _trait_relevance_score(
    big_five_relevance: list[str], scores: OceanScores
) -> float:
    """
    Boost scenarios whose big_five_relevance traits are extreme on the user.
    Returns 0..1: average of |trait_value - 50| / 50 across relevant traits.
    """
    if not big_five_relevance:
        return 0.5
    name_to_value = {
        "openness": scores.openness,
        "conscientiousness": scores.conscientiousness,
        "extraversion": scores.extraversion,
        "agreeableness": scores.agreeableness,
        "neuroticism": scores.neuroticism,
    }
    values: list[float] = []
    for trait in big_five_relevance:
        v = name_to_value.get(trait.lower())
        if v is not None:
            values.append(abs(v - 50) / 50.0)
    return sum(values) / len(values) if values else 0.5


def _score_scenario(
    summary: ScenarioSummary,
    detail: ScenarioDetail | None,
    scores: OceanScores,
    weak_skills: list[str],
    difficulty_label: str,
) -> float:
    """Compute match_score in [0, 1]."""
    target_skills: list[str] = []
    big_five_relevance: list[str] = []
    if detail:
        target_skills = list(detail.target_skills) or list(
            detail.apa_metadata.get("target_skills", []) or []
        )
        big_five_relevance = list(
            detail.apa_metadata.get("big_five_relevance", []) or []
        )

    skill_overlap = 0.0
    if weak_skills and target_skills:
        weak_set = {s.lower() for s in weak_skills}
        target_set = {s.lower() for s in target_skills}
        skill_overlap = len(weak_set & target_set) / max(1, len(weak_set))

    difficulty_match = _difficulty_match_score(
        summary.difficulty, difficulty_label
    )
    trait_relevance = _trait_relevance_score(big_five_relevance, scores)

    return (
        MATCH_WEIGHT_SKILL_OVERLAP * skill_overlap
        + MATCH_WEIGHT_DIFFICULTY * difficulty_match
        + MATCH_WEIGHT_TRAIT * trait_relevance
    )


def _build_gemini_prompt(
    scores: OceanScores,
    strategy: TeachingStrategy,
    difficulty: int,
    skill: str,
) -> str:
    return f"""You are designing a soft-skill role-play scenario for a learner. Return ONLY a single JSON object — no prose, no markdown.

Learner profile (LEVEL ONLY, no raw scores):
  openness: {_ocean_level(scores.openness)}
  conscientiousness: {_ocean_level(scores.conscientiousness)}
  extraversion: {_ocean_level(scores.extraversion)}
  agreeableness: {_ocean_level(scores.agreeableness)}
  neuroticism: {_ocean_level(scores.neuroticism)}

Teaching strategy:
  tone: {strategy.tone}
  pacing: {strategy.pacing}
  complexity: {strategy.complexity}
  npc_personality: {strategy.npc_personality}
  feedback_style: {strategy.feedback_style}

Skill focus: {skill}
Difficulty: {difficulty_int_to_label(difficulty)} (numeric: {difficulty}/10)

Required JSON shape (all fields must be present):
{{
  "title": "<short scenario title>",
  "context": "<one paragraph setting up the scene>",
  "npc_role": "<role of the AI character>",
  "npc_personality": "<two or three adjectives>",
  "opening_npc_line": "<the very first line the NPC says>",
  "recommended_turns": <int 4-10>,
  "max_turns": <int recommended_turns..20>,
  "target_skills": [<3 skill name strings>]
}}
"""


async def select_scenarios(
    profile: OceanScores,
    strategy: TeachingStrategy,
    difficulty: int,
    skill: str,
    rpe: RpeClient,
    llm: GeminiClient,
    *,
    user_id: str,
) -> ScenarioSelectionResult:
    """
    Hybrid scenario selection. Never raises.

    Returns:
      ScenarioSelectionResult with generation_source set to whichever path
      succeeded. On total failure, primary_scenario is a placeholder shell
      and the orchestrator should mark generation_status='scenario_failed'.
    """
    rationale: list[str] = []
    weak_skills = infer_weak_skills(profile, strategy)
    difficulty_label = difficulty_int_to_label(difficulty)
    rationale.append(
        f"Inferred weak_skills={weak_skills or '[]'}; "
        f"difficulty={difficulty} → {difficulty_label}"
    )

    rpe_profile = to_rpe_profile(
        profile, weak_skills, difficulty, user_id=user_id
    )

    # Step 2: RPE
    try:
        summaries: list[ScenarioSummary] = await rpe.recommend_scenarios(
            rpe_profile
        )
        rationale.append(f"RPE returned {len(summaries)} candidate scenarios")
    except RpeClientError as exc:
        rationale.append(
            f"RPE recommend failed: {exc} — trying Gemini-only fallback"
        )
        return await _gemini_only_fallback(
            profile, strategy, difficulty, skill, llm, rationale
        )

    if not summaries:
        rationale.append(
            "RPE returned 0 scenarios — trying Gemini-only fallback"
        )
        return await _gemini_only_fallback(
            profile, strategy, difficulty, skill, llm, rationale
        )

    # Step 3: score
    scored: list[tuple[float, ScenarioSummary, ScenarioDetail | None]] = []
    for s in summaries:
        try:
            detail = await rpe.get_scenario_detail(s.scenario_id)
        except RpeClientError as exc:
            logger.debug("scenario_detail %s failed: %s", s.scenario_id, exc)
            detail = None
        score = _score_scenario(
            s, detail, profile, weak_skills, difficulty_label
        )
        scored.append((score, s, detail))

    scored.sort(key=lambda t: t[0], reverse=True)
    best_score, best_summary, best_detail = scored[0]
    rationale.append(
        f"Best match: {best_summary.scenario_id} (score={best_score:.2f}, "
        f"threshold={MATCH_THRESHOLD})"
    )

    # Step 4: decide library vs Gemini
    if best_score >= MATCH_THRESHOLD:
        scenario_dict = (
            best_detail.model_dump() if best_detail else best_summary.model_dump()
        )
        return ScenarioSelectionResult(
            primary_scenario=scenario_dict,
            recommended_scenario_ids=[
                s.scenario_id for _, s, _ in scored[:TOP_N_RECOMMENDED]
            ],
            match_score=best_score,
            generation_source="rpe_library",
            rationale=rationale,
        )

    # Step 5: Gemini fallback
    rationale.append(
        f"match_score {best_score:.2f} < {MATCH_THRESHOLD} — calling Gemini"
    )
    try:
        gemini_scenario = await llm.generate_json(
            _build_gemini_prompt(profile, strategy, difficulty, skill)
        )
        for required in ("title", "context", "npc_role", "opening_npc_line"):
            if required not in gemini_scenario:
                raise LLMError(
                    "invalid_json", f"missing required field: {required}"
                )
        gemini_scenario.setdefault(
            "scenario_id", f"gemini_{user_id[:8]}"
        )
        gemini_scenario.setdefault("difficulty", difficulty_label)
        gemini_scenario.setdefault("conflict_type", "generated")
        rationale.append("Gemini generated a personalised scenario")
        return ScenarioSelectionResult(
            primary_scenario=gemini_scenario,
            recommended_scenario_ids=[
                s.scenario_id for _, s, _ in scored[:TOP_N_RECOMMENDED]
            ],
            match_score=best_score,
            generation_source="rpe_then_gemini",
            rationale=rationale,
        )
    except LLMError as exc:
        rationale.append(
            f"Gemini failed ({exc.reason}) — using best RPE scenario as warning"
        )
        scenario_dict = (
            best_detail.model_dump() if best_detail else best_summary.model_dump()
        )
        return ScenarioSelectionResult(
            primary_scenario=scenario_dict,
            recommended_scenario_ids=[
                s.scenario_id for _, s, _ in scored[:TOP_N_RECOMMENDED]
            ],
            match_score=best_score,
            generation_source="rpe_library",
            rationale=rationale,
        )


async def _gemini_only_fallback(
    profile: OceanScores,
    strategy: TeachingStrategy,
    difficulty: int,
    skill: str,
    llm: GeminiClient,
    rationale: list[str],
) -> ScenarioSelectionResult:
    """Used when RPE itself is unreachable or returns nothing."""
    try:
        gemini_scenario = await llm.generate_json(
            _build_gemini_prompt(profile, strategy, difficulty, skill)
        )
        gemini_scenario.setdefault("scenario_id", "gemini_only")
        gemini_scenario.setdefault(
            "difficulty", difficulty_int_to_label(difficulty)
        )
        gemini_scenario.setdefault("conflict_type", "generated")
        rationale.append("Gemini-only fallback succeeded")
        return ScenarioSelectionResult(
            primary_scenario=gemini_scenario,
            recommended_scenario_ids=[],
            match_score=0.0,
            generation_source="gemini_fallback",
            rationale=rationale,
        )
    except LLMError as exc:
        rationale.append(f"Gemini-only fallback also failed: {exc.reason}")
        return ScenarioSelectionResult(
            primary_scenario={
                "scenario_id": "none",
                "title": "(no scenario generated)",
                "difficulty": difficulty_int_to_label(difficulty),
                "context": "Scenario generation failed — please regenerate.",
            },
            recommended_scenario_ids=[],
            match_score=0.0,
            generation_source="gemini_fallback",
            rationale=rationale,
        )
