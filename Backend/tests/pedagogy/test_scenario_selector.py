"""
Tests for scenario_selector.select_scenarios() — hybrid RPE + Gemini logic.

All external calls (RPE HTTP, Gemini) are mocked. The selector must never raise.
"""
import pytest
from unittest.mock import AsyncMock

from app.contracts.rpe import ScenarioDetail, ScenarioSummary
from app.core.llm_client import LLMError
from app.core.rpe_client import RpeClientError
from app.services.pedagogy.scenario_selector import MATCH_THRESHOLD, select_scenarios
from app.services.pedagogy.types import OceanScores, TeachingStrategy

SCORES = OceanScores(
    openness=40, conscientiousness=40, extraversion=25, agreeableness=55, neuroticism=70
)
STRATEGY = TeachingStrategy(
    tone="gentle",
    pacing="slow",
    complexity="simple",
    npc_personality="warm_supportive",
    feedback_style="encouraging",
)
_GEMINI_SCENARIO = {
    "title": "Difficult Conversation",
    "context": "A manager addresses underperformance.",
    "npc_role": "Manager",
    "npc_personality": "direct, professional",
    "opening_npc_line": "We need to talk about your recent work.",
    "recommended_turns": 6,
    "max_turns": 10,
    "target_skills": ["assertiveness", "professional_communication"],
}


def _summary(**kw) -> ScenarioSummary:
    defaults = dict(
        scenario_id="s1", title="T", difficulty="beginner",
        conflict_type="performance", turns=6, recommended_turns=6, max_turns=10,
    )
    defaults.update(kw)
    return ScenarioSummary(**defaults)


def _detail(**kw) -> ScenarioDetail:
    defaults = dict(
        scenario_id="s1", title="T", difficulty="beginner",
        conflict_type="performance", npc_role="Manager",
        npc_personality="firm", context="...", opening_npc_line="Hi",
        recommended_turns=6, max_turns=10,
        target_skills=["assertiveness"],
        apa_metadata={"big_five_relevance": ["neuroticism"], "target_skills": ["assertiveness"]},
    )
    defaults.update(kw)
    return ScenarioDetail(**defaults)



async def test_rpe_good_match_uses_library():
    rpe = AsyncMock()
    rpe.recommend_scenarios.return_value = [_summary()]
    rpe.get_scenario_detail.return_value = _detail()
    llm = AsyncMock()

    result = await select_scenarios(SCORES, STRATEGY, 3, "assertiveness", rpe, llm, user_id="u1")

    assert result.primary_scenario is not None
    assert result.generation_source in ("rpe_library", "rpe_then_gemini")
    llm.generate_json.assert_not_called()



async def test_rpe_unreachable_falls_back_to_gemini():
    rpe = AsyncMock()
    rpe.recommend_scenarios.side_effect = RpeClientError("network error")
    llm = AsyncMock()
    llm.generate_json.return_value = dict(_GEMINI_SCENARIO)

    result = await select_scenarios(SCORES, STRATEGY, 3, "assertiveness", rpe, llm, user_id="u1")

    assert result.generation_source == "gemini_fallback"
    llm.generate_json.assert_called_once()



async def test_rpe_empty_falls_back_to_gemini():
    rpe = AsyncMock()
    rpe.recommend_scenarios.return_value = []
    llm = AsyncMock()
    llm.generate_json.return_value = dict(_GEMINI_SCENARIO)

    result = await select_scenarios(SCORES, STRATEGY, 3, "assertiveness", rpe, llm, user_id="u1")

    assert result.generation_source == "gemini_fallback"



async def test_gemini_also_fails_returns_placeholder():
    """Never raises — returns placeholder when all sources fail."""
    rpe = AsyncMock()
    rpe.recommend_scenarios.side_effect = RpeClientError("down")
    llm = AsyncMock()
    llm.generate_json.side_effect = LLMError("api_error", "Gemini unavailable")

    result = await select_scenarios(SCORES, STRATEGY, 3, "assertiveness", rpe, llm, user_id="u1")

    assert result.primary_scenario is not None
    assert result.generation_source == "gemini_fallback"
    assert result.primary_scenario.get("scenario_id") == "none"



async def test_scenario_id_set_for_gemini_scenario():
    rpe = AsyncMock()
    rpe.recommend_scenarios.side_effect = RpeClientError("down")
    llm = AsyncMock()
    llm.generate_json.return_value = dict(_GEMINI_SCENARIO)

    result = await select_scenarios(SCORES, STRATEGY, 3, "assertiveness", rpe, llm, user_id="abcd1234")

    assert "scenario_id" in result.primary_scenario



async def test_result_has_rationale():
    rpe = AsyncMock()
    rpe.recommend_scenarios.side_effect = RpeClientError("down")
    llm = AsyncMock()
    llm.generate_json.return_value = dict(_GEMINI_SCENARIO)

    result = await select_scenarios(SCORES, STRATEGY, 3, "assertiveness", rpe, llm, user_id="u1")

    assert len(result.rationale) >= 1
