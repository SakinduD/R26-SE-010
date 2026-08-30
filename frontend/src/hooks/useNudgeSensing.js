import { useState, useRef, useCallback, useEffect } from 'react'
import * as faceMesh from '@mediapipe/face_mesh'
import * as cam from '@mediapipe/camera_utils'
import * as draw from '@mediapipe/drawing_utils'
import { calculateEAR, calculateMAR, estimateHeadPose } from '@/utils/mca/heuristics'
import { mcaService } from '@/services/mca/mcaService'

const NUDGE_TTL_MS = 10000
const NUDGE_MAX = 5

/**
 * Shared behavioral-sensing pipeline — camera/face-mesh, mic/nudge WebSocket,
 * and the nudge toast queue. Extracted out of MultimodalEngine.jsx so any
 * screen (MCA's live mode, RPE's role-play sessions) can open the same
 * sensing pipeline instead of a second copy.
 *
 * Deliberately NOT included here (stays in the calling screen instead):
 *   - MCA "live session" record lifecycle (mcaService.startSession/endSession,
 *     nudge_log persistence) — nudges here fire independent of any session
 *     concept; the backend socket only needs a valid token + audio, nothing
 *     about a session (confirmed against audio.py — session_id is logged,
 *     never required).
 *   - Continuous STT transcription loop — that's MCA's own scoring input,
 *     unrelated to nudge generation.
 *   - Picture-in-Picture — MCA-only UI, not part of the sensing pipeline itself.
 */
