from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging

from app.api.v1.mca.nudge_engine import AudioFeatureExtractor, NudgeEngine

router = APIRouter()
logger = logging.getLogger("uvicorn")

# Initialize Feature Extractor
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
    if not token:
        logger.warning("WebSocket connection rejected: Missing security token")
        await websocket.accept()
        await websocket.close(code=4003)
        return

    # Initialize Nudge Engine per connection to avoid shared state race conditions
    nudge_engine = NudgeEngine()
    
    await manager.connect(websocket)
    try:
        latest_visual_metrics = None

        while True:
            message = await websocket.receive()

            if "text" in message:
                try:
                    import json
                    payload = json.loads(message["text"])
                    if payload.get("type") == "visual_metrics":
                        latest_visual_metrics = payload.get("metrics")
                except Exception as e:
                    logger.error(f"Error parsing visual metrics: {e}")
                continue

            if "bytes" in message:
                import time
                process_start = time.time()
                
                data = message["bytes"]
                # Extract audio features from raw bytes
                features = _extractor.extract(data)

                # Build response
                response = {"status": "analyzed", "bytes": len(data)}

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
                            f"[NUDGE] {nudge.message} | Latency: {latency_ms:.2f}ms"
                        )
                    else:
                        logger.info(f"Chunk processed in {latency_ms:.2f}ms | Emotion: {features.emotion_label}")

                await websocket.send_json(response)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("Client disconnected from audio stream")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket)
