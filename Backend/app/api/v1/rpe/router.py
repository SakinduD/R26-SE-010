from fastapi import APIRouter, HTTPException

from app.schemas.rpe import (
    RespondRequest,
    RespondResponse,
    ScenarioSummary,
    StartSessionRequest,
    StartSessionResponse,
)
from app.services.rpe_emotion_service import RpeEmotionService
from app.services.rpe_npc_service import RpeNpcService
from app.services.rpe_scenario_service import RpeScenarioService
from app.services.rpe_session_service import RpeSessionService

rpe_scenario_service = RpeScenarioService()
rpe_scenario_service.load_all()
rpe_session_service = RpeSessionService(rpe_scenario_service)
rpe_emotion_service = RpeEmotionService()
rpe_npc_service = RpeNpcService()

rpe_router = APIRouter()


@rpe_router.post("/start-session", response_model=StartSessionResponse)
def start_session(payload: StartSessionRequest) -> StartSessionResponse:
    try:
        state = rpe_session_service.start_session(payload.scenario_id, payload.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    scenario = rpe_scenario_service.get_scenario(payload.scenario_id)
    return StartSessionResponse(
        session_id=state.session_id,
        opening_npc_line=scenario.opening_npc_line,
        scenario_title=scenario.title,
        difficulty=scenario.difficulty,
        conflict_type=scenario.conflict_type,
        total_turns=scenario.turns,
    )


@rpe_router.post("/session-respond", response_model=RespondResponse)
def session_respond(payload: RespondRequest) -> RespondResponse:
    try:
        state = rpe_session_service.get_state(payload.session_id)
        if not state:
            raise HTTPException(status_code=404, detail=f"Session '{payload.session_id}' not found.")

        try:
            session_data = rpe_session_service.get_session(payload.session_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        prior_turns: list[dict] = session_data.get("turns", [])
        opening_npc_line: str = session_data.get("opening_npc_line", "")
        trust_history: list[int] = session_data.get("trust_history", [50])
        current_trust: int = trust_history[-1] if trust_history else 50
        current_esc: int = prior_turns[-1]["escalation_level"] if prior_turns else 0

        scenario = rpe_scenario_service.get_scenario(state.scenario_id)

        emotion = rpe_emotion_service.detect_emotion(payload.user_input)
        new_trust = rpe_emotion_service.update_trust(current_trust, emotion)
        new_esc = rpe_emotion_service.update_escalation(current_esc, emotion)

        npc_response = rpe_npc_service.generate_response(
            user_input=payload.user_input,
            opening_npc_line=opening_npc_line,
            session_turns=prior_turns,
            npc_role=scenario.npc_role,
            npc_personality=scenario.npc_personality,
            context=scenario.context,
            trust_score=new_trust,
            escalation_level=new_esc,
            npc_behaviour=scenario.npc_behaviour,
        )

        turn_number = rpe_session_service.advance_turn(payload.session_id)
        turn_data = {
            "turn": turn_number,
            "user_input": payload.user_input,
            "npc_response": npc_response,
            "emotion": emotion,
            "trust_score": new_trust,
            "escalation_level": new_esc,
        }
        rpe_session_service.log_turn(payload.session_id, turn_data)

        complete = rpe_session_service.is_complete(payload.session_id, scenario.turns)
        outcome: str | None = None
        if complete:
            criteria = scenario.success_criteria
            outcome = (
                "success"
                if new_trust >= criteria["min_trust_score"]
                and new_esc <= criteria["max_escalation_level"]
                else "failure"
            )
            rpe_session_service.finalize_session(payload.session_id, outcome, new_trust, new_esc)

        return RespondResponse(
            npc_response=npc_response,
            emotion=emotion,
            trust_score=new_trust,
            escalation_level=new_esc,
            turn=turn_number,
            session_complete=complete,
            outcome=outcome,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}")


@rpe_router.get("/session-summary/{session_id}")
def session_summary(session_id: str) -> dict:
    try:
        return rpe_session_service.get_session(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@rpe_router.get("/scenarios", response_model=list[ScenarioSummary])
def list_scenarios() -> list[dict]:
    return rpe_scenario_service.list_all()


@rpe_router.get("/scenarios/difficulty/{level}", response_model=list[ScenarioSummary])
def scenarios_by_difficulty(level: str) -> list[dict]:
    results = rpe_scenario_service.get_by_difficulty(level)
    if not results:
        raise HTTPException(status_code=404, detail=f"No scenarios found for difficulty '{level}'.")
    return results


@rpe_router.get("/scenarios/type/{conflict_type}", response_model=list[ScenarioSummary])
def scenarios_by_type(conflict_type: str) -> list[dict]:
    results = rpe_scenario_service.get_by_conflict_type(conflict_type)
    if not results:
        raise HTTPException(status_code=404, detail=f"No scenarios found for conflict type '{conflict_type}'.")
    return results
