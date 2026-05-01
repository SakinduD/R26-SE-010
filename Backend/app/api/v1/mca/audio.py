from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
import io
import numpy as np
import librosa

router = APIRouter()
logger = logging.getLogger("uvicorn")

def process_audio_chunk(data: bytes):
    """
    Decodes audio bytes and extracts Pitch and Volume metrics.
    """
    try:
        # Load the bytes as a floating-point time series
        # We use io.BytesIO to treat the raw bytes as a file
        audio_data, sr = librosa.load(io.BytesIO(data), sr=None)
        
        if len(audio_data) == 0:
            return None

        # Calculate Volume (RMS Energy)
        rms = librosa.feature.rms(y=audio_data)
        avg_volume = np.mean(rms)

        # Calculate Pitch (using YIN algorithm for robustness)
        # We handle potential errors if the segment is too short or silent
        try:
            pitches, magnitudes = librosa.piptrack(y=audio_data, sr=sr)
            # Find the strongest pitch
            index = magnitudes.argmax()
            pitch = pitches.flatten()[index]
        except:
            pitch = 0

        return {
            "volume": float(avg_volume),
            "pitch": float(pitch),
            "sample_rate": sr,
            "duration_ms": (len(audio_data) / sr) * 1000
        }
    except Exception as e:
        # Chunks without headers might fail initially; we log it but keep the stream alive
        logger.debug(f"Audio processing skipped: {str(e)}")
        return None

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
    if not token:
        logger.warning("WebSocket connection rejected: Missing security token")
        await websocket.accept()
        await websocket.close(code=4003)
        return

    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_bytes()
            
            # Process the audio in-memory
            metrics = process_audio_chunk(data)
            
            # Prepare response
            response = {
                "status": "analyzed",
                "bytes": len(data)
            }
            
            if metrics:
                response["metrics"] = metrics
                logger.info(f"Analyzed audio: Pitch={metrics['pitch']:.1f}Hz, Vol={metrics['volume']:.4f}")
            
            await websocket.send_json(response)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("Client disconnected from audio stream")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket)
