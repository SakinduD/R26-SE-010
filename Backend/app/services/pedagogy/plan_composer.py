"""
Plan Composer — PURE function that assembles a Training Plan from
already-computed inputs.

No DB, no HTTP, no LLM, no clock, no randomness: compose_plan() is fully
deterministic, so the same inputs always produce a byte-identical plan dict.
That is what makes the plan defensible in the thesis and trivially testable.

Scope boundary (do not cross): this module describes WHAT a scenario must
contain — setting, persona stance, beats, constraints, escalation seed. It
never writes dialogue, NPC lines or scenario prose. RPE owns that.
"""
from __future__ import annotations

from typing import Optional

from app.contracts.training_plan import (
    AdaptationRules,
    CounterpartPersona,
    EscalationSeed,
    KolbStage,
    Medium,
    PedagogyDirectives,
    ScenarioBlueprint,
    ScenarioSetting,
)
from app.schemas.training_plan import LearnerIntent
from app.services.pedagogy.adapter import difficulty_int_to_label
from app.services.pedagogy.types import (
    BaselineSummary,
    OceanScores,
    TeachingStrategy,
)

LOW = 40
HIGH = 60

_SESSION_LENGTH_TURNS: dict[str, int] = {
    "short": 5,
    "standard": 8,
    "extended": 12,
}
_MINUTES_PER_TURN = 2

_INTENSITY_PRESSURE_DELTA: dict[str, int] = {
    "gentle": -1,
    "balanced": 0,
    "challenging": 1,
}

MIN_PRESSURE = 1
MAX_PRESSURE = 5

_SUPPORT_BY_COMPLEXITY: dict[str, str] = {
    "simple": "high",
    "moderate": "moderate",
    "complex": "low",
}
_HINT_POLICY_BY_COMPLEXITY: dict[str, str] = {
    "simple": "proactive — offer a hint whenever the learner stalls for a turn",
    "moderate": "on_request — hints available but never volunteered unprompted",
    "complex": "minimal — hints only after two consecutive missed beats",
}

_DOMAIN_MEDIUM: dict[str, Medium] = {
    "conflict_resolution": "in_person",
    "feedback_delivery": "in_person",
    "negotiation": "in_person",
    "presentation": "video_call",
    "interview": "video_call",
    "client_communication": "video_call",
    "team_collaboration": "video_call",
    "performance_review": "in_person",
    "crisis_handling": "phone",
    "networking": "in_person",
    "onboarding": "video_call",
    "other": "video_call",
}

BASE_INITIAL_TRUST = 0.5
BASE_ESCALATION_CEILING = 0.6

# Disposition shifts starting trust and how hot the counterpart lets things get.
_DISPOSITION_TRUST_DELTA: dict[str, float] = {
    "supportive": 0.20,
    "neutral": 0.0,
    "skeptical": -0.10,
    "resistant": -0.20,
    "distracted": -0.05,
}
_DISPOSITION_CEILING_DELTA: dict[str, float] = {
    "supportive": -0.20,
    "neutral": 0.0,
    "skeptical": 0.05,
    "resistant": 0.20,
    "distracted": 0.0,
}

# High-Neuroticism safety override — mirrors strategy_optimizer's rule that the
# safety signal wins: more goodwill in the room, lower hostility ceiling.
NEUROTICISM_TRUST_BONUS = 0.15
NEUROTICISM_CEILING_PENALTY = 0.20

MIN_TRUST = 0.05
MAX_TRUST = 0.95
MIN_CEILING = 0.20
MAX_CEILING = 1.0

# Early plans front-load lived experience; advanced plans push experimentation.
_KOLB_BY_BAND: dict[str, KolbStage] = {
    "beginner": "concrete_experience",
    "intermediate": "reflective_observation",
    "advanced": "active_experimentation",
}

# Content guardrails RPE must respect — policy, not per-learner tuning.
_BASE_CONTENT_CONSTRAINTS: list[str] = [
    "Stay workplace-appropriate at all times",
    "No conflict grounded in protected characteristics "
    "(race, gender, religion, disability, age, sexuality)",
    "No personal-trauma themes (bereavement, illness, abuse, self-harm)",
    "No profanity, slurs, threats or intimidation",
    "Keep the disagreement about work, never about the learner as a person",
]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _article(noun: str) -> str:
    """
    "a" / "an" for a free-text role. Roles come from the learner or the LLM, so
    they land in learner-visible strings — "a engineering manager" reads badly.
    Vowel-letter heuristic; good enough for job titles.
    """
    return "an" if noun[:1].lower() in "aeiou" else "a"


def _round2(value: float) -> float:
    return round(value, 2)


