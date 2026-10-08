import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from unittest.mock import patch, AsyncMock

from app.main import app
from app.core.auth import get_current_user
from app.models.user import User

_NOW = datetime.now(timezone.utc)

def _make_user(db: Session) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"chat_{uid.hex[:8]}@mca.local",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.expunge(user)
    return user

class TestMCAChat:
    
    def _call(self, client, user, method: str, path: str, **kwargs):
        try:
            app.dependency_overrides[get_current_user] = lambda: user
            fn = getattr(client, method)
            return fn(f"/api/v1{path}", **kwargs)
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    @patch("app.api.v1.mca.chat.llm_service.get_response", new_callable=AsyncMock)
    def test_chat_success(self, mock_llm, client, db_session):
        mock_llm.return_value = "Hello! How can I help you today?"
        
        user = _make_user(db_session)
        payload = {
            "message": "Hi bot",
            "history": [],
            "context": {}
        }
        resp = self._call(client, user, "post", "/mca/chat/", json=payload)
        
        assert resp.status_code == 200
        data = resp.json()
        assert data["isSuccessful"] is True
        assert data["data"] == "Hello! How can I help you today?"
        mock_llm.assert_called_once()

    def test_chat_empty_message(self, client, db_session):
        user = _make_user(db_session)
        payload = {
            "message": "   ",
        }
        resp = self._call(client, user, "post", "/mca/chat/", json=payload)
        
        assert resp.status_code == 200
        data = resp.json()
        assert data["isSuccessful"] is False
        assert "Message cannot be empty" in data["message"]

    @patch("app.api.v1.mca.chat.llm_service.get_response", new_callable=AsyncMock)
    def test_chat_rate_limiting(self, mock_llm, client, db_session):
        mock_llm.return_value = "Mock response"
        user = _make_user(db_session)
        payload = {"message": "Rate limit test"}
        
        # Max requests is 15 in chat.py
        for i in range(15):
            resp = self._call(client, user, "post", "/mca/chat/", json=payload)
            assert resp.status_code == 200
            
        # The 16th request should fail
        resp_429 = self._call(client, user, "post", "/mca/chat/", json=payload)
        assert resp_429.status_code == 429
        assert "Retry-After" in resp_429.headers
