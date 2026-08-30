/*
 * useVoiceRecorder.js
 * Records one spoken utterance (mic -> MediaRecorder), auto-stops on
 * silence, and sends the clip to the backend's /api/stt proxy (Google
 * Cloud Speech-to-Text) for transcription. Replaces the browser's built-in
 * SpeechRecognition, which isn't available in every browser (e.g. Brave
 * strips the Google key Chromium relies on) and doesn't let us control the
 * transcription backend.
 *
 * Silence detection: a Web Audio AnalyserNode samples the mic's RMS
 * amplitude every 100ms. Recording stops once amplitude has stayed below
 * SILENCE_THRESHOLD for SILENCE_DURATION_MS, mirroring how
 * SpeechRecognition used to auto-end an utterance.
 */
import { useCallback, useRef, useState } from 'react'
import { API_URL } from '@/lib/config'

const SILENCE_THRESHOLD   = 0.02   // RMS amplitude (0-1) below this counts as silence
const SILENCE_DURATION_MS = 1200   // stop after this much continuous silence
const MAX_RECORDING_MS    = 20000  // hard cap so a stuck mic doesn't record forever
const MIN_RECORDING_MS    = 300    // ignore captures shorter than this (false starts)

export const canRecord =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined'

export function useVoiceRecorder({ onResult, onEmpty, onError, onPermissionDenied, externalStream }) {
  const [isListening, setIsListening] = useState(false)
  const recorderRef = useRef(null)
  const streamRef    = useRef(null)
  const audioCtxRef  = useRef(null)
  // True when streamRef holds a stream we opened ourselves (and must close);
  // false when it's an externally-supplied, shared stream (e.g. RPE's
  // continuous nudge-sensing mic) whose lifecycle belongs to its owner —
  // mirrors MCA's own pattern of one mic stream feeding multiple recorders.
  const ownsStreamRef = useRef(true)
  // True from the instant startListening() is called until the recording it
  // started has fully stopped — including the getUserMedia() await, which is
  // otherwise a window where a second concurrent call (e.g. an onEmpty retry
  // firing while the previous cycle is still spinning up) creates a second
  // overlapping recorder/stream that stomps on these refs and desyncs
  // isListening from what's actually happening. This is what made auto
  // mic on/off intermittently misbehave.
  const activeRef = useRef(false)

  const cleanup = useCallback(() => {
    if (ownsStreamRef.current) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
    streamRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    recorderRef.current = null
  }, [])

  const startListening = useCallback(async () => {
    if (activeRef.current) return
    activeRef.current = true

    if (!canRecord) { activeRef.current = false; onPermissionDenied?.(); return }

    let stream
    if (externalStream && externalStream.active) {
      // Shared stream (e.g. RPE's continuous nudge-sensing mic, when
      // coaching is on) — reuse it instead of opening a second device
      // stream; we don't own it, so we never stop its tracks.
      stream = externalStream
      ownsStreamRef.current = false
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        activeRef.current = false
        onPermissionDenied?.()
        return
      }
      ownsStreamRef.current = true
    }

    if (!activeRef.current) {
      // stopListening() ran while we were awaiting the permission prompt —
      // don't start a recording nobody asked for anymore.
      if (ownsStreamRef.current) stream.getTracks().forEach((track) => track.stop())
      return
    }
    streamRef.current = stream

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

    const AudioContextApi = window.AudioContext || window.webkitAudioContext
    const audioCtx = new AudioContextApi()
    audioCtxRef.current = audioCtx
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    const timeData = new Uint8Array(analyser.fftSize)

    const recordingStart = Date.now()
    let silenceStart = null
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      clearInterval(pollId)
      if (recorder.state !== 'inactive') recorder.stop()
    }

    const pollId = setInterval(() => {
      analyser.getByteTimeDomainData(timeData)
      let sumSquares = 0
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128
        sumSquares += v * v
      }
      const rms = Math.sqrt(sumSquares / timeData.length)
      const elapsed = Date.now() - recordingStart

      if (elapsed >= MAX_RECORDING_MS) { finish(); return }

      if (rms < SILENCE_THRESHOLD) {
        if (silenceStart === null) silenceStart = Date.now()
        else if (elapsed >= MIN_RECORDING_MS && Date.now() - silenceStart >= SILENCE_DURATION_MS) {
          finish()
        }
      } else {
        silenceStart = null
      }
    }, 100)

    recorder.onstop = async () => {
      activeRef.current = false
      cleanup()
      setIsListening(false)

      const elapsed = Date.now() - recordingStart
      if (elapsed < MIN_RECORDING_MS || chunks.length === 0) {
        onEmpty?.()
        return
      }

      const blob = new Blob(chunks, { type: mimeType })
      try {
        const res = await fetch(`${API_URL}/api/stt`, {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: blob,
        })
        if (!res.ok) throw new Error(`STT request failed: ${res.status}`)
        const data = await res.json()
        const transcript = (data.transcript || '').trim()
        if (transcript) onResult?.(transcript)
        else onEmpty?.()
      } catch (err) {
        onError?.(err)
      }
    }

    recorder.start()
    setIsListening(true)
  }, [cleanup, onResult, onEmpty, onError, onPermissionDenied, externalStream])

  const stopListening = useCallback(() => {
    activeRef.current = false
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    } else {
      cleanup()
    }
    setIsListening(false)
  }, [cleanup])

  return { isListening, startListening, stopListening, canRecord }
}