def ocean_levels(scores: OceanScores) -> dict[str, str]:
    """
    OCEAN 0-100 → {"openness": "low"|"mid"|"high", ...}.

    This is the ONLY representation of personality allowed to leave APM
    through the plan surface or an LLM prompt — never the raw numbers.
    """
    def level(value: float) -> str:
        if value < LOW:
            return "low"
        if value > HIGH:
            return "high"
        return "mid"

    return {
        "openness": level(scores.openness),
        "conscientiousness": level(scores.conscientiousness),
        "extraversion": level(scores.extraversion),
        "agreeableness": level(scores.agreeableness),
        "neuroticism": level(scores.neuroticism),
    }


def _pressure_level(difficulty: int, intensity_preference: str) -> int:
    """
    difficulty 1-10 + intensity_preference → pressure_level 1-5.

    Difficulty sets the band (1-2→1, 3-4→2, 5-6→3, 7-8→4, 9-10→5); intensity
    nudges it one step either way. Clamped to 1-5.
    """
    band = (difficulty + 1) // 2
    delta = _INTENSITY_PRESSURE_DELTA.get(intensity_preference, 0)
    return int(_clamp(band + delta, MIN_PRESSURE, MAX_PRESSURE))


def _escalation_seed(
    scores: OceanScores,
    disposition: str,
    pressure_level: int,
) -> EscalationSeed:
    """
    Seed RPE's trust/escalation FSM.

    High Neuroticism raises initial_trust and lowers escalation_ceiling —
    the same safety-first precedence strategy_optimizer documents for tone.
    """
    trust = BASE_INITIAL_TRUST + _DISPOSITION_TRUST_DELTA.get(disposition, 0.0)
    ceiling = (
        BASE_ESCALATION_CEILING
        + _DISPOSITION_CEILING_DELTA.get(disposition, 0.0)
        + 0.05 * (pressure_level - 3)
    )

    if scores.neuroticism > HIGH:
        trust += NEUROTICISM_TRUST_BONUS
        ceiling -= NEUROTICISM_CEILING_PENALTY

    return EscalationSeed(
        initial_trust=_round2(_clamp(trust, MIN_TRUST, MAX_TRUST)),
        escalation_ceiling=_round2(_clamp(ceiling, MIN_CEILING, MAX_CEILING)),
        de_escalation_triggers=[
            "learner acknowledges the counterpart's constraint before arguing",
            "learner proposes a concrete, dated alternative",
            "learner asks a genuine clarifying question",
            "learner names the shared goal explicitly",
        ],
        escalation_triggers=[
            "learner concedes the point without stating their position",
            "learner repeats the same argument a third time",
            "learner blames a named person rather than the situation",
            "learner goes silent or deflects for two consecutive turns",
        ],
    )


def _required_beats(intent: LearnerIntent, target_skills: list[str]) -> list[str]:
    """
    3-5 moments the scenario MUST contain so the target skills get exercised.

    Beats are described as required *moments*, never as lines of dialogue.
    """
    beats = [
        f"The counterpart states their position on the {intent.domain.replace('_', ' ')} "
        "issue, giving the learner something concrete to respond to",
        "The learner is given a clear opening to state their own position",
    ]

    skill_beats = {
        "assertiveness": "The counterpart applies pressure that the learner "
                         "must hold their ground against at least once",
        "professional_assertiveness": "The counterpart applies pressure that the "
                                      "learner must hold their ground against at least once",
        "self_advocacy": "A moment where the learner's own contribution or "
                         "constraint goes unacknowledged unless they raise it",
        "boundary_setting": "The counterpart makes a request that exceeds what "
                            "the learner can reasonably absorb",
        "conflict_resolution": "A point of genuine disagreement surfaces that "
                               "cannot be resolved by agreeing",
        "emotional_regulation": "The counterpart raises the temperature once, "
                                "testing whether the learner stays composed",
        "accountability": "A gap or mistake surfaces that the learner must own "
                          "rather than deflect",
        "professional_communication": "A moment requiring the learner to restate "
                                      "something complex clearly and concisely",
        "client_management": "The counterpart signals dissatisfaction that "
                             "threatens the working relationship",
        "trust_building": "An opportunity for the learner to acknowledge the "
                          "counterpart's constraint before pressing their own",
        "political_awareness": "An unstated stakeholder interest surfaces that "
                               "the learner must read and navigate",
    }

    seen: set[str] = set()
    for skill in target_skills:
        beat = skill_beats.get(skill)
        if beat and beat not in seen:
            seen.add(beat)
            beats.append(beat)

    beats.append(
        "The conversation reaches a decision point — agreement, explicit "
        "disagreement, or a concrete next step"
    )
    return beats[:5]


