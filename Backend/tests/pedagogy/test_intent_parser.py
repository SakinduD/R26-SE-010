"""
Tests for intent_parser.parse_intent() — LLM parse with a deterministic
rule-based fallback.

The parser must never raise, must never leak raw OCEAN numbers into the
prompt, and must let structured overrides win over LLM output.
"""
import logging
from unittest.mock import AsyncMock, patch

import pytest

from app.core.llm_client import LLMError
from app.services.pedagogy import intent_parser
from app.services.pedagogy.adapter import RPE_SKILL_VOCABULARY

GOAL = "practise pushing back on my manager when scope creeps mid-sprint"

OCEAN_LEVELS = {
    "openness": "mid",
    "conscientiousness": "mid",
    "extraversion": "low",
    "agreeableness": "mid",
    "neuroticism": "high",
}

_LLM_PAYLOAD = {
    "domain": "conflict_resolution",
    "workplace_context": "sprint retro on a 6-person dev team",
    "learner_role": "senior engineer",
    "counterpart_role": "engineering manager",
    "counterpart_disposition": "resistant",
    "desired_focus_skills": ["boundary_setting", "assertiveness"],
    "intensity_preference": "balanced",
    "session_length": "standard",
    "parse_confidence": 0.88,
}


def _llm(payload=None, side_effect=None) -> AsyncMock:
    llm = AsyncMock()
    if side_effect is not None:
        llm.generate_json.side_effect = side_effect
    else:
        llm.generate_json.return_value = dict(payload or _LLM_PAYLOAD)
    return llm


# ---------------------------------------------------------------------------
# LLM success path
# ---------------------------------------------------------------------------


async def test_llm_success_populates_intent():
    intent = await intent_parser.parse_intent(
        GOAL, ocean_levels=OCEAN_LEVELS, llm=_llm()
    )

    assert intent.parse_source == "llm"
    assert intent.domain == "conflict_resolution"
    assert intent.workplace_context == "sprint retro on a 6-person dev team"
    assert intent.counterpart_role == "engineering manager"
    assert intent.counterpart_disposition == "resistant"
    assert intent.desired_focus_skills == ["boundary_setting", "assertiveness"]
    assert intent.parse_confidence == pytest.approx(0.88)
    assert intent.raw_text == GOAL


async def test_llm_skills_constrained_to_rpe_vocabulary():
    """Out-of-vocabulary skills the model invents are dropped, never passed on."""
    payload = dict(_LLM_PAYLOAD)
    payload["desired_focus_skills"] = [
        "assertiveness", "telepathy", "vibes_management"
    ]

    intent = await intent_parser.parse_intent(
        GOAL, ocean_levels=OCEAN_LEVELS, llm=_llm(payload)
    )

    assert intent.desired_focus_skills == ["assertiveness"]
    assert all(s in RPE_SKILL_VOCABULARY for s in intent.desired_focus_skills)


async def test_llm_invalid_enum_falls_back_to_rule_based_value():
    payload = dict(_LLM_PAYLOAD)
    payload["counterpart_disposition"] = "grumpy"   # not in the enum
    payload["session_length"] = "forever"

    intent = await intent_parser.parse_intent(
        GOAL, ocean_levels=OCEAN_LEVELS, llm=_llm(payload)
    )

    assert intent.counterpart_disposition in {
        "supportive", "neutral", "skeptical", "resistant", "distracted"
    }
    assert intent.session_length in {"short", "standard", "extended"}


# ---------------------------------------------------------------------------
# Degradation paths — must never raise
# ---------------------------------------------------------------------------


async def test_malformed_json_falls_back_to_rule_based():
    llm = _llm(side_effect=LLMError("invalid_json", "not json"))

    intent = await intent_parser.parse_intent(
        GOAL, ocean_levels=OCEAN_LEVELS, llm=llm
    )

    assert intent.parse_source == "rule_based"
    assert intent.parse_confidence <= intent_parser.RULE_BASED_MAX_CONFIDENCE


