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

@router.websocket("/audio-analysis")
async def websocket_endpoint(websocket: WebSocket, token: str = None):
    # Basic security check - in production this would verify against a DB or JWT
    if not token:
        logger.warning("WebSocket connection rejected: Missing security token")
        await websocket.accept() # Must accept before closing with custom code in some cases
        await websocket.close(code=4003) # Custom 'Not Authorized' code
        return

    await manager.connect(websocket)
    try:
        while True:
            # Receive audio chunks from the frontend
            data = await websocket.receive_bytes()
            
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