def _success_criteria(target_skills: list[str], intent: LearnerIntent) -> list[str]:
    """Observable learner behaviours — what a good run looks like."""
    criteria = [
        "Learner states their position explicitly at least once, without hedging",
        f"Learner keeps the exchange focused on the "
        f"{intent.domain.replace('_', ' ')} issue rather than personalities",
    ]
    per_skill = {
        "assertiveness": "Learner restates their position after the first pushback",
        "professional_assertiveness": "Learner declines or renegotiates without apologising for it",
        "self_advocacy": "Learner names their own contribution or constraint unprompted",
        "boundary_setting": "Learner names a concrete limit and offers an alternative",
        "conflict_resolution": "Learner proposes a resolution both sides could act on",
        "emotional_regulation": "Learner's tone stays level through the escalation beat",
        "accountability": "Learner acknowledges their part without over-apologising",
        "professional_communication": "Learner summarises the outcome in one clear sentence",
        "client_management": "Learner acknowledges the concern before defending the work",
        "trust_building": "Learner reflects the counterpart's constraint back accurately",
        "political_awareness": "Learner surfaces the unstated stakeholder interest",
    }
    for skill in target_skills:
        text = per_skill.get(skill)
        if text and text not in criteria:
            criteria.append(text)
    return criteria[:6]


def _failure_modes(target_skills: list[str]) -> list[str]:
    """What a poor run looks like — used for post-session diagnosis."""
    modes = [
        "Learner agrees to everything to end the discomfort",
        "Learner never states a position, only asks questions",
        "Learner becomes combative and attacks the counterpart personally",
        "Learner leaves with no concrete next step agreed",
    ]
    if "emotional_regulation" in target_skills:
        modes.append("Learner's responses become terse or shut down after pushback")
    if "boundary_setting" in target_skills:
        modes.append("Learner accepts the extra scope while signalling resentment")
    return modes[:6]


def _formative_checkpoints(target_skills: list[str]) -> list[str]:
    """Mid-session checks RPE can score against as the conversation runs."""
    checkpoints = [
        "After the opening exchange: did the learner state a position or only react?",
        "At the pressure beat: did the learner hold, fold, or escalate?",
        "At close: is there a concrete, mutually understood next step?",
    ]
    if target_skills:
        checkpoints.insert(
            1,
            f"Mid-conversation: is the learner exercising "
            f"{target_skills[0].replace('_', ' ')} or avoiding it?",
        )
    return checkpoints


def _zpd_rationale(
    difficulty: int, scores: OceanScores, baseline: Optional[BaselineSummary]
) -> str:
    """One line explaining why this difficulty sits just above current ability."""
    band = difficulty_int_to_label(difficulty)
    if scores.neuroticism > HIGH and scores.extraversion < LOW:
        reach = (
            "one step beyond a purely supportive conversation, but well short of "
            "open confrontation"
        )
    elif scores.neuroticism < LOW and scores.extraversion > HIGH:
        reach = (
            "beyond routine disagreement, where confidence alone stops being "
            "enough and structure is required"
        )
    else:
        reach = "just past what the learner already handles comfortably"

    evidence = (
        "calibrated against measured baseline evidence"
        if baseline is not None and baseline.has_baseline
        else "calibrated from the personality profile alone (no baseline yet)"
    )
    return (
        f"Set at {band} ({difficulty}/10) — {reach}; {evidence}. "
        "Support is scaffolded so the learner can reach it, not sit in it."
    )


def _adaptation_rules(
    scores: OceanScores, difficulty: int, intensity_preference: str
) -> AdaptationRules:
    """
    How far the live loop may bend this plan.

    Thresholds are expressed against the signal names APM already computes in
    aggregator.py, so RPE and MCA evaluate the same vocabulary.
    """
    soften_on = ["stress_score > 0.7", "confidence_score < 0.35"]
    escalate_on = ["engagement_score > 0.75 AND stress_score < 0.3"]

    if scores.neuroticism > HIGH:
        soften_on.append("stress_score > 0.55 sustained over 2 consecutive turns")
    if intensity_preference == "gentle":
        soften_on.append("learner requests a pause or signals overwhelm")
    if intensity_preference == "challenging":
        escalate_on.append("objective_completion_rate > 0.8 before the final beat")

    return AdaptationRules(
        allow_live_nudges=True,
        max_difficulty_delta=1,
        strategy_locked_during_session=True,
        soften_on=soften_on,
        escalate_on=escalate_on,
        abort_conditions=[
            "stress_score > 0.9",
            "learner explicitly asks to stop",
            "conversation leaves the workplace-appropriate boundary",
        ],
    )


