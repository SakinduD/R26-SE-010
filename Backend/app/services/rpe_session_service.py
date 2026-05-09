"""
RPE Session Service — Supabase primary storage with JSON fallback.

Tables:
  rpe_sessions  (session_id PK, scenario_id, user_id, started_at, ended_at,
                 outcome, final_trust, final_escalation, end_reason,
                 recommended_turns, max_turns, opening_npc_line,
                 emotion_history jsonb, trust_history jsonb)

  rpe_turns     (id serial PK, session_id FK, turn int, user_input,
                 npc_response, emotion, trust_score, escalation_level,
                 created_at timestamptz)
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from supabase import create_client, Client

from app.config import get_settings

settings = get_settings()
from app.services.rpe_scenario_service import RpeScenarioService

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = BASE_DIR / "models" / "rpe" / "logs" / "sessions"

# ── Supabase singleton ────────────────────────────────────────────────────────

_supabase_client: Client | None = None


def _get_supabase() -> Client | None:
    """Return a lazily-initialised Supabase client, or None if not configured."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    url = getattr(settings, "supabase_url", "")
    key = getattr(settings, "supabase_service_role_key", "")
    if not url or not key:
        logger.warning("Supabase credentials not configured — using JSON-only storage.")
        return None
    try:
        _supabase_client = create_client(url, key)
        logger.info("Supabase client initialised.")
        return _supabase_client
    except Exception as exc:
        logger.error("Failed to initialise Supabase client: %s", exc)
        return None


# ── Session state dataclass ───────────────────────────────────────────────────

@dataclass
class SessionState:
    session_id:   str
    scenario_id:  str
    user_id:      str
    current_turn: int
    started_at:   str
    end_reason:   str | None = None


# ── Service ───────────────────────────────────────────────────────────────────

