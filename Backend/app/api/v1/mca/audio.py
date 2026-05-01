from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging

router = APIRouter()
logger = logging.getLogger("uvicorn")

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

manager = ConnectionManager()

@router.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Receive audio chunks from the frontend
            data = await websocket.receive_bytes()
            
            # For now, we just log the size of the received chunk
            # In MCA-09, we will process this with an ASR model
            logger.info(f"Received audio chunk: {len(data)} bytes")
            
            # Send an acknowledgment back to the frontend
            await websocket.send_json({
                "status": "received",
                "bytes": len(data)
            })
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("Client disconnected from audio stream")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket)
