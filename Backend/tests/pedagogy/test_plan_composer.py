"""
Tests for plan_composer.compose_plan() — the pure plan-assembly function.

compose_plan does no I/O and takes no clock, so every assertion here is exact
rather than approximate. If any of these become flaky, something impure was
introduced into the composer.
"""
import pytest

from app.contracts.training_plan import (
    AdaptationRules,
    PedagogyDirectives,
    ScenarioBlueprint,
)
from app.schemas.training_plan import LearnerIntent
from app.services.pedagogy.adapter import RPE_SKILL_VOCABULARY
from app.services.pedagogy.plan_composer import (
    MAX_PRESSURE,
    MIN_PRESSURE,
    compose_plan,
    ocean_levels,
)
from app.services.pedagogy.types import BaselineSummary, OceanScores, TeachingStrategy

# --- fixtures as plain constants (everything here is a pure function) --------

ANXIOUS_INTROVERT = OceanScores(
    openness=40, conscientiousness=40, extraversion=25, agreeableness=55,
    neuroticism=70,
)
CONFIDENT_EXTROVERT = OceanScores(
    openness=65, conscientiousness=70, extraversion=80, agreeableness=55,
    neuroticism=30,
)
MID_RANGE = OceanScores(
    openness=50, conscientiousness=50, extraversion=50, agreeableness=50,
    neuroticism=50,
)

GENTLE_STRATEGY = TeachingStrategy(
    tone="gentle", pacing="slow", complexity="simple",
    npc_personality="warm_supportive", feedback_style="encouraging",
)
DIRECT_STRATEGY = TeachingStrategy(
    tone="direct", pacing="moderate", complexity="moderate",
    npc_personality="professional", feedback_style="balanced",
)


def _intent(**kw) -> LearnerIntent:
    defaults = dict(
        raw_text="practise pushing back on my manager when scope creeps mid-sprint",
        domain="conflict_resolution",
        workplace_context="sprint retro on a 6-person dev team",
        learner_role="senior engineer",
        counterpart_role="engineering manager",
        counterpart_disposition="resistant",
        desired_focus_skills=["boundary_setting", "assertiveness"],
        intensity_preference="balanced",
        session_length="standard",
        parse_confidence=0.85,
        parse_source="llm",
    )
    defaults.update(kw)
    return LearnerIntent(**defaults)


def _compose(**kw) -> dict:
    args = dict(
        intent=_intent(),
        ocean=MID_RANGE,
        strategy=DIRECT_STRATEGY,
        difficulty=5,
        baseline=None,
        target_skills=["boundary_setting", "assertiveness"],
    )
    args.update(kw)
    return compose_plan(**args)


# ---------------------------------------------------------------------------
# Purity / determinism
# ---------------------------------------------------------------------------


def test_same_inputs_produce_identical_output():
    a = _compose()
    b = _compose()
    assert a == b


def test_output_validates_against_the_contract_models():
    plan = _compose()
    # Round-tripping through the contract models is what RPE will do.
    ScenarioBlueprint(**plan["blueprint"])
    PedagogyDirectives(**plan["pedagogy"])
    AdaptationRules(**plan["adaptation"])


def test_blueprint_carries_no_dialogue_fields():
    """APM describes the scenario; RPE writes it. No NPC lines here."""
    blueprint = _compose()["blueprint"]
    forbidden = {"opening_npc_line", "npc_lines", "dialogue", "script", "lines"}
    assert forbidden.isdisjoint(blueprint.keys())


# ---------------------------------------------------------------------------
# High Neuroticism → safety-first escalation seed
# ---------------------------------------------------------------------------


def test_high_neuroticism_lowers_ceiling_and_raises_trust():
    anxious = _compose(ocean=ANXIOUS_INTROVERT, strategy=GENTLE_STRATEGY)
    calm = _compose(ocean=CONFIDENT_EXTROVERT, strategy=DIRECT_STRATEGY)

    a_seed = anxious["blueprint"]["escalation_seed"]
    c_seed = calm["blueprint"]["escalation_seed"]

    assert a_seed["initial_trust"] > c_seed["initial_trust"]
    assert a_seed["escalation_ceiling"] < c_seed["escalation_ceiling"]


