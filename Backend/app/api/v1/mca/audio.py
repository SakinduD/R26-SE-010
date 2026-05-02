from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging

from app.api.v1.mca.nudge_engine import AudioFeatureExtractor, NudgeEngine

router = APIRouter()
logger = logging.getLogger("uvicorn")

# Initialize Nudge Engine and Feature Extractor
_extractor = AudioFeatureExtractor()
_nudge_engine = NudgeEngine()


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
    if not token:
        logger.warning("WebSocket connection rejected: Missing security token")
        await websocket.accept()
        await websocket.close(code=4003)
        return

    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_bytes()

            # Extract audio features from raw bytes
            features = _extractor.extract(data)

            # Build response
            response = {"status": "analyzed", "bytes": len(data)}

            if features:
                nudge = _nudge_engine.evaluate(features)
                response["metrics"] = {
                    "volume": features.avg_volume,
                    "pitch": features.pitch_hz,
                    "zero_crossing_rate": features.zero_crossing_rate,
                    "spectral_centroid": features.spectral_centroid,
                    "duration_ms": features.duration_ms,
                    "emotion": features.emotion_label,
                    "confidence": features.emotion_confidence,
                    "nudge": nudge.message if nudge else None,
                    "nudge_category": nudge.category if nudge else None,
                    "nudge_severity": nudge.severity if nudge else None,
                }
                if nudge:
                    logger.info(
                        f"[NUDGE/{nudge.category.upper()}] {nudge.message} "
                        f"| vol={features.avg_volume:.4f} pitch={features.pitch_hz:.1f}Hz"
                    )

            await websocket.send_json(response)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("Client disconnected from audio stream")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket)
