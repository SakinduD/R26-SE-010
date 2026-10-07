import logging
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
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
    SessionIdsRequest,
    StartSessionRequest,
    StartSessionResponse,
)
from app.services.rpe_apa_service        import ApaLearnerProfile, RpeApaService
from app.services.rpe_apm_notify_service import RpeApmNotifyService
from app.services.rpe_blind_spot_service import RpeBlindSpotService
from app.services.rpe_coaching_service   import RpeCoachingService
from app.services.rpe_emotion_service    import RpeEmotionService
from app.services              import rpe_escalation_ml_service
from app.services.rpe_feedback_service   import RpeFeedbackService
from app.services              import rpe_llm_debug
from app.services.rpe_nlp_service        import RpeNlpService
from app.services.rpe_npc_service        import RpeNpcService
from app.services              import rpe_plan_import_service
from app.services.rpe_predictive_service import RpePredictiveService
from app.services.rpe_scenario_service   import RpeScenarioService, derive_npc_gender
from app.services.rpe_session_service    import RpeSessionService
from app.services.rpe_viz_service        import RpeVizService

logger = logging.getLogger(__name__)

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
rpe_apm_notify_service = RpeApmNotifyService(
    session_service  = rpe_session_service,
    feedback_service = rpe_feedback_service,
)

rpe_router = APIRouter()


