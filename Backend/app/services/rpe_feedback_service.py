from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.rpe_session_service    import RpeSessionService
    from app.services.rpe_scenario_service   import RpeScenarioService
    from app.services.rpe_nlp_service        import RpeNlpService
    from app.services.rpe_predictive_service import RpePredictiveService
    from app.services.rpe_blind_spot_service import RpeBlindSpotService
    from app.services.rpe_coaching_service   import RpeCoachingService
    from app.services.rpe_viz_service        import RpeVizService


class RpeFeedbackService:
    def __init__(
        self,
        session_service:    RpeSessionService,
        scenario_service:   RpeScenarioService,
        nlp_service:        RpeNlpService,
        predictive_service: RpePredictiveService,
        blind_spot_service: RpeBlindSpotService,
        coaching_service:   RpeCoachingService,
        viz_service:        RpeVizService,
    ) -> None:
        self._session    = session_service
        self._scenario   = scenario_service
        self._nlp        = nlp_service
        self._predictive = predictive_service
        self._blind_spot = blind_spot_service
        self._coaching   = coaching_service
        self._viz        = viz_service

    def generate_feedback(self, session_id: str) -> dict:
        """
        Master orchestrator. Runs all feedback modules in sequence
        and returns a single structured feedback report dict.
        """
        session  = self._session.get_session(session_id)
        scenario = self._scenario.get_scenario(session["scenario_id"])

        turns             = session.get("turns", [])
        trust_history     = session.get("trust_history", [50])
        emotion_history   = session.get("emotion_history", ["calm"])
        end_reason        = session.get("end_reason", "max_turns_reached")
        recommended_turns = session.get("recommended_turns", 6)
        max_turns         = session.get("max_turns", 15)

        turn_metrics = self._nlp.analyse_turns(turns)
        risk_flags   = self._predictive.detect_risk_patterns(
            turns, trust_history, emotion_history
        )
        blind_spots  = self._blind_spot.detect(turns, scenario.success_criteria)
        coaching     = self._coaching.generate_advice(
            session, scenario, turn_metrics, risk_flags, blind_spots,
            end_reason=end_reason,
        )
        viz_payload  = self._viz.build(
            turns, trust_history, emotion_history, turn_metrics,
            end_reason=end_reason,
        )

        return {
            "session_id":        session_id,
            "scenario_id":       session["scenario_id"],
            "scenario_title":    scenario.title,
            "user_id":           session["user_id"],
            "outcome":           session.get("outcome"),
            "final_trust":       session.get("final_trust"),
            "final_escalation":  session.get("final_escalation"),
            "total_turns":       len(turns),
            "turn_metrics":      turn_metrics,
            "risk_flags":        risk_flags,
            "blind_spots":       blind_spots,
            "coaching_advice":   coaching,
            "viz_payload":       viz_payload,
            "end_reason":        end_reason,
            "recommended_turns": recommended_turns,
            "max_turns":         max_turns,
        }
