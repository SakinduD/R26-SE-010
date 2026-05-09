from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user, get_current_user_optional
from app.models.user import User
from app.schemas.rpe import (
    ApaRecommendRequest,
    ApaSessionCompleteRequest,
    FeedbackResponse,
    RespondRequest,
    RespondResponse,
    ScenarioDetail,
    ScenarioSummary,
    StartSessionRequest,
    StartSessionResponse,
)
from app.services.rpe_apa_service        import ApaLearnerProfile, RpeApaService
from app.services.rpe_blind_spot_service import RpeBlindSpotService
from app.services.rpe_coaching_service   import RpeCoachingService
from app.services.rpe_emotion_service    import RpeEmotionService
from app.services.rpe_feedback_service   import RpeFeedbackService
from app.services.rpe_nlp_service        import RpeNlpService
from app.services.rpe_npc_service        import RpeNpcService
from app.services.rpe_predictive_service import RpePredictiveService
from app.services.rpe_scenario_service   import RpeScenarioService
from app.services.rpe_session_service    import RpeSessionService
from app.services.rpe_viz_service        import RpeVizService

rpe_scenario_service   = RpeScenarioService()
rpe_scenario_service.load_all()
rpe_session_service    = RpeSessionService(rpe_scenario_service)
rpe_emotion_service    = RpeEmotionService()
rpe_npc_service        = RpeNpcService()
rpe_apa_service        = RpeApaService(rpe_scenario_service)
rpe_nlp_service        = RpeNlpService()
rpe_predictive_service = RpePredictiveService()
rpe_blind_spot_service = RpeBlindSpotService()
rpe_coaching_service   = RpeCoachingService()
rpe_viz_service        = RpeVizService()
rpe_feedback_service   = RpeFeedbackService(
    session_service    = rpe_session_service,
    scenario_service   = rpe_scenario_service,
    nlp_service        = rpe_nlp_service,
    predictive_service = rpe_predictive_service,
    blind_spot_service = rpe_blind_spot_service,
    coaching_service   = rpe_coaching_service,
    viz_service        = rpe_viz_service,
)

rpe_router = APIRouter()