MAX_ACTIVE_SESSIONS = 3


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

    # Cap applies to signed-in learners only — a guest has no stable
    # identity to track "their" sessions against in the first place (My
    # Sessions itself is auth-only), so there's nothing to cap.
    if auth_user_id:
        active = rpe_session_service.get_active_sessions(auth_user_id)
        if len(active) >= MAX_ACTIVE_SESSIONS:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "active_session_limit",
                    "message": (
                        f"You already have {len(active)} unfinished sessions. "
                        "Finish or resume one before starting another."
                    ),
                    "active_sessions": [
                        {
                            "session_id":  s["session_id"],
                            "scenario_id": s["scenario_id"],
                            "started_at":  s["started_at"],
                        }
                        for s in active
                    ],
                },
            )

    scenario = rpe_scenario_service.get_scenario(payload.scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario '{payload.scenario_id}' not found.")
    effective_npc_name = (payload.npc_name or "").strip() or scenario.npc_role

    try:
        state = rpe_session_service.start_session(
            scenario_id  = payload.scenario_id,
            user_id      = resolved_user_id,
            auth_user_id = auth_user_id,
            npc_name     = effective_npc_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

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
        failure_escalation_threshold = scenario.end_conditions.get("failure_escalation_threshold"),
        npc_gender        = derive_npc_gender(scenario.scenario_id),
        npc_name          = effective_npc_name,
    )


@rpe_router.post("/from-plan/{plan_id}", response_model=ScenarioDetail)
async def generate_scenario_from_plan(
    plan_id:      str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Generate a scenario from an APM Training Plan brief and return its
    detail — same shape as /scenarios/detail/{scenario_id} — without
    starting a session. Target of RolePlaySession's ?planId= entry point
    (see frontend/src/components/training-plan/StartRolePlayButton.jsx).

    Deliberately does NOT start a session (it used to, in one eager call):
    that skipped the "view details, pick an avatar, name them" screen every
    other scenario gets, since a session already existed before the learner
    ever saw the scenario. Generating only, then letting the frontend show
    the normal detail modal and call /start-session itself once the learner
    is ready, gives generated scenarios the exact same customizable start
    as hand-authored ones — no special-cased shortcut to keep in sync.

    Requires auth (unlike /start-session) — a plan_id carries one learner's
    Big Five profile and stated goal, so generating from it isn't something
    a guest should be able to do for an arbitrary plan_id.
    """
    try:
        scenario_id = await rpe_plan_import_service.generate_and_persist_scenario(plan_id)
    except rpe_plan_import_service.PlanImportError as exc:
        raise HTTPException(status_code=exc.status_code or 502, detail=str(exc))

    rpe_scenario_service.load_all()

    scenario = rpe_scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found after generation.")

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
        "category":          scenario.category,
        "npc_gender":        derive_npc_gender(scenario.scenario_id),
    }


@rpe_router.post("/session-respond", response_model=RespondResponse)
def session_respond(
    payload:      RespondRequest,
    current_user: User | None = Depends(get_current_user_optional),
) -> RespondResponse:
    # Latency instrumentation (DEV only — see the single summary line logged
    # at the bottom of this function). T-labels match the RPE voice latency
    # optimization pass's own naming: T2 = backend receives the request
    # (here, since FastAPI has already parsed the body by this point),
    # T3-T5 = the NPC LLM call collapsed into one span (this codebase makes
    # one non-streaming httpx/SDK call — there is no real "first byte"
    # without switching to streaming, see the optimization report's
    # streaming-investigation section), T6-T7 = end-detection LLM call,
    # T8 = response about to be returned to the frontend.
    t2 = time.time()
    timings: dict[str, float] = {}

    def _mark(label: str, since: float) -> float:
        now = time.time()
        timings[label] = round((now - since) * 1000)
        return now

    try:
        state = rpe_session_service.get_state(payload.session_id)
        if not state:
            raise HTTPException(status_code=404, detail=f"Session '{payload.session_id}' not found.")

        t = time.time()
        try:
            session_data = rpe_session_service.get_session(payload.session_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        t = _mark("get_session_ms", t)

        prior_turns: list[dict]     = session_data.get("turns", [])
        opening_npc_line: str       = session_data.get("opening_npc_line", "")
        trust_history: list[int]    = session_data.get("trust_history", [50])
        emotion_history: list[str]  = session_data.get("emotion_history", ["calm"])
        current_trust: int          = trust_history[-1] if trust_history else 50
        current_esc: int            = prior_turns[-1]["escalation_level"] if prior_turns else 0
        # Conversation Intelligence — the previous turn's own tracked state,
        # fed back into the prompt so the NPC evolves it instead of
        # regenerating from nothing (see rpe_npc_service._format_conversation_state).
        # None on the opening turn, or for an older turn logged before this
        # field existed — both handled the same way (prompt says "opening turn").
        prior_conversation_state: dict | None = (
            prior_turns[-1].get("conversation_state") if prior_turns else None
        )

        scenario = rpe_scenario_service.get_scenario(state.scenario_id)

        # 1. Profanity check first — bypasses LLM classification
        is_profane: bool = rpe_emotion_service.is_profanity(payload.user_input)

        # 2. Combined NPC response + emotion + animation (OpenAI or Groq, per USE_OPENAI)
        # T3-T5 collapsed into one span — see this function's own docstring-
        # style comment at the top for why (no streaming today).
        t = time.time()
        result       = rpe_npc_service.generate_response(
            user_input       = payload.user_input,
            opening_npc_line = opening_npc_line,
            session_turns    = prior_turns,
            npc_role         = scenario.npc_role,
            npc_personality  = scenario.npc_personality,
            context          = scenario.context,
            trust_score      = current_trust,
            escalation_level = current_esc,
            npc_behaviour    = scenario.npc_behaviour,
            prior_conversation_state = prior_conversation_state,
            session_id       = payload.session_id,
        )
        t = _mark("llm_dialogue_ms", t)
        npc_response  = result["npc_response"]
        animation     = result.get("animation")
        user_behavior = result.get("user_behavior")
        requests_deliverable = result.get("requests_deliverable", False)
        response_options     = result.get("response_options")
        interaction_type     = result.get("interaction_type", "normal")
        content_prompt       = result.get("content_prompt")
        content_type         = result.get("content_type")
        conversation_state   = result.get("conversation_state") or {}

        # 3. Profanity override wins over LLM classification
        emotion: str = "frustrated" if is_profane else result["detected_emotion"]

        # 4. Trust / escalation update
        new_trust = rpe_emotion_service.update_trust(current_trust, emotion, payload.user_input)
        new_esc   = rpe_emotion_service.update_escalation(current_esc, emotion)

        # Advisory-only ML escalation read — never feeds into new_trust/new_esc
        # or anything derived from them; best-effort, returns None on any
        # failure so a missing/broken model can never break a live turn.
        t = time.time()
        ml_escalation = rpe_escalation_ml_service.predict_escalation(payload.user_input)
        t = _mark("ml_escalation_ms", t)

        turn_number = rpe_session_service.advance_turn(payload.session_id)
        turn_data = {
            "turn":             turn_number,
            "user_input":       payload.user_input,
            "npc_response":     npc_response,
            "emotion":          emotion,
            "trust_score":      new_trust,
            "escalation_level": new_esc,
            "user_behavior":    user_behavior,
            # Conversation Intelligence — persisted so the NEXT turn's
            # prior_conversation_state (above) and session recovery both
            # have it (see rpe_session_service.log_turn/_get_session_supabase
            # and the frontend's recoveredTurns handling).
            "conversation_state": conversation_state,
        }
        # log_turn (Supabase write) and should_conversation_end (LLM call,
        # from turn 5+) are independent of each other's result — neither
        # reads anything the other produces — but were previously run
        # sequentially. Measured baseline: log_turn ~200-730ms, end_detection
        # ~400-1500ms once it actually calls Groq (turn 5+); run
        # concurrently, the wall-clock cost is max(the two) instead of
        # their sum. Both are still awaited below before anything that
        # needs their results (should_end_session needs trust_history from
        # log_turn; the outer if/else needs llm_should_end).
        # Temporary per-branch timers (in addition to the outer wall-clock
        # mark below) — proves the parallelization is actually overlapping
        # the two calls (wall_ms << log_turn_ms + end_detection_ms) rather
        # than accidentally serializing them, independent of whatever
        # absolute network conditions are doing to either call's own
        # duration on a given run.
        def _timed_log_turn():
            t0 = time.time()
            result = rpe_session_service.log_turn(
                payload.session_id, turn_data,
                current_emotion_history=emotion_history, current_trust_history=trust_history,
            )
            return result, round((time.time() - t0) * 1000)

        def _timed_end_detection():
            t0 = time.time()
            result = rpe_npc_service.should_conversation_end(
                session_turns=prior_turns, npc_response=npc_response, user_input=payload.user_input,
            )
            return result, round((time.time() - t0) * 1000)

        t = time.time()
        with ThreadPoolExecutor(max_workers=2) as executor:
            log_turn_future = executor.submit(_timed_log_turn)
            end_detection_future = executor.submit(_timed_end_detection)
            (emotion_history, trust_history), log_turn_solo_ms = log_turn_future.result()
            (llm_should_end, llm_end_reason), end_detection_solo_ms = end_detection_future.result()
        t = _mark("log_turn_and_end_detection_parallel_ms", t)
        timings["log_turn_solo_ms"] = log_turn_solo_ms
        timings["end_detection_solo_ms"] = end_detection_solo_ms

        # Live per-turn clarity/quality for the session sidebar meters — the
        # same pure local heuristic (word count + keyword matching, no LLM
        # call) rpe_nlp_service already runs post-session for the feedback
        # screen, just run once here so it's available while the user is
        # still talking instead of only after the session ends.
        live_metrics = rpe_nlp_service._score_turn(turn_data)

        outcome: str | None = None
        if llm_should_end:
            should_end = True
            if llm_end_reason == "user_exit_intent":
                end_reason = "user_exit_intent"
                outcome    = "ended_by_user"
            else:
                end_reason = "natural_resolution"
                criteria   = scenario.success_criteria
                outcome    = (
                    "success"
                    if new_trust >= criteria["min_trust_score"]
                    and new_esc  <= criteria["max_escalation_level"]
                    else "failure"
                )
        else:
            # prior_turns excludes the turn just logged, so count it via the
            # is_profane flag already computed for it above (step 1) instead
            # of re-reading the session to see the just-inserted row.
            profanity_count = sum(
                1 for t in prior_turns
                if rpe_emotion_service.is_profanity(t.get("user_input", ""))
            ) + (1 if is_profane else 0)
            should_end, end_reason = rpe_session_service.should_end_session(
                session_id        = payload.session_id,
                max_turns         = scenario.max_turns,
                recommended_turns = scenario.recommended_turns,
                end_conditions    = scenario.end_conditions,
                trust_history     = trust_history,
                current_turn      = turn_number,
                profanity_count   = profanity_count,
            )

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

        if should_end:
            rpe_session_service.finalize_session(
                payload.session_id, outcome, new_trust, new_esc, end_reason
            )

        # T8 — response about to leave the backend. DEV-only, single
        # structured line so it's easy to grep/aggregate across many turns
        # for p50/p95 without spamming the log at INFO on every request.
        # logger.warning, not .info — this app has no logging handler
        # configured for INFO (confirmed: .info() calls never reached the
        # console at all; only WARNING+ gets Python's default lastResort
        # handler), and adding real logging config is out of scope here.
        total_ms = round((time.time() - t2) * 1000)
        if get_settings().app_env == "development":
            solo_sum = (timings.get("log_turn_solo_ms") or 0) + (timings.get("end_detection_solo_ms") or 0)
            logger.warning(
                "[RPE latency] turn=%s total_ms=%s get_session=%s llm_dialogue=%s "
                "ml_escalation=%s parallel_wall=%s (log_turn_solo=%s end_detection_solo=%s sum_would_be=%s)",
                turn_number, total_ms,
                timings.get("get_session_ms"), timings.get("llm_dialogue_ms"),
                timings.get("ml_escalation_ms"), timings.get("log_turn_and_end_detection_parallel_ms"),
                timings.get("log_turn_solo_ms"), timings.get("end_detection_solo_ms"), solo_sum,
            )

        return RespondResponse(
            npc_response=npc_response,
            emotion=emotion,
            animation=animation,
            user_behavior=user_behavior,
            trust_score=new_trust,
            escalation_level=new_esc,
            turn=turn_number,
            session_complete=should_end,
            outcome=outcome,
            end_reason=end_reason if should_end else None,
            # Never offer choice cards (or a content/direct input dock) on
            # the turn that ends the session — there's no next turn for a
            # submitted document/content to land on.
            requests_deliverable=requests_deliverable and not should_end,
            response_options=response_options if not should_end else None,
            interaction_type=interaction_type if not should_end else "normal",
            content_prompt=content_prompt if not should_end else None,
            content_type=content_type if not should_end else None,
            clarity_score=live_metrics["clarity_score"],
            response_quality=live_metrics["response_quality"],
            ml_escalation_label=ml_escalation["label"] if ml_escalation else None,
            ml_escalation_confidence=ml_escalation["confidence"] if ml_escalation else None,
            npc_objective=conversation_state.get("npc_objective"),
            conversation_phase=conversation_state.get("conversation_phase"),
            unresolved_items=conversation_state.get("unresolved_items") or [],
            commitments=conversation_state.get("commitments") or [],
            agreed_deadlines=conversation_state.get("agreed_deadlines") or [],
            requested_items=conversation_state.get("requested_items") or [],
            user_constraints=conversation_state.get("user_constraints") or [],
            recent_topics=conversation_state.get("recent_topics") or [],
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
def list_scenarios(
    current_user: User | None = Depends(get_current_user_optional),
) -> list[dict]:
    return rpe_scenario_service.list_all(
        current_user_id=str(current_user.id) if current_user else None
    )


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
        "category":          scenario.category,
        "npc_gender":        derive_npc_gender(scenario.scenario_id),
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
        rpe_session_service.get_session(payload.session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    # Real APM notification (see rpe_apm_notify_service.py) — payload.user_id
    # is ignored here; the outbound call uses the session's own stored
    # auth_user_id, since a client-supplied id shouldn't be trusted for a
    # privileged cross-service call.
    sent = rpe_apm_notify_service.notify_session_complete(payload.session_id)
    return {"status": "notified" if sent else "skipped"}


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
    trashed:      bool = False,
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Returns RPE sessions for the authenticated user — active by default,
    or the recycle bin when trashed=true."""
    return rpe_session_service.get_user_sessions(str(current_user.id), trashed=trashed)


@rpe_router.post("/sessions/trash")
def trash_sessions(
    payload:      SessionIdsRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Move sessions into the recycle bin (soft delete)."""
    rpe_session_service.set_sessions_deleted(str(current_user.id), payload.session_ids, deleted=True)
    return {"status": "trashed", "count": len(payload.session_ids)}


@rpe_router.post("/sessions/restore")
def restore_sessions(
    payload:      SessionIdsRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Move sessions out of the recycle bin, back to active."""
    rpe_session_service.set_sessions_deleted(str(current_user.id), payload.session_ids, deleted=False)
    return {"status": "restored", "count": len(payload.session_ids)}


@rpe_router.post("/sessions/purge")
def purge_sessions(
    payload:      SessionIdsRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Permanently delete sessions — irreversible, cascades to their turns."""
    rpe_session_service.purge_sessions(str(current_user.id), payload.session_ids)
    return {"status": "purged", "count": len(payload.session_ids)}


# ── LLM Payload Inspector (DEV only — see rpe_llm_debug.py) ──────────────
# Gated on settings.debug, not auth: this is structural/quantitative data
# (char counts, token estimates, hashes) about the app's own prompt
# construction, never raw learner text — see rpe_llm_debug.py's module
# docstring. Every route here 404s outside settings.debug, so production
# exposes nothing — no debug payload data, not even an empty-shaped 200.

def _require_debug_mode() -> None:
    if not rpe_llm_debug.debug_enabled():
        raise HTTPException(status_code=404, detail="Not found.")


@rpe_router.get("/llm/debug/latest")
def llm_debug_latest() -> dict:
    _require_debug_mode()
    record = rpe_llm_debug.get_latest()
    if not record:
        raise HTTPException(status_code=404, detail="No LLM turns captured yet this process.")
    return rpe_llm_debug.public_view(record)


@rpe_router.get("/llm/debug/session/{session_id}")
def llm_debug_session(session_id: str) -> dict:
    _require_debug_mode()
    captures = rpe_llm_debug.get_session_captures(session_id)
    if not captures:
        raise HTTPException(status_code=404, detail=f"No captured LLM turns for session '{session_id}'.")
    return {
        "session_id": session_id,
        "turns": [rpe_llm_debug.public_view(r) for r in captures],
    }


@rpe_router.get("/llm/debug/sessions")
def llm_debug_sessions() -> dict:
    """Session ids with at least one captured turn still in memory —
    lets the DEV inspector page offer a session picker without the caller
    needing to already know a session id."""
    _require_debug_mode()
    return {"session_ids": rpe_llm_debug.list_sessions()}


@rpe_router.get("/llm/debug/providers")
def llm_debug_providers() -> dict:
    """Section 20 — provider comparison, aggregated on read across every
    session still held in memory (see rpe_llm_debug.get_provider_comparison)."""
    _require_debug_mode()
    return {"providers": rpe_llm_debug.get_provider_comparison()}
