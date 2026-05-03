from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.v1.rpe.engine.conflict_tracker import ConflictTracker
from app.api.v1.rpe.engine.emotional_memory import EmotionalMemory
from app.api.v1.rpe.engine.flow_controller import FlowController
from app.api.v1.rpe.engine.npc_dialogue_engine import NpcDialogueEngine
from app.api.v1.rpe.engine.scenario_manager import ScenarioManager
from app.api.v1.rpe.engine.session_logger import SessionLogger
from app.api.v1.rpe.engine.trust_tracker import TrustTracker
from app.api.v1.rpe.engine.user_interaction_handler import UserInteractionHandler

rpe_router = APIRouter()

# Module-level singletons shared across requests
_sm = ScenarioManager()
_fc = FlowController()
_npc = NpcDialogueEngine()
_em = EmotionalMemory()
_tt = TrustTracker()
_ct = ConflictTracker()
_sl = SessionLogger()
_handler = UserInteractionHandler(_sm, _fc, _npc, _em, _tt, _ct, _sl)


class StartSessionRequest(BaseModel):
    scenario_id: str
    user_id: str


class RespondRequest(BaseModel):
    session_id: str
    user_input: str


@rpe_router.post("/session/start")
def start_session(payload: StartSessionRequest) -> dict:
    try:
        scenario = _sm.load_scenario(payload.scenario_id)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario not found. Available: {_sm.available_ids()}",
        )

    try:
        state = _fc.start_session(payload.scenario_id, payload.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    _sl.create_session(
        state.session_id,
        payload.scenario_id,
        payload.user_id,
        scenario.opening_npc_line,
    )

    return {
        "session_id": state.session_id,
        "opening_npc_line": scenario.opening_npc_line,
        "scenario_title": scenario.title,
        "difficulty": scenario.difficulty,
        "conflict_type": scenario.conflict_type,
        "total_turns": scenario.turns,
    }


@rpe_router.post("/session/respond")
def respond(payload: RespondRequest) -> dict:
    if _fc.get_session(payload.session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found or already ended")
    try:
        return _handler.handle_turn(payload.session_id, payload.user_input)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@rpe_router.get("/session/summary/{session_id}")
def session_summary(session_id: str) -> dict:
    try:
        return _sl.get_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session log not found")


@rpe_router.get("/scenarios")
def list_scenarios() -> list:
    return [
        {
            "scenario_id": s.scenario_id,
            "title": s.title,
            "difficulty": s.difficulty,
            "conflict_type": s.conflict_type,
            "turns": s.turns,
        }
        for s in _sm.list_all_scenarios()
    ]


@rpe_router.get("/scenarios/difficulty/{level}")
def scenarios_by_difficulty(level: str) -> list:
    return [
        {
            "scenario_id": s.scenario_id,
            "title": s.title,
            "difficulty": s.difficulty,
            "conflict_type": s.conflict_type,
        }
        for s in _sm.get_by_difficulty(level)
    ]


@rpe_router.get("/scenarios/type/{conflict_type}")
def scenarios_by_type(conflict_type: str) -> list:
    return [
        {
            "scenario_id": s.scenario_id,
            "title": s.title,
            "difficulty": s.difficulty,
            "conflict_type": s.conflict_type,
        }
        for s in _sm.get_by_conflict_type(conflict_type)
    ]