async def test_timeout_falls_back_to_rule_based():
    llm = _llm(side_effect=LLMError("timeout", "timed out after 8.0s"))

    intent = await intent_parser.parse_intent(
        GOAL, ocean_levels=OCEAN_LEVELS, llm=llm
    )

    assert intent.parse_source == "rule_based"
    assert intent.parse_confidence <= intent_parser.RULE_BASED_MAX_CONFIDENCE


async def test_unexpected_exception_falls_back_to_rule_based():
    """Anything the client throws is absorbed — plan generation must not fail."""
    llm = _llm(side_effect=RuntimeError("boom"))

    intent = await intent_parser.parse_intent(
        GOAL, ocean_levels=OCEAN_LEVELS, llm=llm
    )

    assert intent.parse_source == "rule_based"


async def test_no_llm_client_uses_rule_based():
    intent = await intent_parser.parse_intent(
        GOAL, ocean_levels=OCEAN_LEVELS, llm=None
    )

    assert intent.parse_source == "rule_based"


async def test_degradation_logged_at_warning(caplog):
    llm = _llm(side_effect=LLMError("api_error", "no key"))

    with caplog.at_level(logging.WARNING, logger="app.services.pedagogy.intent_parser"):
        await intent_parser.parse_intent(GOAL, ocean_levels=OCEAN_LEVELS, llm=llm)

    assert any(
        "rule_based" in r.message or "rule_based" in r.getMessage()
        for r in caplog.records
    )


# ---------------------------------------------------------------------------
# Rule-based parse quality
# ---------------------------------------------------------------------------


def test_rule_based_is_deterministic():
    a = intent_parser.rule_based_parse(GOAL)
    b = intent_parser.rule_based_parse(GOAL)
    assert a.model_dump() == b.model_dump()


def test_rule_based_reads_domain_and_counterpart_keywords():
    intent = intent_parser.rule_based_parse(GOAL)

    assert intent.domain == "conflict_resolution"   # "scope creep", "pushing back"
    assert intent.counterpart_role == "manager"
    assert all(s in RPE_SKILL_VOCABULARY for s in intent.desired_focus_skills)


def test_rule_based_unmatched_text_gets_low_confidence():
    intent = intent_parser.rule_based_parse(
        "I would like to get generally better at talking to humans somehow"
    )

    assert intent.domain == "other"
    assert intent.parse_confidence <= intent_parser.RULE_BASED_NO_MATCH_CONFIDENCE


# ---------------------------------------------------------------------------
# Structured overrides beat the LLM
# ---------------------------------------------------------------------------


async def test_structured_overrides_beat_llm_output():
    overrides = {
        "domain": "negotiation",
        "counterpart_role": "VP of Product",
        "counterpart_disposition": "skeptical",
        "desired_focus_skills": ["self_advocacy"],
        "intensity_preference": "challenging",
        "session_length": "extended",
    }

    intent = await intent_parser.parse_intent(
        GOAL,
        structured_overrides=overrides,
        ocean_levels=OCEAN_LEVELS,
        llm=_llm(),
    )

    assert intent.parse_source == "llm"          # source still reflects the parse
    assert intent.domain == "negotiation"        # ...but overrides win
    assert intent.counterpart_role == "VP of Product"
    assert intent.counterpart_disposition == "skeptical"
    assert intent.desired_focus_skills == ["self_advocacy"]
    assert intent.intensity_preference == "challenging"
    assert intent.session_length == "extended"


async def test_none_overrides_do_not_clobber_llm_output():
    overrides = {"domain": None, "counterpart_role": None, "focus_skills": None}

    intent = await intent_parser.parse_intent(
        GOAL,
        structured_overrides=overrides,
        ocean_levels=OCEAN_LEVELS,
        llm=_llm(),
    )

    assert intent.domain == "conflict_resolution"
    assert intent.counterpart_role == "engineering manager"


async def test_overrides_survive_the_rule_based_fallback():
    overrides = {"domain": "presentation", "intensity_preference": "gentle"}

    intent = await intent_parser.parse_intent(
        GOAL,
        structured_overrides=overrides,
        ocean_levels=OCEAN_LEVELS,
        llm=_llm(side_effect=LLMError("timeout", "")),
    )

    assert intent.parse_source == "rule_based"
    assert intent.domain == "presentation"
    assert intent.intensity_preference == "gentle"