class RpeSessionService:
    def __init__(self, scenario_service: RpeScenarioService) -> None:
        self._scenario_service = scenario_service
        self._sessions: dict[str, SessionState] = {}
        LOGS_DIR.mkdir(parents=True, exist_ok=True)

    # ── Public API ────────────────────────────────────────────────────────────

    def start_session(
        self,
        scenario_id:  str,
        user_id:      str,
        auth_user_id: str | None = None,
    ) -> SessionState:
        scenario = self._scenario_service.get_scenario(scenario_id)
        if not scenario:
            raise ValueError(
                f"Scenario '{scenario_id}' not found. "
                f"Available: {self._scenario_service.available_ids()}"
            )
        session_id = str(uuid4())
        started_at = datetime.now(timezone.utc).isoformat()

        state = SessionState(
            session_id=session_id,
            scenario_id=scenario_id,
            user_id=user_id,
            current_turn=0,
            started_at=started_at,
        )
        self._sessions[session_id] = state

        payload: dict = {
            "session_id":        session_id,
            "scenario_id":       scenario_id,
            "user_id":           user_id,
            "auth_user_id":      auth_user_id,
            "started_at":        started_at,
            "opening_npc_line":  scenario.opening_npc_line,
            "emotion_history":   ["calm"],
            "trust_history":     [50],
            "turns":             [],
            "ended_at":          None,
            "outcome":           None,
            "final_trust":       None,
            "final_escalation":  None,
            "end_reason":        None,
            "recommended_turns": None,
            "max_turns":         None,
        }

        self._persist_session(session_id, payload)
        return state

    def store_session_config(
        self,
        session_id:        str,
        recommended_turns: int,
        max_turns:         int,
    ) -> None:
        """Persist recommended_turns and max_turns after session is started."""
        sb = _get_supabase()
        if sb:
            try:
                sb.table("rpe_sessions").update(
                    {"recommended_turns": recommended_turns, "max_turns": max_turns}
                ).eq("session_id", session_id).execute()
            except Exception as exc:
                logger.error("Supabase store_session_config failed: %s", exc)

        # Always update JSON
        try:
            data = self._read_json(session_id)
            data["recommended_turns"] = recommended_turns
            data["max_turns"]          = max_turns
            self._write_json(session_id, data)
        except Exception as exc:
            logger.error("JSON store_session_config failed: %s", exc)

    def advance_turn(self, session_id: str) -> int:
        self._sessions[session_id].current_turn += 1
        return self._sessions[session_id].current_turn

    def get_state(self, session_id: str) -> SessionState | None:
        # Fast path — in-memory
        if session_id in self._sessions:
            return self._sessions[session_id]

        # Reconstruct from Supabase
        sb = _get_supabase()
        if sb:
            try:
                resp = (
                    sb.table("rpe_sessions")
                    .select("session_id, scenario_id, user_id, started_at, end_reason")
                    .eq("session_id", session_id)
                    .single()
                    .execute()
                )
                row = resp.data
                if row:
                    # Count turns from rpe_turns table
                    turns_resp = (
                        sb.table("rpe_turns")
                        .select("id", count="exact")
                        .eq("session_id", session_id)
                        .execute()
                    )
                    turn_count = turns_resp.count or 0
                    state = SessionState(
                        session_id=row["session_id"],
                        scenario_id=row["scenario_id"],
                        user_id=row["user_id"],
                        current_turn=turn_count,
                        started_at=row["started_at"],
                        end_reason=row.get("end_reason"),
                    )
                    self._sessions[session_id] = state
                    return state
            except Exception as exc:
                logger.warning("Supabase get_state failed, trying JSON: %s", exc)

        # Reconstruct from JSON (--reload resilience / Supabase unavailable)
        path = LOGS_DIR / f"{session_id}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            state = SessionState(
                session_id=data["session_id"],
                scenario_id=data["scenario_id"],
                user_id=data["user_id"],
                current_turn=len(data.get("turns", [])),
                started_at=data["started_at"],
                end_reason=data.get("end_reason"),
            )
            self._sessions[session_id] = state
            return state
        except Exception as exc:
            logger.error("JSON get_state failed: %s", exc)
            return None

    def should_end_session(
        self,
        session_id:        str,
        max_turns:         int,
        recommended_turns: int,
        end_conditions:    dict,
        trust_history:     list[int],
        escalation_level:  int,
        current_turn:      int,
        profanity_count:   int = 0,
    ) -> tuple[bool, str | None]:
        """
        Evaluate whether the session should end.
        Returns (should_end, end_reason | None).

        Priority:
          0. npc_exit (profanity) — immediate exit if user used profanity 3+ times
          1. max_turns_reached    — hard cap
          2. trust_sustained      — trust ≥ threshold for N consecutive turns
          3. npc_exit             — escalation ≥ failure threshold
        """
        # Immediate NPC exit on repeated profanity
        if profanity_count >= 3:
            return True, "npc_exit"

        if current_turn >= max_turns:
            return True, "max_turns_reached"

        success_threshold  = end_conditions.get("success_trust_threshold", 70)
        consecutive_needed = end_conditions.get("success_consecutive_turns", 2)
        if len(trust_history) >= consecutive_needed:
            if all(t >= success_threshold for t in trust_history[-consecutive_needed:]):
                return True, "trust_sustained"

        failure_escalation = end_conditions.get("failure_escalation_threshold", 5)
        if escalation_level >= failure_escalation:
            return True, "npc_exit"

        return False, None

    def log_turn(self, session_id: str, turn_data: dict) -> None:
        """Append a completed turn to both Supabase and JSON."""
        sb = _get_supabase()
        if sb:
            try:
                # Insert into rpe_turns
                sb.table("rpe_turns").insert({
                    "session_id":       session_id,
                    "turn":             turn_data["turn"],
                    "user_input":       turn_data.get("user_input", ""),
                    "npc_response":     turn_data.get("npc_response", ""),
                    "emotion":          turn_data.get("emotion", "calm"),
                    "trust_score":      turn_data.get("trust_score", 50),
                    "escalation_level": turn_data.get("escalation_level", 0),
                    "created_at":       datetime.now(timezone.utc).isoformat(),
                }).execute()

                # Update running history arrays in rpe_sessions
                session_row = (
                    sb.table("rpe_sessions")
                    .select("emotion_history, trust_history")
                    .eq("session_id", session_id)
                    .single()
                    .execute()
                ).data or {}
                emotion_history = session_row.get("emotion_history") or ["calm"]
                trust_history   = session_row.get("trust_history")   or [50]
                emotion_history.append(turn_data.get("emotion", "calm"))
                trust_history.append(turn_data.get("trust_score", 50))
                sb.table("rpe_sessions").update({
                    "emotion_history": emotion_history,
                    "trust_history":   trust_history,
                }).eq("session_id", session_id).execute()

            except Exception as exc:
                logger.error("Supabase log_turn failed: %s", exc)

        # Always write JSON fallback
        self._log_turn_json(session_id, turn_data)

    def get_session(self, session_id: str) -> dict:
        """
        Return the session dict (same structure as old JSON file).
        Tries Supabase first; falls back to JSON.
        """
        sb = _get_supabase()
        if sb:
            try:
                data = self._get_session_supabase(sb, session_id)
                if data:
                    return data
            except Exception as exc:
                logger.warning("Supabase get_session failed, using JSON: %s", exc)
        return self._read_json(session_id)

    def finalize_session(
        self,
        session_id:       str,
        outcome:          str,
        final_trust:      int,
        final_escalation: int,
        end_reason:       str | None = None,
    ) -> None:
        ended_at = datetime.now(timezone.utc).isoformat()

        sb = _get_supabase()
        if sb:
            try:
                sb.table("rpe_sessions").update({
                    "ended_at":         ended_at,
                    "outcome":          outcome,
                    "final_trust":      final_trust,
                    "final_escalation": final_escalation,
                    "end_reason":       end_reason,
                }).eq("session_id", session_id).execute()
            except Exception as exc:
                logger.error("Supabase finalize_session failed: %s", exc)

        self._finalize_json(session_id, ended_at, outcome, final_trust, final_escalation, end_reason)

    def get_user_sessions(self, auth_user_id: str) -> list[dict]:
        """Return all sessions for the given Supabase auth UUID, newest first."""
        sb = _get_supabase()
        if not sb:
            return []
        try:
            result = (
                sb.table("rpe_sessions")
                .select(
                    "session_id, scenario_id, started_at, ended_at,"
                    "outcome, end_reason, final_trust,"
                    "final_escalation, recommended_turns"
                )
                .eq("auth_user_id", auth_user_id)
                .order("started_at", desc=True)
                .execute()
            )
            return result.data or []
        except Exception as exc:
            logger.error("RPE get_user_sessions error: %s", exc)
            return []

    # ── Supabase helpers ──────────────────────────────────────────────────────

    def _persist_session(self, session_id: str, payload: dict) -> None:
        """Write initial session record to Supabase + JSON."""
        sb = _get_supabase()
        if sb:
            try:
                row: dict = {
                    "session_id":        payload["session_id"],
                    "scenario_id":       payload["scenario_id"],
                    "user_id":           payload["user_id"],
                    "started_at":        payload["started_at"],
                    "opening_npc_line":  payload["opening_npc_line"],
                    "emotion_history":   payload["emotion_history"],
                    "trust_history":     payload["trust_history"],
                    "ended_at":          None,
                    "outcome":           None,
                    "final_trust":       None,
                    "final_escalation":  None,
                    "end_reason":        None,
                    "recommended_turns": None,
                    "max_turns":         None,
                }
                if payload.get("auth_user_id") is not None:
                    row["auth_user_id"] = payload["auth_user_id"]
                sb.table("rpe_sessions").insert(row).execute()
            except Exception as exc:
                logger.error("Supabase persist_session failed: %s", exc)

        # JSON always written
        self._write_json(session_id, payload)

    def _get_session_supabase(self, sb: Client, session_id: str) -> dict | None:
        """
        Reconstruct the legacy-compatible session dict from Supabase tables.
        Returns None if the session row doesn't exist.
        """
        row_resp = (
            sb.table("rpe_sessions")
            .select("*")
            .eq("session_id", session_id)
            .single()
            .execute()
        )
        row = row_resp.data
        if not row:
            return None

        turns_resp = (
            sb.table("rpe_turns")
            .select("*")
            .eq("session_id", session_id)
            .order("turn")
            .execute()
        )
        raw_turns = turns_resp.data or []

        # Build turns list in the same structure as the old JSON file
        turns = [
            {
                "turn":             t["turn"],
                "user_input":       t.get("user_input", ""),
                "npc_response":     t.get("npc_response", ""),
                "emotion":          t.get("emotion", "calm"),
                "trust_score":      t.get("trust_score", 50),
                "escalation_level": t.get("escalation_level", 0),
            }
            for t in raw_turns
        ]

        return {
            "session_id":        row["session_id"],
            "scenario_id":       row["scenario_id"],
            "user_id":           row["user_id"],
            "auth_user_id":      row.get("auth_user_id"),
            "started_at":        row["started_at"],
            "opening_npc_line":  row.get("opening_npc_line", ""),
            "turns":             turns,
            "emotion_history":   row.get("emotion_history") or ["calm"],
            "trust_history":     row.get("trust_history")   or [50],
            "ended_at":          row.get("ended_at"),
            "outcome":           row.get("outcome"),
            "final_trust":       row.get("final_trust"),
            "final_escalation":  row.get("final_escalation"),
            "end_reason":        row.get("end_reason"),
            "recommended_turns": row.get("recommended_turns"),
            "max_turns":         row.get("max_turns"),
        }

    # ── JSON helpers ──────────────────────────────────────────────────────────

    def _write_json(self, session_id: str, data: dict) -> None:
        path = LOGS_DIR / f"{session_id}.json"
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def _read_json(self, session_id: str) -> dict:
        path = LOGS_DIR / f"{session_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"Session '{session_id}' not found.")
        return json.loads(path.read_text(encoding="utf-8"))

    def _log_turn_json(self, session_id: str, turn_data: dict) -> None:
        try:
            data = self._read_json(session_id)
            data["turns"].append(turn_data)
            data["emotion_history"].append(turn_data.get("emotion", "calm"))
            data["trust_history"].append(turn_data.get("trust_score", 50))
            self._write_json(session_id, data)
        except Exception as exc:
            logger.error("JSON log_turn failed: %s", exc)

    def _finalize_json(
        self,
        session_id:       str,
        ended_at:         str,
        outcome:          str,
        final_trust:      int,
        final_escalation: int,
        end_reason:       str | None,
    ) -> None:
        try:
            data = self._read_json(session_id)
            data["ended_at"]         = ended_at
            data["outcome"]          = outcome
            data["final_trust"]      = final_trust
            data["final_escalation"] = final_escalation
            data["end_reason"]       = end_reason
            self._write_json(session_id, data)
        except Exception as exc:
            logger.error("JSON finalize_session failed: %s", exc)
