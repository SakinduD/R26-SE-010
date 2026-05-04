from fastapi import APIRouter, HTTPException

from app.schemas.rpe import (
    ApaRecommendRequest,
    ApaSessionCompleteRequest,
    RespondRequest,
    RespondResponse,
    ScenarioDetail,
    ScenarioSummary,
    StartSessionRequest,
    StartSessionResponse,
)
from app.services.rpe_apa_service import ApaLearnerProfile, RpeApaService
from app.services.rpe_emotion_service import RpeEmotionService
from app.services.rpe_npc_service import RpeNpcService
from app.services.rpe_scenario_service import RpeScenarioService
from app.services.rpe_session_service import RpeSessionService

rpe_scenario_service = RpeScenarioService()
rpe_scenario_service.load_all()
rpe_session_service = RpeSessionService(rpe_scenario_service)
rpe_emotion_service = RpeEmotionService()
rpe_npc_service = RpeNpcService()
rpe_apa_service = RpeApaService(rpe_scenario_service)

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


@rpe_router.get("/scenarios/detail/{scenario_id}", response_model=ScenarioDetail)
def scenario_detail(scenario_id: str) -> dict:
    scenario = rpe_scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found.")
    return {
        "scenario_id":      scenario.scenario_id,
        "title":            scenario.title,
        "difficulty":       scenario.difficulty,
        "conflict_type":    scenario.conflict_type,
        "npc_role":         scenario.npc_role,
        "npc_personality":  scenario.npc_personality,
        "context":          scenario.context,
        "opening_npc_line": scenario.opening_npc_line,
        "turns":            scenario.turns,
        "success_criteria": scenario.success_criteria,
        "npc_behaviour":    scenario.npc_behaviour,
        "apa_metadata":     scenario.apa_metadata,
        "target_skills":    scenario.apa_metadata.get("target_skills", []),
        "difficulty_weight": scenario.apa_metadata.get("difficulty_weight", 1.0),
    }


@rpe_router.get("/scenarios/skill/{skill}", response_model=list[ScenarioSummary])
def scenarios_by_skill(skill: str) -> list[dict]:
    results = rpe_scenario_service.get_by_skill(skill)
    if not results:
        raise HTTPException(status_code=404, detail=f"No scenarios found for skill '{skill}'.")
    return results


@rpe_router.get("/scenarios/trait/{trait}", response_model=list[ScenarioSummary])
def scenarios_by_trait(trait: str) -> list[dict]:
    results = rpe_scenario_service.get_by_big_five(trait)
    if not results:
        raise HTTPException(status_code=404, detail=f"No scenarios found for trait '{trait}'.")
    return results


@rpe_router.post("/apa/recommend", response_model=list[ScenarioSummary])
def apa_recommend(payload: ApaRecommendRequest) -> list[dict]:
    profile = ApaLearnerProfile(
        user_id=payload.user_id,
        openness=payload.openness,
        conscientiousness=payload.conscientiousness,
        extraversion=payload.extraversion,
        agreeableness=payload.agreeableness,
        neuroticism=payload.neuroticism,
        weak_skills=payload.weak_skills,
        recommended_difficulty=payload.recommended_difficulty,
    )
    return rpe_apa_service.get_recommended_scenarios(profile)


@rpe_router.post("/apa/session-complete")
def apa_session_complete(payload: ApaSessionCompleteRequest) -> dict:
    try:
        summary = rpe_session_service.get_session(payload.session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    rpe_apa_service.notify_session_complete(payload.user_id, summary)
    return {"status": "notified"}
