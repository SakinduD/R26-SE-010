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
