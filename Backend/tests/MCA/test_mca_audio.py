import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from unittest.mock import patch, MagicMock

from app.main import app
from app.models.user import User

_NOW = datetime.now(timezone.utc)

def _make_user(db: Session) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"audio_{uid.hex[:8]}@mca.local",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.expunge(user)
    return user

class TestMCAAudio:
    
    @patch("app.api.v1.mca.audio.verify_jwt")
    @patch("app.api.v1.mca.audio._extractor.extract")
    @patch("app.api.v1.mca.audio.NudgeEngine.evaluate")
    def test_audio_websocket_success(self, mock_evaluate, mock_extract, mock_verify, client, db_session):
        user = _make_user(db_session)
        # Mock token payload
        mock_payload = MagicMock()
        mock_payload.sub = str(user.id)
        mock_verify.return_value = mock_payload
        token = "fake_token"
        
        # Setup mocks
        mock_features = MagicMock()
        mock_features.emotion_label = "happy"
        mock_features.emotion_confidence = 0.95
        mock_extract.return_value = mock_features
        
        mock_nudge = MagicMock()
        mock_nudge.category = "pace"
        mock_nudge.message = "Speaking rapidly"
        mock_nudge.severity = "info"
        mock_evaluate.return_value = mock_nudge

        with client.websocket_connect(f"/api/v1/mca/audio/audio-analysis?token={token}") as websocket:
            # Send visual metrics
            websocket.send_json({
                "type": "visual_metrics",
                "metrics": {"pose": {"yaw": 0}}
            })
            
            # Send audio chunk
            websocket.send_bytes(b"RIFF" * 10)
            
            # Receive response
            resp_data = websocket.receive_json()
            
            assert resp_data["status"] == "analyzed"
            assert "metrics" in resp_data
            assert resp_data["metrics"]["emotion"] == "happy"
            assert resp_data["metrics"]["nudge_category"] == "pace"
            
            mock_extract.assert_called_once()
            mock_evaluate.assert_called_once()

    def test_audio_websocket_missing_token(self, client):
        with client.websocket_connect("/api/v1/mca/audio/audio-analysis") as websocket:
            resp_data = websocket.receive_json()
            assert "error" in resp_data
            assert resp_data["error"] == "Missing authentication token"

    def test_audio_websocket_invalid_token(self, client):
        with client.websocket_connect("/api/v1/mca/audio/audio-analysis?token=invalid_token") as websocket:
            resp_data = websocket.receive_json()
            assert "error" in resp_data
            assert resp_data["error"] == "Invalid or expired token"
