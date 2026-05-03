from __future__ import annotations

import json
import os
from datetime import datetime

_SESSIONS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "logs", "sessions")
)


class SessionLogger:
    def _path(self, session_id: str) -> str:
        return os.path.join(_SESSIONS_DIR, f"{session_id}.json")

    def create_session(
        self,
        session_id: str,
        scenario_id: str,
        user_id: str,
        opening_npc_line: str,
    ) -> None:
        os.makedirs(_SESSIONS_DIR, exist_ok=True)
        data = {
            "session_id": session_id,
            "scenario_id": scenario_id,
            "user_id": user_id,
            "opening_npc_line": opening_npc_line,
            "started_at": datetime.utcnow().isoformat(),
            "ended_at": None,
            "outcome": None,
            "turns": [],
        }
        with open(self._path(session_id), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def log_turn(self, session_id: str, turn_data: dict) -> None:
        path = self._path(session_id)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["turns"].append(turn_data)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def get_session(self, session_id: str) -> dict:
        with open(self._path(session_id), "r", encoding="utf-8") as f:
            return json.load(f)

    def finalize_session(self, session_id: str, outcome: dict) -> None:
        path = self._path(session_id)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["ended_at"] = datetime.utcnow().isoformat()
        data["outcome"] = outcome
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
