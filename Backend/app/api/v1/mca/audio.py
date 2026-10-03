import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.api.v1.mca.nudge_engine import SPEECH_RMS_GATE, AudioFeatureExtractor, NudgeEngine
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


def _analyze_chunk(nudge_engine: NudgeEngine, data: bytes, visual_metrics, user_id: str) -> dict:
    """Decode + analyse one audio chunk (CPU-heavy; runs in a worker thread)."""
    process_start = time.time()
    features = _extractor.extract(data)

    response: dict = {"status": "analyzed", "bytes": len(data)}
    if not features:
        return response

    nudge = nudge_engine.evaluate(features, visual_metrics)
    response["metrics"] = {
        "emotion": features.emotion_label,  # None = learner not speaking
        "confidence": features.emotion_confidence,
        # Whether this chunk could be observed (used by session scoring).
        "speaking": bool(features.avg_volume > SPEECH_RMS_GATE),
        "face_visible": features.visual_metrics is not None,
        "nudge": nudge.message if nudge else None,
        "nudge_category": nudge.category if nudge else None,
        "nudge_severity": nudge.severity if nudge else None,
        # Behaviours still present in this chunk (frontend hides the rest).
        "active_nudges": nudge_engine.active_messages,
        # Everything detected this chunk, not limited by the nudge cooldown.
        "detections": [
            {"message": n.message, "category": n.category, "severity": n.severity}
            for n in nudge_engine.active_nudges
        ],
    }

    latency_ms = (time.time() - process_start) * 1000
    if nudge:
        logger.info("[NUDGE] user=%s | %s | latency=%.0fms", user_id, nudge.message, latency_ms)
    else:
        logger.debug(
            "chunk processed | user=%s | emotion=%s | %.0fms",
            user_id,
            features.emotion_label,
            latency_ms,
        )
    return response


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

    # Per-connection NudgeEngine (no shared mutable state between users).
    # Built off the event loop: the first one loads the emotion model.
    nudge_engine = await run_in_threadpool(NudgeEngine)

    # Only the newest chunk waits for analysis; stale ones are dropped so nudges stay current.
    pending: dict = {"job": None}
    job_ready = asyncio.Event()

    async def analysis_worker():
        while True:
            await job_ready.wait()
            job_ready.clear()
            job, pending["job"] = pending["job"], None
            if job is None:
                continue
            data, visual_metrics = job
            response = await run_in_threadpool(_analyze_chunk, nudge_engine, data, visual_metrics, user_id)
            await websocket.send_json(response)

    worker = asyncio.create_task(analysis_worker())

    try:
        latest_visual_metrics = None

        while True:
            if worker.done():
                worker.result()  # surface analysis/send errors

            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))

            # Visual metrics (JSON text frame, sent right before each audio chunk)
            if message.get("text") is not None:
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
            if message.get("bytes") is not None:
                if pending["job"] is not None:
                    logger.debug("Dropping stale audio chunk | user=%s", user_id)
                pending["job"] = (message["bytes"], latest_visual_metrics)
                job_ready.set()

    except WebSocketDisconnect:
        logger.info("WS audio-analysis disconnected | user_id=%s", user_id)
    except Exception as e:
        logger.error("WS audio-analysis error | user_id=%s | %s", user_id, str(e))
    finally:
        worker.cancel()
        manager.disconnect(websocket)