def test_neuroticism_effect_holds_with_everything_else_equal():
    """Isolate N: identical inputs except the neuroticism score."""
    low_n = OceanScores(openness=50, conscientiousness=50, extraversion=50,
                        agreeableness=50, neuroticism=30)
    high_n = OceanScores(openness=50, conscientiousness=50, extraversion=50,
                         agreeableness=50, neuroticism=75)

    a = _compose(ocean=low_n)["blueprint"]["escalation_seed"]
    b = _compose(ocean=high_n)["blueprint"]["escalation_seed"]

    assert b["initial_trust"] > a["initial_trust"]
    assert b["escalation_ceiling"] < a["escalation_ceiling"]


def test_escalation_seed_stays_in_range():
    for ocean in (ANXIOUS_INTROVERT, CONFIDENT_EXTROVERT, MID_RANGE):
        for disposition in ("supportive", "neutral", "skeptical",
                            "resistant", "distracted"):
            for difficulty in range(1, 11):
                seed = _compose(
                    ocean=ocean,
                    difficulty=difficulty,
                    intent=_intent(counterpart_disposition=disposition),
                )["blueprint"]["escalation_seed"]
                assert 0.0 <= seed["initial_trust"] <= 1.0
                assert 0.0 <= seed["escalation_ceiling"] <= 1.0


def test_escalation_seed_feeds_the_rpe_fsm_with_trigger_lists():
    seed = _compose()["blueprint"]["escalation_seed"]
    assert len(seed["de_escalation_triggers"]) >= 2
    assert len(seed["escalation_triggers"]) >= 2


# ---------------------------------------------------------------------------
# difficulty + intensity → pressure_level
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "difficulty,intensity,expected",
    [
        (1, "balanced", 1),
        (2, "balanced", 1),
        (4, "balanced", 2),
        (6, "balanced", 3),
        (8, "balanced", 4),
        (10, "balanced", 5),
        # intensity nudges one step, then clamps
        (6, "gentle", 2),
        (6, "challenging", 4),
        (1, "gentle", 1),          # clamps at the floor
        (10, "challenging", 5),    # clamps at the ceiling
    ],
)
def test_pressure_level_mapping(difficulty, intensity, expected):
    plan = _compose(
        difficulty=difficulty,
        intent=_intent(intensity_preference=intensity),
    )
    assert plan["blueprint"]["pressure_level"] == expected


def test_pressure_level_always_within_bounds():
    for difficulty in range(1, 11):
        for intensity in ("gentle", "balanced", "challenging"):
            level = _compose(
                difficulty=difficulty,
                intent=_intent(intensity_preference=intensity),
            )["blueprint"]["pressure_level"]
            assert MIN_PRESSURE <= level <= MAX_PRESSURE


def test_higher_difficulty_never_lowers_pressure():
    levels = [
        _compose(difficulty=d)["blueprint"]["pressure_level"]
        for d in range(1, 11)
    ]
    assert levels == sorted(levels)


# ---------------------------------------------------------------------------
# session_length → turn count
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "session_length,turns", [("short", 5), ("standard", 8), ("extended", 12)]
)
def test_session_length_sets_turn_count(session_length, turns):
    blueprint = _compose(
        intent=_intent(session_length=session_length)
    )["blueprint"]

    assert blueprint["target_turn_count"] == turns
    assert blueprint["est_duration_minutes"] == turns * 2