# ---------------------------------------------------------------------------
# HARD INVARIANT: no raw OCEAN numbers in the prompt
# ---------------------------------------------------------------------------


async def test_prompt_contains_levels_never_raw_ocean_numbers():
    llm = _llm()

    await intent_parser.parse_intent(GOAL, ocean_levels=OCEAN_LEVELS, llm=llm)

    prompt = llm.generate_json.call_args[0][0]

    # Levels must be present...
    assert "neuroticism: high" in prompt
    assert "extraversion: low" in prompt

    # ...and no OCEAN score may appear. Any bare 2-3 digit number would be a
    # score leak; the only digits the template legitimately carries are the
    # single-digit "1-4 strings" range hint.
    import re
    leaked = re.findall(r"\b\d{2,3}(?:\.\d+)?\b", prompt)
    assert leaked == [], f"raw numeric values leaked into the prompt: {leaked}"

    for trait in ("openness", "conscientiousness", "extraversion",
                  "agreeableness", "neuroticism"):
        assert f"{trait}: 7" not in prompt
        assert f"{trait}=" not in prompt


async def test_prompt_omits_levels_safely_when_not_supplied():
    """ocean_levels=None must not crash or invent numbers."""
    llm = _llm()

    await intent_parser.parse_intent(GOAL, ocean_levels=None, llm=llm)

    prompt = llm.generate_json.call_args[0][0]
    assert GOAL in prompt


# ---------------------------------------------------------------------------
# Credential resolution — GEMINI_API_KEY_APM vs GEMINI_API_KEY
# ---------------------------------------------------------------------------


def _fresh_key_resolution():
    """Clear the cached settings + client so env changes take effect."""
    from app.config import get_settings
    from app.core.llm_client import get_apm_llm_client

    get_settings.cache_clear()
    get_apm_llm_client.cache_clear()


def test_apm_key_used_when_set(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY_APM", "apm-specific-key")
    monkeypatch.setenv("GEMINI_API_KEY", "shared-mca-key")
    _fresh_key_resolution()

    from app.config import get_apm_gemini_key
    from app.core.llm_client import get_apm_llm_client

    try:
        assert get_apm_gemini_key() == "apm-specific-key"
        client = get_apm_llm_client()
        assert client._api_key == "apm-specific-key"
    finally:
        _fresh_key_resolution()


def test_falls_back_to_shared_key_with_warning(monkeypatch, caplog):
    monkeypatch.delenv("GEMINI_API_KEY_APM", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "shared-mca-key")
    _fresh_key_resolution()

    from app.config import get_apm_gemini_key
    from app.core.llm_client import get_apm_llm_client

    try:
        with caplog.at_level(logging.WARNING, logger="app.config"):
            key = get_apm_gemini_key()

        assert key == "shared-mca-key"
        assert any(
            "GEMINI_API_KEY_APM not set" in r.getMessage() for r in caplog.records
        ), "expected a single fallback warning"

        # The client still works, credentialed with the shared key.
        assert get_apm_llm_client()._api_key == "shared-mca-key"
    finally:
        _fresh_key_resolution()


def test_neither_key_set_does_not_raise(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY_APM", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    _fresh_key_resolution()

    from app.config import get_apm_gemini_key
    from app.core.llm_client import get_apm_llm_client

    try:
        assert get_apm_gemini_key() == ""
        assert get_apm_llm_client()._api_key == ""    # constructed, not raised
    finally:
        _fresh_key_resolution()


async def test_unconfigured_key_degrades_to_rule_based(monkeypatch):
    """
    With no key at all, GeminiClient raises LLMError on first use and the
    parser degrades — parse_source == "rule_based", no exception escapes.
    """
    monkeypatch.delenv("GEMINI_API_KEY_APM", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    _fresh_key_resolution()

    from app.core.llm_client import get_apm_llm_client

    try:
        intent = await intent_parser.parse_intent(
            GOAL, ocean_levels=OCEAN_LEVELS, llm=get_apm_llm_client()
        )
        assert intent.parse_source == "rule_based"
        assert intent.parse_confidence <= intent_parser.RULE_BASED_MAX_CONFIDENCE
    finally:
        _fresh_key_resolution()
