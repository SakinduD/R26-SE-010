from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from app.api.v1.rpe.engine.scenario_manager import ScenarioManager

_scenario_manager = ScenarioManager()


@dataclass
class SessionState:
    session_id: str
    scenario_id: str
    user_id: str
    current_turn: int
    started_at: datetime = field(default_factory=datetime.utcnow)


class FlowController:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}

    def start_session(self, scenario_id: str, user_id: str) -> SessionState:
        available = _scenario_manager.available_ids()
        if scenario_id not in available:
            raise ValueError(
                f"Scenario '{scenario_id}' not found. Available: {available}"
            )
        state = SessionState(
            session_id=str(uuid.uuid4()),
            scenario_id=scenario_id,
            user_id=user_id,
            current_turn=0,
        )
        self._sessions[state.session_id] = state
        return state

    def advance_turn(self, session_id: str) -> SessionState:
        state = self._sessions[session_id]
        state.current_turn += 1
        return state

    def end_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def get_session(self, session_id: str) -> SessionState | None:
        return self._sessions.get(session_id)
