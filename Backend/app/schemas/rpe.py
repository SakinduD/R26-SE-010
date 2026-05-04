from pydantic import BaseModel


class ScenarioSummary(BaseModel):
    scenario_id: str
    title: str
    difficulty: str
    conflict_type: str
    turns: int


class StartSessionRequest(BaseModel):
    scenario_id: str
    user_id: str


class StartSessionResponse(BaseModel):
    session_id: str
    opening_npc_line: str
    scenario_title: str
    difficulty: str
    conflict_type: str
    total_turns: int


class RespondRequest(BaseModel):
    session_id: str
    user_input: str


class RespondResponse(BaseModel):
    npc_response: str
    emotion: str
    trust_score: int
    escalation_level: int
    turn: int
    session_complete: bool
    outcome: str | None = None


class SessionSummaryResponse(BaseModel):
    session_id: str
    scenario_id: str
    user_id: str
    started_at: str
    ended_at: str | None
    outcome: str | None
    final_trust: int | None
    final_escalation: int | None
    turns: list[dict]
    emotion_history: list[str]
    trust_history: list[int]


class ScenarioDetail(BaseModel):
    """Full scenario detail including APA metadata."""
    scenario_id: str
    title: str
    difficulty: str
    conflict_type: str
    npc_role: str
    npc_personality: str
    context: str
    opening_npc_line: str
    turns: int
    success_criteria: dict
    npc_behaviour: dict
    apa_metadata: dict
    target_skills: list[str] = []
    difficulty_weight: float = 1.0


class ApaRecommendRequest(BaseModel):
    """
    Request body for APA-driven scenario recommendations.
    Matches ApaLearnerProfile fields.
    user_id is required. All Big Five scores are optional (default 0.5).
    """
    user_id: str
    openness: float = 0.5
    conscientiousness: float = 0.5
    extraversion: float = 0.5
    agreeableness: float = 0.5
    neuroticism: float = 0.5
    weak_skills: list[str] = []
    recommended_difficulty: str = "beginner"


class ApaSessionCompleteRequest(BaseModel):
    user_id: str
    session_id: str
