from __future__ import annotations

from app.api.v1.rpe.engine.conflict_tracker import ConflictTracker
from app.api.v1.rpe.engine.emotional_memory import EmotionalMemory
from app.api.v1.rpe.engine.flow_controller import FlowController
from app.api.v1.rpe.engine.npc_dialogue_engine import NpcDialogueEngine
from app.api.v1.rpe.engine.scenario_manager import ScenarioManager
from app.api.v1.rpe.engine.session_logger import SessionLogger
from app.api.v1.rpe.engine.trust_tracker import TrustTracker

_DEFAULT_TRUST = 50
_DEFAULT_ESCALATION = 0


class UserInteractionHandler:
    def __init__(
        self,
        scenario_manager: ScenarioManager,
        flow_controller: FlowController,
        npc_engine: NpcDialogueEngine,
        emotional_memory: EmotionalMemory,
        trust_tracker: TrustTracker,
        conflict_tracker: ConflictTracker,
        session_logger: SessionLogger,
    ) -> None:
        self._sm = scenario_manager
        self._fc = flow_controller
        self._npc = npc_engine
        self._em = emotional_memory
        self._tt = trust_tracker
        self._ct = conflict_tracker
        self._sl = session_logger

    def handle_turn(self, session_id: str, user_input: str) -> dict:
        # 1. Read history BEFORE logging the current turn
        session_data = self._sl.get_session(session_id)
        prior_turns: list[dict] = session_data["turns"]

        state = self._fc.get_session(session_id)
        scenario = self._sm.load_scenario(state.scenario_id)

        current_trust = prior_turns[-1]["trust_score"] if prior_turns else _DEFAULT_TRUST
        current_escalation = (
            prior_turns[-1]["escalation_level"] if prior_turns else _DEFAULT_ESCALATION
        )

        # 2. Detect emotion
        emotion = self._em.detect_emotion(user_input)

        # 3. Update trust
        new_trust = self._tt.update(current_trust, emotion)

        # 4. Update escalation
        new_escalation = self._ct.update(current_escalation, emotion)

        # 5. Generate NPC response (passes prior history only)
        npc_response = self._npc.generate_response(
            npc_role=scenario.npc_role,
            npc_personality=scenario.npc_personality,
            context=scenario.context,
            user_input=user_input,
            opening_npc_line=scenario.opening_npc_line,
            session_turns=prior_turns,
            trust_score=new_trust,
            escalation_level=new_escalation,
            trust_thresholds=scenario.npc_behaviour["trust_thresholds"],
            escalation_thresholds=scenario.npc_behaviour["escalation_thresholds"],
        )

        # 6. Advance turn counter
        state = self._fc.advance_turn(session_id)

        # 7. Log turn
        turn_data = {
            "turn": state.current_turn,
            "user_input": user_input,
            "npc_response": npc_response,
            "emotion": emotion,
            "trust_score": new_trust,
            "escalation_level": new_escalation,
        }
        self._sl.log_turn(session_id, turn_data)

        # 8. Check completion
        session_complete = state.current_turn >= scenario.turns
        if session_complete:
            criteria = scenario.success_criteria
            succeeded = (
                new_trust >= criteria.get("min_trust_score", 0)
                and new_escalation <= criteria.get("max_escalation_level", 5)
            )
            self._sl.finalize_session(
                session_id,
                {
                    "succeeded": succeeded,
                    "final_trust_score": new_trust,
                    "final_escalation_level": new_escalation,
                },
            )
            self._fc.end_session(session_id)

        return {
            "npc_response": npc_response,
            "emotion": emotion,
            "trust_score": new_trust,
            "escalation_level": new_escalation,
            "turn": state.current_turn,
            "session_complete": session_complete,
        }
