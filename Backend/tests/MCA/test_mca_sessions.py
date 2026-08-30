import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from unittest.mock import patch, MagicMock

from app.main import app
from app.core.auth import get_current_user
from app.models.user import User
from app.models.session_result import SessionResult
from app.services.mca_live_scorer import mca_live_scorer

_NOW = datetime.now(timezone.utc)

def _make_user(db: Session) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"test_{uid.hex[:8]}@mca.local",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.expunge(user)
    return user

class TestMCASessions:
    
    def _call(self, client, db_session, user_id, method: str, path: str, **kwargs):
        def override_user():
            return db_session.get(User, user_id)
        try:
            app.dependency_overrides[get_current_user] = override_user
            fn = getattr(client, method)
            return fn(f"/api/v1{path}", **kwargs)
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_start_session(self, client, db_session):
        user = _make_user(db_session)
        resp = self._call(client, db_session, user.id, "post", "/mca/sessions/start", json={"mode": "ai"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["mode"] == "ai"
        assert data["status"] == "active"
        assert "id" in data
        assert data["user_id"] == str(user.id)
        
        # Verify in DB
        session_obj = db_session.get(SessionResult, uuid.UUID(data["id"]))
        assert session_obj is not None
        assert session_obj.status == "active"

    @patch("app.api.v1.mca.sessions.mca_live_scorer.score")
    def test_end_session(self, mock_score, client, db_session):
        # Mock LLM scoring
        mock_score.return_value = {
            "overall": 85,
            "breakdown": {
                "vocal_command": 80,
                "speech_fluency": 85,
                "presence_engagement": 90,
                "emotional_regulation": 85
            },
            "rationale": "Great session"
        }
        
        user = _make_user(db_session)
        
        # Start session
        resp_start = self._call(client, db_session, user.id, "post", "/mca/sessions/start", json={"mode": "live"})
        session_id = resp_start.json()["id"]
        
        # End session
        end_payload = {
            "nudge_log": [
                {"message": "Test nudge", "category": "volume", "severity": "info", "elapsed_seconds": 10.0}
            ],
            "emotion_distribution": {"happy": 0.8, "neutral": 0.2},
            "user_transcript": [{"text": "Hello world", "elapsed_seconds": 5.0}],
            "meeting_transcript": []
        }
        
        resp_end = self._call(client, db_session, user.id, "post", f"/mca/sessions/{session_id}/end", json=end_payload)
        assert resp_end.status_code == 200
        data = resp_end.json()
        
        assert data["status"] == "completed"
        assert data["duration_seconds"] is not None
        assert data["overall_score"] == 85
        assert data["skill_scores"]["vocal_command"] == 80
        assert data["dominant_emotion"] == "happy"
        
        # Validate DB
        session_obj = db_session.get(SessionResult, uuid.UUID(session_id))
        assert session_obj.status == "completed"
        assert session_obj.overall_score == 85

    def test_discard_session(self, client, db_session):
        user = _make_user(db_session)
        resp_start = self._call(client, db_session, user.id, "post", "/mca/sessions/start", json={"mode": "ai"})
        session_id = resp_start.json()["id"]
        
        resp_delete = self._call(client, db_session, user.id, "delete", f"/mca/sessions/{session_id}")
        assert resp_delete.status_code == 204
        
        # Validate DB
        session_obj = db_session.get(SessionResult, uuid.UUID(session_id))
        assert session_obj is None

    def test_list_sessions(self, client, db_session):
        user = _make_user(db_session)
        self._call(client, db_session, user.id, "post", "/mca/sessions/start", json={"mode": "live"})
        self._call(client, db_session, user.id, "post", "/mca/sessions/start", json={"mode": "ai"})
        
        resp = self._call(client, db_session, user.id, "get", "/mca/sessions/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        
        # Get my sessions
        resp_me = self._call(client, db_session, user.id, "get", "/mca/sessions/me")
        assert resp_me.status_code == 200
        data_me = resp_me.json()
        assert len(data_me) == 2
