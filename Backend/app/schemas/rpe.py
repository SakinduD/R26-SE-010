from pydantic import BaseModel


class ScenarioSummary(BaseModel):
    scenario_id:       str
    title:             str
    difficulty:        str
    conflict_type:     str
    turns:             int               # backward-compat alias = recommended_turns
    recommended_turns: int
    max_turns:         int
    target_skills:     list[str] = []    # was silently dropped — built in list_all() but never declared here
    difficulty_weight: float = 1.0       # same bug — see above
    is_generated:      bool = False      # True for a scenario built from an APM Training Plan
    context:           str = ""          # the real-life situation line, e.g. "Your manager wants..."
    category:          str = "Difficult Conversations"  # one of the 6 Practice Lab categories


class StartSessionRequest(BaseModel):
    scenario_id: str
    user_id:     str | None = None


class StartSessionResponse(BaseModel):
    session_id:        str
    opening_npc_line:  str
    scenario_title:    str
    difficulty:        str
    conflict_type:     str
    total_turns:       int               # backward-compat = recommended_turns
    recommended_turns: int
    max_turns:         int
    is_authenticated:  bool = False
    failure_escalation_threshold: int | None = None


class RespondRequest(BaseModel):
    session_id: str
    user_input: str


class ResponseOptionOut(BaseModel):
    """
    One tappable reply option shown instead of free-text/voice input when the
    NPC's line just asked the user to hand over a concrete document/report —
    see RpeNpcService._build_system_prompt's requestsDeliverable instructions.
    quality is bookkeeping only; the frontend must never render it.
    """
    label:   str
    text:    str
    quality: str


class RespondResponse(BaseModel):
    npc_response:     str
    emotion:          str
    animation:        str | None = None
    user_behavior:    str | None = None
    trust_score:      int
    escalation_level: int
    turn:             int
    session_complete: bool
    outcome:          str | None = None
    end_reason:       str | None = None
    requests_deliverable: bool = False
    response_options:     list[ResponseOptionOut] | None = None
    clarity_score:     float | None = None     # live per-turn heuristic — see RpeNlpService._score_turn
    response_quality:  float | None = None


class SessionSummaryResponse(BaseModel):
    session_id:       str
    scenario_id:      str
    user_id:          str
    started_at:       str
    ended_at:         str | None
    outcome:          str | None
    final_trust:      int | None
    final_escalation: int | None
    turns:            list[dict]
    emotion_history:  list[str]
    trust_history:    list[int]


class ScenarioDetail(BaseModel):
    """Full scenario detail including APA metadata."""
    scenario_id:       str
    title:             str
    difficulty:        str
    conflict_type:     str
    npc_role:          str
    npc_personality:   str
    context:           str
    opening_npc_line:  str
    recommended_turns: int
    max_turns:         int
    end_conditions:    dict = {}
    success_criteria:  dict
    npc_behaviour:     dict
    apa_metadata:      dict
    target_skills:     list[str] = []
    difficulty_weight: float = 1.0
    category:          str = "Difficult Conversations"


class ApaRecommendRequest(BaseModel):
    """
    Request body for APA-driven scenario recommendations.
    user_id is required. All Big Five scores optional (default 0.5).
    """
    user_id:                str
    openness:               float = 0.5
    conscientiousness:      float = 0.5
    extraversion:           float = 0.5
    agreeableness:          float = 0.5
    neuroticism:            float = 0.5
    weak_skills:            list[str] = []
    recommended_difficulty: str = "beginner"


class ApaSessionCompleteRequest(BaseModel):
    user_id:    str
    session_id: str


class SessionIdsRequest(BaseModel):
    """Body for the My Sessions recycle-bin bulk actions (trash/restore/purge)."""
    session_ids: list[str]


class TurnMetric(BaseModel):
    turn:                int
    assertiveness_score: float
    empathy_score:       float
    clarity_score:       float
    response_quality:    float
    flags:               list[str]


class RiskFlag(BaseModel):
    flag_type:      str
    severity:       str
    description:    str
    affected_turns: list[int]


class BlindSpot(BaseModel):
    blind_spot_type: str
    description:     str
    affected_turns:  list[int]
    recommendation:  str


class CoachingAdvice(BaseModel):
    overall_rating: str
    summary:        str
    advice:         list[str]
    strengths:      list[str]
    focus_areas:    list[str]
    strongest_turn:        int | None = None
    strongest_turn_note:   str | None = None
    improvement_turn:       int | None = None
    improvement_original:   str | None = None
    improvement_suggested:  str | None = None


class ConflictStyleSummary(BaseModel):
    """
    TKI-style conflict-handling label (Thomas & Kilmann's Conflict Mode
    Instrument: assertiveness x cooperativeness -> 5 styles), derived from
    the session's live userBehavior tags. See RpeNlpService.compute_conflict_style.
    """
    style:             str
    label:             str
    description:       str
    assertive_share:   float
    cooperative_share: float
    turns_tagged:      int


class FeedbackResponse(BaseModel):
    session_id:        str
    scenario_id:       str
    scenario_title:    str
    difficulty:        str | None = None   # was referenced by FeedbackDashboard.jsx but never actually returned
    category:          str | None = None
    user_id:           str
    outcome:           str | None
    final_trust:       int | None
    final_escalation:  int | None
    total_turns:       int
    turn_metrics:      list[TurnMetric]
    conflict_style:    ConflictStyleSummary | None = None
    risk_flags:        list[RiskFlag]
    blind_spots:       list[BlindSpot]
    coaching_advice:   CoachingAdvice
    viz_payload:       dict
    end_reason:        str | None = None
    recommended_turns: int | None = None
    max_turns:         int | None = None
