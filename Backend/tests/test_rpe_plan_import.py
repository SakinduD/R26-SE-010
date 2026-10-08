"""
Unit tests for the APM Training Plan -> RPE scenario mapper.

map_brief_to_scenario() is pure and deterministic (no LLM, no I/O) — these
tests exercise it directly against the worked example from
Backend/docs/RPE_SCENARIO_GENERATION_HANDOFF.md §9, plus the scale-conversion
behaviour called out in that doc's suggested build order (§8.3): a
high-Neuroticism brief should yield higher starting trust and a lower
escalation cap than a low-Neuroticism one.
"""
import copy

from app.contracts.training_plan import ScenarioGenerationBrief
from app.services.rpe_plan_import_service import map_brief_to_scenario

_WORKED_EXAMPLE: dict = {
    "schema_version": "1.0.0",
    "plan_id": "7407b66e-c239-4686-bdff-d5bc174bc413",
    "plan_version": 1,
    "user_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "generated_at": "2026-08-10T09:30:00+00:00",
    "learner_profile": {
        "user_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "openness": 0.45,
        "conscientiousness": 0.55,
        "extraversion": 0.25,
        "agreeableness": 0.6,
        "neuroticism": 0.72,
        "weak_skills": ["boundary_setting", "assertiveness", "emotional_regulation", "self_advocacy"],
        "recommended_difficulty": "beginner",
    },
    "intent": {
        "raw_text": "practise pushing back on my manager when scope creeps mid-sprint",
        "domain": "conflict_resolution",
        "workplace_context": "sprint retro on a 6-person dev team",
        "learner_role": "senior engineer",
        "counterpart_role": "engineering manager",
        "counterpart_disposition": "resistant",
        "desired_focus_skills": ["boundary_setting", "assertiveness"],
        "intensity_preference": "balanced",
        "session_length": "standard",
        "parse_confidence": 0.88,
        "parse_source": "llm",
    },
    "blueprint": {
        "title_hint": "Conflict Resolution with an engineering manager",
        "medium": "in_person",
        "setting": {
            "where": "sprint retro on a 6-person dev team",
            "when": "During normal working hours, at a point where the issue can no longer be deferred",
            "who_else_present": ["No one — the conversation is one-to-one"],
        },
        "situation_summary": "The learner is a senior engineer working through a conflict resolution situation.",
        "learner_role": "senior engineer",
        "learner_objective": "Hold a productive conversation that ends with a concrete next step agreed",
        "counterpart_persona": {
            "role": "engineering manager",
            "disposition": "resistant",
            "motivations": ["Protect their own priorities", "Be seen as reasonable"],
            "likely_objections": ["This has been handled the same way before without complaint"],
            "communication_style": "Resistant and businesslike",
            "hidden_concern": "They are under pressure themselves and have less room to move than they admit",
        },
        "stakes": "The working relationship and the learner's credibility both matter here",
        "pressure_level": 1,
        "trigger_event": "The engineering manager raises the issue at the start of the conversation",
        "required_beats": [
            "The counterpart states their position",
            "The learner is given a clear opening to state their own position",
        ],
        "success_criteria": ["Learner states their position explicitly at least once, without hedging"],
        "failure_modes": ["Learner agrees to everything to end the discomfort"],
        "content_constraints": ["Stay workplace-appropriate at all times", "No profanity, slurs, threats or intimidation"],
        "target_turn_count": 8,
        "est_duration_minutes": 16,
        "escalation_seed": {
            "initial_trust": 0.45,
            "escalation_ceiling": 0.5,
            "de_escalation_triggers": ["learner proposes a concrete, dated alternative"],
            "escalation_triggers": ["learner concedes the point without stating their position"],
        },
    },
    "pedagogy": {
        "teaching_strategy": {
            "tone": "gentle", "pacing": "slow", "complexity": "moderate",
            "npc_personality": "warm_supportive", "feedback_style": "encouraging",
            "rationale": [], "priority_skills": [],
        },
        "difficulty": 2,
        "difficulty_band": "beginner",
        "support_level": "moderate",
        "hint_policy": "on_request",
        "zpd_rationale": "Set at beginner (2/10).",
        "kolb_stage_focus": "concrete_experience",
        "formative_checkpoints": ["After the opening exchange: did the learner state a position?"],
    },
    "adaptation": {
        "allow_live_nudges": True,
        "max_difficulty_delta": 1,
        "strategy_locked_during_session": True,
        "soften_on": ["stress_score > 0.7"],
        "escalate_on": ["engagement_score > 0.75 AND stress_score < 0.3"],
        "abort_conditions": ["stress_score > 0.9"],
    },
    "target_skills": ["boundary_setting", "assertiveness", "emotional_regulation", "self_advocacy"],
    "consumed_at": None,
}


def _brief(**overrides) -> ScenarioGenerationBrief:
    data = copy.deepcopy(_WORKED_EXAMPLE)
    data.update(overrides)
    return ScenarioGenerationBrief.model_validate(data)


def test_mapper_is_deterministic():
    brief = _brief()
    first = map_brief_to_scenario(brief)
    second = map_brief_to_scenario(brief)
    assert first == second


