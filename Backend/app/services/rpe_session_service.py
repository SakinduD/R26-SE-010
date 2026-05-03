import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.services.rpe_scenario_service import RpeScenarioService

BASE_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = BASE_DIR / "models" / "rpe" / "logs" / "sessions"


@dataclass
class SessionState:
    session_id: str
    scenario_id: str
    user_id: str
    current_turn: int
    started_at: str


class RpeSessionService:
    def __init__(self, scenario_service: RpeScenarioService) -> None:
        self._scenario_service = scenario_service
        self._sessions: dict[str, SessionState] = {}
        LOGS_DIR.mkdir(parents=True, exist_ok=True)

    def start_session(self, scenario_id: str, user_id: str) -> SessionState:
        scenario = self._scenario_service.get_scenario(scenario_id)
        if not scenario:
            raise ValueError(
                f"Scenario '{scenario_id}' not found. "
                f"Available: {self._scenario_service.available_ids()}"
            )
        session_id = str(uuid4())
        state = SessionState(
            session_id=session_id,
            scenario_id=scenario_id,
            user_id=user_id,
            current_turn=0,
            started_at=datetime.utcnow().isoformat(),
        )
        self._sessions[session_id] = state
        self._write_session_file(session_id, {
            "session_id": session_id,
            "scenario_id": scenario_id,
            "user_id": user_id,
            "started_at": state.started_at,
            "opening_npc_line": scenario.opening_npc_line,
            "turns": [],
            "emotion_history": ["calm"],
            "trust_history": [50],
            "ended_at": None,
            "outcome": None,
            "final_trust": None,
            "final_escalation": None,
        })
        return state

    def advance_turn(self, session_id: str) -> int:
        self._sessions[session_id].current_turn += 1
        return self._sessions[session_id].current_turn

    def get_state(self, session_id: str) -> SessionState | None:
        if session_id in self._sessions:
            return self._sessions[session_id]
        # Reconstruct from disk after a server restart
        path = LOGS_DIR / f"{session_id}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            state = SessionState(
                session_id=data["session_id"],
                scenario_id=data["scenario_id"],
                user_id=data["user_id"],
                current_turn=len(data.get("turns", [])),
                started_at=data["started_at"],
            )
            self._sessions[session_id] = state
            return state
        except Exception:
            return None

    def is_complete(self, session_id: str, total_turns: int) -> bool:
        state = self._sessions.get(session_id)
        return state is not None and state.current_turn >= total_turns

    def log_turn(self, session_id: str, turn_data: dict) -> None:
        data = self._read_session_file(session_id)
        data["turns"].append(turn_data)
        data["emotion_history"].append(turn_data["emotion"])
        data["trust_history"].append(turn_data["trust_score"])
        self._write_session_file(session_id, data)

    def get_session(self, session_id: str) -> dict:
        return self._read_session_file(session_id)

    def finalize_session(
        self,
        session_id: str,
        outcome: str,
        final_trust: int,
        final_escalation: int,
    ) -> None:
        data = self._read_session_file(session_id)
        data["ended_at"] = datetime.utcnow().isoformat()
        data["outcome"] = outcome
        data["final_trust"] = final_trust
        data["final_escalation"] = final_escalation
        self._write_session_file(session_id, data)

    def _write_session_file(self, session_id: str, data: dict) -> None:
        path = LOGS_DIR / f"{session_id}.json"
        path.write_text(json.dumps(data, indent=2))

    def _read_session_file(self, session_id: str) -> dict:
        path = LOGS_DIR / f"{session_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"Session '{session_id}' not found.")
        return json.loads(path.read_text())