def compose_plan(
    intent: LearnerIntent,
    ocean: OceanScores,
    strategy: TeachingStrategy,
    difficulty: int,
    baseline: Optional[BaselineSummary],
    target_skills: list[str],
) -> dict:
    """
    Assemble the plan body. Pure and deterministic.

    Returns a dict with three keys — "blueprint", "pedagogy", "adaptation" —
    each already validated by its contract model, so the caller can persist
    them straight to JSONB.
    """
    difficulty_band = difficulty_int_to_label(difficulty)
    pressure = _pressure_level(difficulty, intent.intensity_preference)
    turn_count = _SESSION_LENGTH_TURNS.get(intent.session_length, 8)

    setting = ScenarioSetting(
        where=intent.workplace_context,
        when="During normal working hours, at a point where the issue can no "
             "longer be deferred",
        who_else_present=(
            [] if intent.session_length == "short"
            else ["No one — the conversation is one-to-one"]
        ),
    )

    persona = CounterpartPersona(
        role=intent.counterpart_role,
        disposition=intent.counterpart_disposition,
        motivations=[
            f"Protect their own priorities in the {intent.domain.replace('_', ' ')} "
            "situation",
            "Be seen as reasonable by anyone who hears about this later",
            "Reach a resolution without conceding more than necessary",
        ],
        likely_objections=[
            "The learner's concern is real but not the most urgent thing right now",
            "Someone above them has already committed to the current course",
            "This has been handled the same way before without complaint",
        ],
        communication_style=(
            f"{intent.counterpart_disposition.capitalize()} and businesslike; "
            f"matched to a {strategy.tone} teaching tone at "
            f"{strategy.pacing} pacing"
        ),
        hidden_concern=(
            "They are under pressure themselves and have less room to move than "
            "they are willing to admit up front"
        ),
    )

    blueprint = ScenarioBlueprint(
        title_hint=(
            f"{intent.domain.replace('_', ' ').title()} with "
            f"{_article(intent.counterpart_role)} {intent.counterpart_role}"
        ),
        medium=_DOMAIN_MEDIUM.get(intent.domain, "video_call"),
        setting=setting,
        situation_summary=(
            f"The learner is {_article(intent.learner_role)} "
            f"{intent.learner_role} in the following setting: "
            f"{intent.workplace_context}. "
            f"They need to work through a {intent.domain.replace('_', ' ')} "
            f"situation with {_article(intent.counterpart_role)} "
            f"{intent.counterpart_role} who is "
            f"{intent.counterpart_disposition} toward their position. "
            f"The counterpart has their own constraints and will not simply "
            f"agree. "
            f"The learner's own words for what they want to practise: "
            f"\"{intent.raw_text}\". "
            f"The scenario should give the learner room to exercise "
            f"{', '.join(s.replace('_', ' ') for s in target_skills) or 'core communication skills'}."
        ),
        learner_role=intent.learner_role,
        learner_objective=(
            f"Hold a productive {intent.domain.replace('_', ' ')} conversation "
            f"that ends with the learner's position clearly stated and a "
            f"concrete next step agreed"
        ),
        counterpart_persona=persona,
        stakes=(
            "The working relationship and the learner's credibility both matter "
            "here — conceding costs standing, escalating costs goodwill"
        ),
        pressure_level=pressure,
        trigger_event=(
            f"The {intent.counterpart_role} raises the issue at the start of the "
            f"conversation, putting the learner on the spot to respond"
        ),
        required_beats=_required_beats(intent, target_skills),
        success_criteria=_success_criteria(target_skills, intent),
        failure_modes=_failure_modes(target_skills),
        content_constraints=list(_BASE_CONTENT_CONSTRAINTS),
        target_turn_count=turn_count,
        est_duration_minutes=turn_count * _MINUTES_PER_TURN,
        escalation_seed=_escalation_seed(
            ocean, intent.counterpart_disposition, pressure
        ),
    )

    pedagogy = PedagogyDirectives(
        teaching_strategy=strategy.model_dump(),
        difficulty=difficulty,
        difficulty_band=difficulty_band,
        support_level=_SUPPORT_BY_COMPLEXITY.get(strategy.complexity, "moderate"),
        hint_policy=_HINT_POLICY_BY_COMPLEXITY.get(
            strategy.complexity,
            "on_request — hints available but never volunteered unprompted",
        ),
        zpd_rationale=_zpd_rationale(difficulty, ocean, baseline),
        kolb_stage_focus=_KOLB_BY_BAND.get(difficulty_band, "concrete_experience"),
        formative_checkpoints=_formative_checkpoints(target_skills),
    )

    adaptation = _adaptation_rules(
        ocean, difficulty, intent.intensity_preference
    )

    return {
        "blueprint": blueprint.model_dump(mode="json"),
        "pedagogy": pedagogy.model_dump(mode="json"),
        "adaptation": adaptation.model_dump(mode="json"),
    }
