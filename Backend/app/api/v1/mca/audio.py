import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError

from app.api.v1.mca.nudge_engine import AudioFeatureExtractor, NudgeEngine
from app.core.auth import verify_jwt

router = APIRouter()
logger = logging.getLogger("uvicorn")

# Initialise the feature extractor once (it holds no per-connection state)
_extractor = AudioFeatureExtractor()


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)


manager = ConnectionManager()


@router.websocket("/audio-analysis")
async def websocket_endpoint(websocket: WebSocket, token: str = None):
    """
    Real-time audio analysis stream.

    Query params:
      token  – Required. Supabase JWT (access_token) for the authenticated user.
    """
    # Auth gate
    if not token:
        await websocket.accept()
        await websocket.send_json({"error": "Missing authentication token"})
        await websocket.close(code=4001)
        logger.warning("WebSocket rejected: no token provided")
        return

    try:
        token_payload = verify_jwt(token)
        user_id = token_payload.sub
    except Exception:
        await websocket.accept()
        await websocket.send_json({"error": "Invalid or expired token"})
        await websocket.close(code=4003)
        logger.warning("WebSocket rejected: JWT verification failed")
        return

    # Established
    await manager.connect(websocket)
    logger.info("WS audio-analysis connected | user_id=%s", user_id)

    # Per-connection NudgeEngine (no shared mutable state between users)
    nudge_engine = NudgeEngine()

    try:
        latest_visual_metrics = None

        while True:
            message = await websocket.receive()

            # Visual metrics (JSON text frame)
            if "text" in message:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "visual_metrics":
                        latest_visual_metrics = payload.get("metrics")
                        # Capture session_id if provided
                        sid = payload.get("session_id")
                        if sid:
                            logger.debug("Sensing session linkage: %s", sid)
                except Exception as e:
                    logger.error("Error parsing visual metrics: %s", e)
                continue

            # Audio chunk (binary frame)
            if "bytes" in message:
                process_start = time.time()
                data = message["bytes"]
                features = _extractor.extract(data)

                response: dict = {"status": "analyzed", "bytes": len(data)}

                if features:
                    nudge = nudge_engine.evaluate(features, latest_visual_metrics)

                    response["metrics"] = {
                        "emotion": features.emotion_label,
                        "confidence": features.emotion_confidence,
                        "nudge": nudge.message if nudge else None,
                        "nudge_category": nudge.category if nudge else None,
                        "nudge_severity": nudge.severity if nudge else None,
                    }

                    latency_ms = (time.time() - process_start) * 1000
                    if nudge:
                        logger.info(
                            "[NUDGE] user=%s | %s | latency=%.0fms",
                            user_id,
                            nudge.message,
                            latency_ms,
                        )
                    else:
                        logger.debug(
                            "chunk processed | user=%s | emotion=%s | %.0fms",
                            user_id,
                            features.emotion_label,
                            latency_ms,
                        )

                await websocket.send_json(response)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WS audio-analysis disconnected | user_id=%s", user_id)
    except Exception as e:
        logger.error("WS audio-analysis error | user_id=%s | %s", user_id, str(e))
        manager.disconnect(websocket)
