/*
 * useVoiceRecorder.js
 * Manual click-to-talk voice capture for RPE's reply bar — tap to start,
 * watch the transcript fill in live as you talk, tap again to stop, then
 * review/edit and send it yourself like any typed message.
 *
 * Two capture paths, chosen automatically per browser:
 *
 * 1. Native SpeechRecognition (Web Speech API) — preferred. Ports
 *    /baseline's AIChatbot mechanism directly: results arrive in "final"
 *    and "interim" pieces per recognition instance, live, so the reply bar
 *    fills in as you talk. The API can end an instance on its own well
 *    before you're actually done (long pauses, browser-internal timeouts),
 *    so onend restarts a fresh instance seamlessly whenever the caller
 *    hasn't explicitly stopped yet — text already finalized before that
 *    restart is carried forward in sessionTranscriptRef so it reads as one
 *    continuous capture, not several disconnected fragments. Not available
 *    everywhere (e.g. Brave strips the Google key Chromium needs
 *    internally for it) — canUseNativeSpeech reflects that.
 *
 * 2. MediaRecorder -> backend /api/stt (Google Cloud Speech-to-Text, same
 *    endpoint MultimodalEngine's live mode already uses) — fallback for a
 *    browser without native SpeechRecognition. Records the whole utterance,
 *    then transcribes it in one batch call once you stop — there is no live
 *    fill here, only isTranscribing while that round trip is in flight, so
 *    a caller should show a "transcribing" state rather than expecting text
 *    to build up as the fallback path listens.
 *
 * Validation: neither path checks that the transcript is *correct* — there
 * is no ground truth to check it against, only what the recognizer itself
 * reports. The one real signal available either way is confidence (0-1),
 * exposed here as `lowConfidence`: true once any finalized chunk this
 * session scored under LOW_CONFIDENCE_THRESHOLD. It's a hint to double-check
 * before sending, not a hard gate — confidence scoring from either backend
 * is known to be inconsistent, so this never blocks anything, it just flags it.
 */
import { useCallback, useRef, useState } from 'react'
import { API_URL } from '@/lib/config'

const SpeechRecognitionApi =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
const canUseNativeSpeech = !!SpeechRecognitionApi

const canUseMediaRecorderFallback =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined'

export const canRecord = canUseNativeSpeech || canUseMediaRecorderFallback

const LOW_CONFIDENCE_THRESHOLD = 0.6
const FALLBACK_MAX_RECORDING_MS = 20000 // hard cap so a stuck mic doesn't record forever

export function useVoiceRecorder() {
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [lowConfidence, setLowConfidence] = useState(false)

  // Native SpeechRecognition path
  const recognitionRef       = useRef(null)
  const shouldContinueRef    = useRef(false)
  const sessionTranscriptRef = useRef('')
  const instanceFinalRef     = useRef('')
  const instanceInterimRef   = useRef('')

  // MediaRecorder fallback path
  const recorderRef      = useRef(null)
  const fallbackChunksRef = useRef([])
  const fallbackTimeoutRef = useRef(null)

  const stopListening = useCallback(() => {
    if (canUseNativeSpeech) {
      shouldContinueRef.current = false
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch { /* already stopped */ }
      }
      setIsListening(false)
      return
    }

    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current)
      fallbackTimeoutRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop() // onstop below does the rest
    }
  }, [])

  const startListeningNative = useCallback(() => {
    if (recognitionRef.current) return

    sessionTranscriptRef.current = ''
    instanceFinalRef.current = ''
    instanceInterimRef.current = ''
    setLiveTranscript('')
    setLowConfidence(false)
    shouldContinueRef.current = true

    const recognition = new SpeechRecognitionApi()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let instanceFinal = ''
      let interim = ''
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        const chunk = result[0].transcript
        if (result.isFinal) {
          instanceFinal += chunk + ' '
          if (result[0].confidence > 0 && result[0].confidence < LOW_CONFIDENCE_THRESHOLD) {
            setLowConfidence(true)
          }
        } else {
          interim += chunk
        }
      }
      instanceFinalRef.current = instanceFinal
      instanceInterimRef.current = interim
      setLiveTranscript((sessionTranscriptRef.current + instanceFinal + interim).trim())
    }

    recognition.onend = () => {
      sessionTranscriptRef.current += (instanceFinalRef.current + instanceInterimRef.current).trim() + ' '
      instanceFinalRef.current = ''
      instanceInterimRef.current = ''

      if (shouldContinueRef.current) {
        try { recognition.start() } catch { /* already running */ }
      } else {
        recognitionRef.current = null
        setIsListening(false)
      }
    }

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return
      shouldContinueRef.current = false
      recognitionRef.current = null
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [])

  const startListeningFallback = useCallback(async () => {
    if (recorderRef.current) return

    setLiveTranscript('')
    setLowConfidence(false)

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      })
    } catch {
      return // permission denied / no device — mic control stays off
    }

    fallbackChunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => { if (e.data.size > 0) fallbackChunksRef.current.push(e.data) }

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      recorderRef.current = null
      setIsListening(false)

      const chunks = fallbackChunksRef.current
      fallbackChunksRef.current = []
      if (chunks.length === 0) return

      setIsTranscribing(true)
      try {
        const blob = new Blob(chunks, { type: mimeType })
        const res = await fetch(`${API_URL}/api/stt`, {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: blob,
        })
        if (res.ok) {
          const data = await res.json()
          setLiveTranscript((data.transcript || '').trim())
          if (typeof data.confidence === 'number' && data.confidence > 0 && data.confidence < LOW_CONFIDENCE_THRESHOLD) {
            setLowConfidence(true)
          }
        }
        // A non-OK response just leaves liveTranscript empty — the learner
        // sees an empty bar and can try again or type instead, same as if
        // nothing had been heard.
      } catch {
        /* network/backend failure — same graceful no-op as above */
      } finally {
        setIsTranscribing(false)
      }
    }

    recorder.start()
    fallbackTimeoutRef.current = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
    }, FALLBACK_MAX_RECORDING_MS)
    setIsListening(true)
  }, [])

  const startListening = useCallback(() => {
    if (canUseNativeSpeech) startListeningNative()
    else if (canUseMediaRecorderFallback) startListeningFallback()
  }, [startListeningNative, startListeningFallback])

  return {
    isListening,
    isTranscribing,
    startListening,
    stopListening,
    liveTranscript,
    lowConfidence,
    canRecord,
    // Lets a caller adjust copy/placeholders — the fallback path has no live
    // fill, only a transcribing step after you stop.
    usesLiveCaptions: canUseNativeSpeech,
  }
}