export function useNudgeSensing({ frameOverlayRef, showMesh = true, persistMicConnection = false } = {}) {
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isMicActive, setIsMicActive] = useState(false)
  // The raw mic MediaStream, exposed so a caller can feed a second, unrelated
  // recorder off the same hardware stream instead of opening its own (the
  // pattern MCA's own transcription loop relies on) — additive only, doesn't
  // change anything for a caller that ignores it.
  const [audioStream, setAudioStream] = useState(null)
  const [nudges, setNudges] = useState([])
  const [metrics, setMetrics] = useState({
    ear: 0,
    mar: 0,
    pose: { yaw: 0, pitch: 0, roll: 0 },
    emotion: 'Sensing...',
    confidence: 0,
    isSyncing: false,
  })

  const webcamRef = useRef(null)
  const canvasRef = useRef(null)
  const cameraRef = useRef(null)

  // Mutable mirror the WS onmessage closure reads without recreating the socket.
  const metricsRef = useRef({ ear: 0, mar: 0, pose: { yaw: 0, pitch: 0, roll: 0 } })

  const mediaRecorderRef = useRef(null)
  const socketRef = useRef(null)
  const audioStreamRef = useRef(null)
  const recordRestartTimeoutRef = useRef(null)

  // showMesh can change every render (e.g. MCA ties it to a URL param) without
  // destabilizing onResults — mirrored into a ref instead of a dependency.
  const showMeshRef = useRef(showMesh)
  useEffect(() => {
    showMeshRef.current = showMesh
  }, [showMesh])

  const dismissNudge = useCallback((id) => {
    setNudges((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const handleNudge = useCallback((text, category = 'fusion', severity = 'info') => {
    const id = Date.now()
    const nudge = {
      id,
      text,
      category,
      severity,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    setNudges((prev) => [nudge, ...prev].slice(0, NUDGE_MAX))
    setTimeout(() => {
      setNudges((prev) => prev.filter((n) => n.id !== id))
    }, NUDGE_TTL_MS)
  }, [])

  // Landmarks -> EAR/MAR/pose, drawn mirrored onto the canvas with a light
  // mesh overlay so sensing feels visible, not a black box.
  const onResults = useCallback((results) => {
    if (!webcamRef.current?.video || !canvasRef.current) return

    const videoWidth = webcamRef.current.video.videoWidth
    const videoHeight = webcamRef.current.video.videoHeight
    if (canvasRef.current.width !== videoWidth) canvasRef.current.width = videoWidth
    if (canvasRef.current.height !== videoHeight) canvasRef.current.height = videoHeight

    const canvasElement = canvasRef.current
    const canvasCtx = canvasElement.getContext('2d')

    canvasCtx.save()
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height)
    canvasCtx.translate(canvasElement.width, 0)
    canvasCtx.scale(-1, 1)
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height)

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0]
      const ear = calculateEAR(landmarks)
      const mar = calculateMAR(landmarks)
      const pose = estimateHeadPose(landmarks)

      const newMetrics = { ear, mar, pose }
      setMetrics((prev) => ({ ...prev, ...newMetrics }))
      metricsRef.current = { ...metricsRef.current, ...newMetrics }

      if (showMeshRef.current) {
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_TESSELATION, {
          color: '#06B6D4',
          lineWidth: 0.5,
        })
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_RIGHT_EYE, { color: '#7C3AED' })
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_LEFT_EYE, { color: '#7C3AED' })
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_LIPS, { color: '#EC4899' })
      }
    }
    canvasCtx.restore()

    // Optional per-frame extra drawing (e.g. MultimodalEngine's Picture-in-
    // Picture overlay) — a ref so this callback stays stable across renders
    // instead of forcing the camera/FaceMesh effect below to tear down and
    // restart every time the overlay's own inputs change.
    if (frameOverlayRef?.current) {
      frameOverlayRef.current(canvasCtx, canvasElement)
    }
  }, [frameOverlayRef])

  const startAudioCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream
      setIsMicActive(true)
      setAudioStream(stream)

      const beginRecording = (socket) => {
        const startRecordingChunk = () => {
          if (socket.readyState !== WebSocket.OPEN) return

          const mediaRecorder = new MediaRecorder(stream)
          mediaRecorderRef.current = mediaRecorder

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'visual_metrics', metrics: metricsRef.current }))
              socket.send(event.data)
            }
          }

          mediaRecorder.start()

          if (recordRestartTimeoutRef.current) clearTimeout(recordRestartTimeoutRef.current)
          recordRestartTimeoutRef.current = setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop()
              startRecordingChunk()
            }
          }, 3000)
        }
        startRecordingChunk()
      }

      // persistMicConnection callers (RPE) keep an already-open socket alive
      // across UI mic on/off toggles instead of reconnecting — the backend
      // spins up a fresh NudgeEngine (which loads an ML model) per connection,
      // so reusing one avoids paying that cost on every toggle. MCA doesn't
      // opt in, so its behaviour (fresh socket every toggle) is unchanged.
      if (persistMicConnection && socketRef.current?.readyState === WebSocket.OPEN) {
        beginRecording(socketRef.current)
        return
      }

      const socket = new WebSocket(mcaService.getAudioStreamUrl())
      socketRef.current = socket

      socket.onopen = () => beginRecording(socket)

      socket.onerror = (err) => console.error('[useNudgeSensing] WS error:', err)

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.metrics) {
            setMetrics((prev) => ({
              ...prev,
              emotion: data.metrics.emotion
                ? data.metrics.emotion.charAt(0).toUpperCase() + data.metrics.emotion.slice(1)
                : 'Neutral',
              confidence: data.metrics.confidence || 0,
              isSyncing: true,
            }))
            if (data.metrics.nudge) {
              handleNudge(data.metrics.nudge, data.metrics.nudge_category, data.metrics.nudge_severity)
            }
          }
        } catch (err) {
          console.error('[useNudgeSensing] Error parsing socket message:', err)
        }
      }
    } catch (err) {
      console.error('[useNudgeSensing] Audio capture error:', err)
    }
  }, [handleNudge, persistMicConnection])

  // force=true always fully tears down (socket included) regardless of
  // persistMicConnection — used on unmount, where there's no future toggle
  // that could reuse a kept-alive socket, so keeping it open would just leak.
  const stopAudioCapture = useCallback((force = false) => {
    setIsMicActive(false)
    if (recordRestartTimeoutRef.current) {
      clearTimeout(recordRestartTimeoutRef.current)
      recordRestartTimeoutRef.current = null
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    if (force || !persistMicConnection) {
      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }
    }
    // The actual microphone hardware always stops here regardless of
    // persistMicConnection — "off" in the UI must mean no audio is being
    // captured, even when the WS session is kept alive for a fast resume.
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop())
      audioStreamRef.current = null
    }
    setAudioStream(null)
    setMetrics((prev) => ({ ...prev, isSyncing: false, emotion: 'Sensing...' }))
  }, [persistMicConnection])

  const toggleMic = useCallback(() => {
    if (isMicActive) {
      stopAudioCapture()
    } else {
      startAudioCapture()
    }
  }, [isMicActive, startAudioCapture, stopAudioCapture])

  const toggleCamera = useCallback(() => {
    setIsCameraActive((prev) => !prev)
  }, [])

  // Camera + FaceMesh lifecycle, tied to isCameraActive.
  useEffect(() => {
    let faceMeshModel = null

    if (isCameraActive) {
      faceMeshModel = new faceMesh.FaceMesh({
        locateFile: (file) => {
          const baseUrl = import.meta.env.VITE_MEDIAPIPE_FACE_MESH_URL || 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh'
          return `${baseUrl}/${file}`
        },
      })

      faceMeshModel.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      faceMeshModel.onResults(onResults)

      if (webcamRef.current && webcamRef.current.video) {
        cameraRef.current = new cam.Camera(webcamRef.current.video, {
          onFrame: async () => {
            if (faceMeshModel) {
              await faceMeshModel.send({ image: webcamRef.current.video })
            }
          },
          width: 1280,
          height: 720,
        })
        cameraRef.current.start()
      }
    }

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop()
        cameraRef.current = null
      }
      if (faceMeshModel) {
        faceMeshModel.close()
      }
    }
  }, [isCameraActive, onResults])

  // Tear everything down on unmount — force=true so a persistMicConnection
  // caller's kept-alive socket doesn't leak; there's no future toggle left
  // to reuse it.
  useEffect(() => {
    return () => {
      stopAudioCapture(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    webcamRef,
    canvasRef,
    nudges,
    metrics,
    isCameraActive,
    isMicActive,
    audioStream,
    toggleCamera,
    toggleMic,
    dismissNudge,
  }
}
