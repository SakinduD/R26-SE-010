"""
APM → RPE Training Plan contract — the complete input specification for RPE's
scenario generator.

APM's one source of truth for the /apa/training-plan/{plan_id}/scenario-brief
wire format. See Backend/docs/INTEGRATION_TRAINING_PLAN.md.

Division of responsibility: APM describes WHAT a scenario must contain; RPE
writes the scenario itself. Nothing in this file carries dialogue or NPC lines.

Big Five values here are 0.0-1.0 (RPE's scale). Conversion from APM's internal
0-100 happens ONLY in app/services/pedagogy/adapter.py.

SCHEMA_VERSION is semver. Bump it whenever the wire shape changes and add a
CHANGELOG note in INTEGRATION_TRAINING_PLAN.md.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.contracts.rpe import ApaLearnerProfile, DifficultyLabel

SCHEMA_VERSION = "1.0.0"

IntentDomain = Literal[
    "conflict_resolution",
    "feedback_delivery",
    "negotiation",
    "presentation",
    "interview",
    "client_communication",
    "team_collaboration",
    "performance_review",
    "crisis_handling",
    "networking",
    "onboarding",
    "other",
]

CounterpartDisposition = Literal[
    "supportive", "neutral", "skeptical", "resistant", "distracted"
]

IntensityPreference = Literal["gentle", "balanced", "challenging"]

SessionLength = Literal["short", "standard", "extended"]

Medium = Literal["in_person", "video_call", "phone", "chat"]

KolbStage = Literal[
    "concrete_experience",
    "reflective_observation",
    "abstract_conceptualisation",
    "active_experimentation",
]

ParseSource = Literal["llm", "rule_based"]


class ScenarioSetting(BaseModel):
    """Where and when the scene takes place, and who else is in the room."""

    where: str
    when: str
    who_else_present: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


class CounterpartPersona(BaseModel):
    """
    The character RPE must write. APM supplies motivation and stance; RPE
    supplies the actual words. hidden_concern is what the NPC does not
    volunteer unless the learner earns it.
    """

    role: str
    disposition: CounterpartDisposition
    motivations: list[str] = Field(default_factory=list)
    likely_objections: list[str] = Field(default_factory=list)
    communication_style: str
    hidden_concern: str

    model_config = ConfigDict(extra="ignore")


class EscalationSeed(BaseModel):
    """
    Initial conditions for RPE's trust/escalation state machine. The trigger
    lists are behavioural conditions evaluated per turn, not literal dialogue.
    """

    initial_trust: float = Field(ge=0.0, le=1.0)
    escalation_ceiling: float = Field(ge=0.0, le=1.0)
    de_escalation_triggers: list[str] = Field(default_factory=list)
    escalation_triggers: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


class ScenarioBlueprint(BaseModel):
    """
    The build spec RPE turns into a playable scenario.

    Carries no dialogue by design — trigger_event is an event, not a line, and
    required_beats are moments the scenario must contain, not a script.
    """

    title_hint: str
    medium: Medium
    setting: ScenarioSetting
    situation_summary: str
    learner_role: str
    learner_objective: str
    counterpart_persona: CounterpartPersona
    stakes: str
    pressure_level: int = Field(ge=1, le=5)
    trigger_event: str
    required_beats: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)
    failure_modes: list[str] = Field(default_factory=list)
    content_constraints: list[str] = Field(default_factory=list)
    target_turn_count: int = Field(ge=1)
    est_duration_minutes: int = Field(ge=1)
    escalation_seed: EscalationSeed

    model_config = ConfigDict(extra="ignore")


class PedagogyDirectives(BaseModel):
    """
    How RPE should teach through this scenario. teaching_strategy is the
    existing APM TeachingStrategy shape (app/services/pedagogy/types.py)
    carried through verbatim.
    """

    teaching_strategy: dict
    difficulty: int = Field(ge=1, le=10)
    difficulty_band: DifficultyLabel
    support_level: str
    hint_policy: str
    zpd_rationale: str
    kolb_stage_focus: KolbStage
    formative_checkpoints: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


class AdaptationRules(BaseModel):
    """
    How far RPE and the live MCA loop may bend the plan mid-session.

    soften_on / escalate_on / abort_conditions are signal expressions
    (e.g. "stress_score > 0.7") using the names aggregator.py already computes.
    """

    allow_live_nudges: bool = True
    max_difficulty_delta: int = 1
    strategy_locked_during_session: bool = True
    soften_on: list[str] = Field(default_factory=list)
    escalate_on: list[str] = Field(default_factory=list)
    abort_conditions: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


class LearnerIntentWire(BaseModel):
    """The parsed learner goal, as handed to RPE."""

    raw_text: str
    domain: IntentDomain
    workplace_context: str
    learner_role: str
    counterpart_role: str
    counterpart_disposition: CounterpartDisposition
    desired_focus_skills: list[str] = Field(default_factory=list)
    intensity_preference: IntensityPreference
    session_length: SessionLength
    parse_confidence: float = Field(ge=0.0, le=1.0)
    parse_source: ParseSource

    model_config = ConfigDict(extra="ignore")


class ScenarioGenerationBrief(BaseModel):
    """
    GET /api/v1/apa/training-plan/{plan_id}/scenario-brief

    Everything RPE needs to generate a scenario for one learner, one goal.
    Read-only input; the endpoint is idempotent and only stamps consumed_at,
    so RPE may retry.

    learner_profile is produced by adapter.to_rpe_profile() — the single
    0-100 → 0.0-1.0 conversion site.
    """

    schema_version: str = SCHEMA_VERSION
    plan_id: str
    plan_version: int
    user_id: str
    generated_at: datetime

    learner_profile: ApaLearnerProfile

    intent: LearnerIntentWire
    blueprint: ScenarioBlueprint
    pedagogy: PedagogyDirectives
    adaptation: AdaptationRules

    target_skills: list[str] = Field(default_factory=list)
    consumed_at: Optional[datetime] = None

    model_config = ConfigDict(extra="ignore")
