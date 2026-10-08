import { useState, useRef, useCallback, useEffect } from 'react'
import * as faceMesh from '@mediapipe/face_mesh'
import * as cam from '@mediapipe/camera_utils'
import * as draw from '@mediapipe/drawing_utils'
import { calculateEAR, calculateMAR, estimateHeadPose } from '@/utils/mca/heuristics'
import { mcaService } from '@/services/mca/mcaService'
import { createEyeClosureFilter, createVisualAccumulator, pruneResolvedNudges, toMechanicalAverages, upsertNudge } from '@/utils/mca/realtimeSensing'

const NUDGE_TTL_MS = 10000
const NUDGE_MAX = 5

/**
 * Shared sensing pipeline (camera + face mesh, mic + nudge WebSocket, nudge
 * queue) used by MCA live mode and RPE. Session lifecycle, transcription and
 * Picture-in-Picture stay in the calling screen.
 */
export function useNudgeSensing({ frameOverlayRef, showMesh = true, persistMicConnection = false, onDetections, onChunk } = {}) {
  // Optional per-chunk callbacks, held in refs so the socket isn't rebuilt.
  const onDetectionsRef = useRef(onDetections)
  onDetectionsRef.current = onDetections
  const onChunkRef = useRef(onChunk)
  onChunkRef.current = onChunk

  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isMicActive, setIsMicActive] = useState(false)
  // Raw mic stream, so callers can record from it without opening the mic again.
  const [audioStream, setAudioStream] = useState(null)
  const [nudges, setNudges] = useState([])
  const [metrics, setMetrics] = useState({
    ear: 0,
    mar: 0,
    pose: { yaw: 0, pitch: 0, roll: 0 },
    emotion: 'Sensing...',
    confidence: 0,
    isSyncing: false,
    modelKind: 'unknown',
  })

  const webcamRef = useRef(null)
  const canvasRef = useRef(null)
  const cameraRef = useRef(null)

  // Face metrics averaged per audio chunk (sent with it) and per session.
  const chunkVisualRef = useRef(createVisualAccumulator())
  const sessionVisualRef = useRef(createVisualAccumulator())
  const eyeClosureRef = useRef(createEyeClosureFilter())

  const mediaRecorderRef = useRef(null)
  const socketRef = useRef(null)
  const audioStreamRef = useRef(null)
  const recordRestartTimeoutRef = useRef(null)

  // Ref so a changing showMesh doesn't recreate onResults.
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
      shownAt: id,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    setNudges((prev) => upsertNudge(prev, nudge, NUDGE_MAX))
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

    const hasFace = results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0
    if (!hasFace) {
      chunkVisualRef.current.add(null)
      sessionVisualRef.current.add(null)
    } else {
      const landmarks = results.multiFaceLandmarks[0]
      const ear = calculateEAR(landmarks)
      const mar = calculateMAR(landmarks)
      const pose = estimateHeadPose(landmarks)

      const newMetrics = { ear, mar, pose }
      setMetrics((prev) => ({ ...prev, ...newMetrics, eyesClosed: eyeClosureRef.current(ear) }))
      chunkVisualRef.current.add(newMetrics)
      sessionVisualRef.current.add(newMetrics)

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

    // Optional extra drawing (e.g. PiP overlay); a ref so the camera effect isn't restarted.
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
              // Face averaged over the same ~3 s as this audio (null = no face).
              socket.send(JSON.stringify({ type: 'visual_metrics', metrics: chunkVisualRef.current.average() }))
              socket.send(event.data)
            }
          }

          chunkVisualRef.current.reset()
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

      // persistMicConnection (RPE): reuse the open socket across mic toggles.
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
            // No emotion means the learner wasn't speaking — not "Neutral".
            setMetrics((prev) => ({
              ...prev,
              emotion: data.metrics.emotion
                ? data.metrics.emotion.charAt(0).toUpperCase() + data.metrics.emotion.slice(1)
                : 'Sensing...',
              confidence: data.metrics.confidence || 0,
              isSyncing: true,
              modelKind: data.metrics.model_kind || prev.modelKind,
            }))
            // Hide nudges whose behaviour has stopped.
            setNudges((prev) => pruneResolvedNudges(prev, data.metrics.active_nudges))
            onChunkRef.current?.(data.metrics)
            if (data.metrics.detections?.length) onDetectionsRef.current?.(data.metrics.detections)
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

  // force=true also closes a kept-alive socket (used on unmount).
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

  // Tear everything down on unmount, including a kept-alive socket.
  useEffect(() => {
    return () => {
      stopAudioCapture(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Session-wide face averages for mechanical_averages (null if no face data).
  const resetVisualAverages = useCallback(() => sessionVisualRef.current.reset(), [])
  const getVisualAverages = useCallback(() => toMechanicalAverages(sessionVisualRef.current), [])

  return {
    webcamRef,
    canvasRef,
    nudges,
    metrics,
    resetVisualAverages,
    getVisualAverages,
    isCameraActive,
    isMicActive,
    audioStream,
    toggleCamera,
    toggleMic,
    dismissNudge,
  }
}