# ---------------------------------------------------------------------------
# strategy.scaffolding → support_level / hint_policy
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "complexity,support", [("simple", "high"), ("moderate", "moderate"),
                           ("complex", "low")],
)
def test_complexity_drives_support_level(complexity, support):
    strategy = DIRECT_STRATEGY.model_copy(update={"complexity": complexity})
    pedagogy = _compose(strategy=strategy)["pedagogy"]

    assert pedagogy["support_level"] == support
    assert pedagogy["hint_policy"]


def test_pedagogy_carries_the_existing_teaching_strategy_verbatim():
    pedagogy = _compose(strategy=GENTLE_STRATEGY)["pedagogy"]
    assert pedagogy["teaching_strategy"] == GENTLE_STRATEGY.model_dump()


@pytest.mark.parametrize(
    "difficulty,band,kolb",
    [
        (3, "beginner", "concrete_experience"),
        (6, "intermediate", "reflective_observation"),
        (9, "advanced", "active_experimentation"),
    ],
)
def test_difficulty_band_and_kolb_stage(difficulty, band, kolb):
    pedagogy = _compose(difficulty=difficulty)["pedagogy"]
    assert pedagogy["difficulty_band"] == band
    assert pedagogy["kolb_stage_focus"] == kolb


def test_zpd_rationale_mentions_baseline_evidence_when_present():
    baseline = BaselineSummary(
        has_baseline=True, stress_indicator=0.72, confidence_indicator=0.18,
        skill_scores={"assertiveness": 0.25},
    )
    with_baseline = _compose(baseline=baseline)["pedagogy"]["zpd_rationale"]
    without = _compose(baseline=None)["pedagogy"]["zpd_rationale"]

    assert "baseline" in with_baseline.lower()
    assert "no baseline" in without.lower()


# ---------------------------------------------------------------------------
# target skills stay inside RPE's vocabulary
# ---------------------------------------------------------------------------


def test_required_beats_count_is_three_to_five():
    for skills in ([], ["assertiveness"], sorted(RPE_SKILL_VOCABULARY)):
        beats = _compose(target_skills=skills)["blueprint"]["required_beats"]
        assert 3 <= len(beats) <= 5


def test_composer_tolerates_the_entire_vocabulary():
    """Every RPE skill must be a legal target skill for the composer."""
    plan = _compose(target_skills=sorted(RPE_SKILL_VOCABULARY))
    ScenarioBlueprint(**plan["blueprint"])
    assert plan["blueprint"]["success_criteria"]
    assert plan["blueprint"]["failure_modes"]


def test_content_constraints_always_present():
    constraints = _compose()["blueprint"]["content_constraints"]
    joined = " ".join(constraints).lower()

    assert "workplace-appropriate" in joined
    assert "protected characteristic" in joined
    assert "trauma" in joined


# ---------------------------------------------------------------------------
# adaptation rules
# ---------------------------------------------------------------------------


def test_adaptation_defaults_lock_strategy_and_cap_delta():
    adaptation = _compose()["adaptation"]
    assert adaptation["max_difficulty_delta"] == 1
    assert adaptation["strategy_locked_during_session"] is True
    assert adaptation["allow_live_nudges"] is True
    assert adaptation["abort_conditions"]


def test_high_neuroticism_adds_an_earlier_soften_trigger():
    calm = _compose(ocean=CONFIDENT_EXTROVERT)["adaptation"]
    anxious = _compose(ocean=ANXIOUS_INTROVERT)["adaptation"]

    assert len(anxious["soften_on"]) > len(calm["soften_on"])


# ---------------------------------------------------------------------------
# ocean_levels helper — the only personality representation allowed out
# ---------------------------------------------------------------------------


def test_ocean_levels_returns_only_low_mid_high():
    levels = ocean_levels(ANXIOUS_INTROVERT)

    assert set(levels) == {
        "openness", "conscientiousness", "extraversion",
        "agreeableness", "neuroticism",
    }
    assert set(levels.values()) <= {"low", "mid", "high"}
    assert levels["neuroticism"] == "high"
    assert levels["extraversion"] == "low"
    assert levels["openness"] == "mid"