def test_mapper_field_mapping_against_worked_example():
    brief = _brief()
    scenario = map_brief_to_scenario(brief)

    assert scenario["scenario_id"] == f"plan_{brief.plan_id}"
    assert scenario["title"] == "Conflict Resolution with an engineering manager"
    assert scenario["difficulty"] == "beginner"
    assert scenario["conflict_type"] == "conflict_resolution"
    assert scenario["npc_role"] == "engineering manager"
    assert scenario["recommended_turns"] == 8
    assert scenario["max_turns"] == 16  # ~2x recommended, per doc §4
    # opening_npc_line is intentionally left blank by the mapper — the LLM
    # step fills it in, never the mapper (doc hard rule: no dialogue from APM,
    # and no LLM in the deterministic mapper either).
    assert scenario["opening_npc_line"] == ""


def test_mapper_never_puts_dialogue_source_fields_verbatim_into_opening_line():
    """trigger_event is an event, not a line (hard rule #3) — mapper must not paste it in."""
    brief = _brief()
    scenario = map_brief_to_scenario(brief)
    assert brief.blueprint.trigger_event not in scenario["opening_npc_line"]


def test_scale_conversion_matches_worked_example():
    """initial_trust 0.45 -> 45, escalation_ceiling 0.5 -> 2 (round(0.5*5))."""
    brief = _brief()
    scenario = map_brief_to_scenario(brief)

    assert scenario["success_criteria"]["min_trust_score"] == 40  # 45 - 5
    assert scenario["end_conditions"]["success_trust_threshold"] == 65  # 45 + 20
    assert scenario["end_conditions"]["failure_escalation_threshold"] == 2  # round(0.5 * 5)
    assert scenario["success_criteria"]["max_escalation_level"] == 1  # cap - 2, floored at 1


def test_escalation_ceiling_is_never_exceeded_by_any_derived_threshold():
    """escalation_ceiling is a cap, not a target (doc §5) — nothing derived may exceed it."""
    brief = _brief()
    scenario = map_brief_to_scenario(brief)
    cap = round(brief.blueprint.escalation_seed.escalation_ceiling * 5)

    assert scenario["end_conditions"]["failure_escalation_threshold"] <= cap
    assert scenario["success_criteria"]["max_escalation_level"] <= cap
    assert scenario["npc_behaviour"]["escalation_thresholds"]["furious"] <= cap


def test_high_neuroticism_yields_higher_trust_and_lower_escalation_cap():
    """
    Safety-first rule from doc §5: a high-Neuroticism learner gets a
    deliberately low escalation ceiling and a raised initial trust. Simulate
    what APM would send for a low-Neuroticism learner with the opposite seed
    and confirm the mapper preserves that relationship rather than flattening it.
    """
    high_neuroticism_brief = _brief()  # initial_trust=0.45, escalation_ceiling=0.5 (from worked example)

    low_neuroticism_data = copy.deepcopy(_WORKED_EXAMPLE)
    low_neuroticism_data["learner_profile"]["neuroticism"] = 0.2
    low_neuroticism_data["blueprint"]["escalation_seed"]["initial_trust"] = 0.3
    low_neuroticism_data["blueprint"]["escalation_seed"]["escalation_ceiling"] = 0.9
    low_neuroticism_brief = ScenarioGenerationBrief.model_validate(low_neuroticism_data)

    high_scenario = map_brief_to_scenario(high_neuroticism_brief)
    low_scenario = map_brief_to_scenario(low_neuroticism_brief)

    high_starting_trust = high_scenario["npc_behaviour"]["trust_thresholds"]["neutral"]
    low_starting_trust = low_scenario["npc_behaviour"]["trust_thresholds"]["neutral"]
    assert high_starting_trust > low_starting_trust

    high_cap = high_scenario["end_conditions"]["failure_escalation_threshold"]
    low_cap = low_scenario["end_conditions"]["failure_escalation_threshold"]
    assert high_cap < low_cap


def test_apa_metadata_carries_fields_with_no_home_in_scenario_detail():
    """required_beats, hidden_concern, likely_objections, failure_modes, formative_checkpoints
    have no dedicated ScenarioDetail field (doc §4) — must be preserved in apa_metadata, not dropped."""
    brief = _brief()
    scenario = map_brief_to_scenario(brief)
    plan_generated = scenario["apa_metadata"]["plan_generated"]

    assert plan_generated["required_beats"] == brief.blueprint.required_beats
    assert plan_generated["hidden_concern"] == brief.blueprint.counterpart_persona.hidden_concern
    assert plan_generated["likely_objections"] == brief.blueprint.counterpart_persona.likely_objections
    assert plan_generated["failure_modes"] == brief.blueprint.failure_modes
    assert plan_generated["formative_checkpoints"] == brief.pedagogy.formative_checkpoints
    assert scenario["apa_metadata"]["target_skills"] == brief.target_skills


def test_scenario_id_changes_when_plan_id_changes():
    """Hard rule #4: plan_id changes on regenerate — scenario_id must track it, never collide."""
    brief_v1 = _brief()
    data_v2 = copy.deepcopy(_WORKED_EXAMPLE)
    data_v2["plan_id"] = "a-different-plan-id"
    data_v2["plan_version"] = 2
    brief_v2 = ScenarioGenerationBrief.model_validate(data_v2)

    scenario_v1 = map_brief_to_scenario(brief_v1)
    scenario_v2 = map_brief_to_scenario(brief_v2)
    assert scenario_v1["scenario_id"] != scenario_v2["scenario_id"]