@rpe_router.post("/start-session", response_model=StartSessionResponse)
def start_session(
    payload:      StartSessionRequest,
    current_user: User | None = Depends(get_current_user_optional),
) -> StartSessionResponse:
    if current_user:
        resolved_user_id = str(current_user.id)
        auth_user_id     = str(current_user.id)
        is_authenticated = True
    else:
        resolved_user_id = payload.user_id or "guest"
        auth_user_id     = None
        is_authenticated = False

    try:
        state = rpe_session_service.start_session(
            scenario_id  = payload.scenario_id,
            user_id      = resolved_user_id,
            auth_user_id = auth_user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    scenario = rpe_scenario_service.get_scenario(payload.scenario_id)
    rpe_session_service.store_session_config(
        session_id        = state.session_id,
        recommended_turns = scenario.recommended_turns,
        max_turns         = scenario.max_turns,
    )
    return StartSessionResponse(
        session_id        = state.session_id,
        opening_npc_line  = scenario.opening_npc_line,
        scenario_title    = scenario.title,
        difficulty        = scenario.difficulty,
        conflict_type     = scenario.conflict_type,
        total_turns       = scenario.recommended_turns,
        recommended_turns = scenario.recommended_turns,
        max_turns         = scenario.max_turns,
        is_authenticated  = is_authenticated,
    )


@rpe_router.post("/session-respond", response_model=RespondResponse)
def session_respond(
    payload:      RespondRequest,
    current_user: User | None = Depends(get_current_user_optional),
) -> RespondResponse:
    try:
        state = rpe_session_service.get_state(payload.session_id)
        if not state:
            raise HTTPException(status_code=404, detail=f"Session '{payload.session_id}' not found.")

        try:
            session_data = rpe_session_service.get_session(payload.session_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        prior_turns: list[dict]  = session_data.get("turns", [])
        opening_npc_line: str    = session_data.get("opening_npc_line", "")
        trust_history: list[int] = session_data.get("trust_history", [50])
        current_trust: int       = trust_history[-1] if trust_history else 50
        current_esc: int         = prior_turns[-1]["escalation_level"] if prior_turns else 0

        scenario = rpe_scenario_service.get_scenario(state.scenario_id)

        emotion   = rpe_emotion_service.detect_emotion(payload.user_input)
        new_trust = rpe_emotion_service.update_trust(current_trust, emotion)
        new_esc   = rpe_emotion_service.update_escalation(current_esc, emotion)

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
            "turn":             turn_number,
            "user_input":       payload.user_input,
            "npc_response":     npc_response,
            "emotion":          emotion,
            "trust_score":      new_trust,
            "escalation_level": new_esc,
        }
        rpe_session_service.log_turn(payload.session_id, turn_data)

        # Re-read session after logging to get updated trust_history
        session_data  = rpe_session_service.get_session(payload.session_id)
        trust_history = session_data["trust_history"]

        should_end, end_reason = rpe_session_service.should_end_session(
            session_id        = payload.session_id,
            max_turns         = scenario.max_turns,
            recommended_turns = scenario.recommended_turns,
            end_conditions    = scenario.end_conditions,
            trust_history     = trust_history,
            escalation_level  = new_esc,
            current_turn      = turn_number,
        )

        outcome: str | None = None
        if should_end:
            if end_reason == "trust_sustained":
                outcome = "success"
            elif end_reason == "npc_exit":
                outcome = "failure"
            elif end_reason == "max_turns_reached":
                criteria = scenario.success_criteria
                outcome  = (
                    "success"
                    if new_trust >= criteria["min_trust_score"]
                    and new_esc  <= criteria["max_escalation_level"]
                    else "failure"
                )
            else:
                outcome = "failure"

            rpe_session_service.finalize_session(
                payload.session_id, outcome, new_trust, new_esc, end_reason
            )

        return RespondResponse(
            npc_response=npc_response,
            emotion=emotion,
            trust_score=new_trust,
            escalation_level=new_esc,
            turn=turn_number,
            session_complete=should_end,
            outcome=outcome,
            end_reason=end_reason if should_end else None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}")


@rpe_router.get("/session-summary/{session_id}")
def session_summary(
    session_id:   str,
    current_user: User | None = Depends(get_current_user_optional),
) -> dict:
    try:
        session = rpe_session_service.get_session(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if current_user and session.get("auth_user_id"):
        if session["auth_user_id"] != str(current_user.id):
            raise HTTPException(status_code=403, detail="You do not have access to this session.")

    return session


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
        "scenario_id":       scenario.scenario_id,
        "title":             scenario.title,
        "difficulty":        scenario.difficulty,
        "conflict_type":     scenario.conflict_type,
        "npc_role":          scenario.npc_role,
        "npc_personality":   scenario.npc_personality,
        "context":           scenario.context,
        "opening_npc_line":  scenario.opening_npc_line,
        "recommended_turns": scenario.recommended_turns,
        "max_turns":         scenario.max_turns,
        "end_conditions":    scenario.end_conditions,
        "success_criteria":  scenario.success_criteria,
        "npc_behaviour":     scenario.npc_behaviour,
        "apa_metadata":      scenario.apa_metadata,
        "target_skills":     scenario.apa_metadata.get("target_skills", []),
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


@rpe_router.get("/session-feedback/{session_id}", response_model=FeedbackResponse)
def session_feedback(
    session_id:   str,
    current_user: User | None = Depends(get_current_user_optional),
) -> dict:
    try:
        session = rpe_session_service.get_session(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if current_user and session.get("auth_user_id"):
        if session["auth_user_id"] != str(current_user.id):
            raise HTTPException(status_code=403, detail="You do not have access to this session.")

    try:
        return rpe_feedback_service.generate_feedback(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}")


@rpe_router.get("/my-sessions")
def my_sessions(
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Returns all RPE sessions for the authenticated user."""
    return rpe_session_service.get_user_sessions(str(current_user.id))
