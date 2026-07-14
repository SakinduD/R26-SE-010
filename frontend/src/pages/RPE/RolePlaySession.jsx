import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Send, Loader2, ShieldAlert, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import ChatBubble from '@/components/RPE/ChatBubble'
import MetricsHUD from '@/components/RPE/MetricsHUD'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import Banner from '@/components/ui/Banner'
import KeyValuePair from '@/components/ui/KeyValuePair'

const computeNpcTone = (trust) =>
  trust >= 70 ? 'cooperative' : trust >= 40 ? 'neutral' : 'hostile'

const computeEscalationTone = (level) =>
  level >= 4 ? 'furious' : level >= 2 ? 'irritated' : 'controlled'

// REDESIGN: replaced hardcoded light-mode chips (bg-emerald-100 etc.) with Badge variants
const DIFFICULTY_BADGE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

export default function RolePlaySession() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, openingNpcLine, scenarioTitle, difficulty,
    conflictType, totalTurns, npcRole,
    recommendedTurns:          recommendedTurnsFromState,
    maxTurns:                  maxTurnsFromState,
    failureEscalationThreshold,
  } = location.state || {}

  const bottomRef      = useRef(null)
  const textareaRef    = useRef(null)
  const recognitionRef = useRef(null)   // SpeechRecognition instance (fresh each press)
  const npcAudioRef    = useRef(null)   // current NPC Audio element
  const countdownRef   = useRef(null)   // setInterval for auto-send countdown
  const autoSendRef    = useRef(null)   // setTimeout for auto-send

  // ── Stable function refs — always point to the latest render's version ─────
  // Prevents stale closures in effects, onresult, onended, and setTimeout chains.
  const playNpcVoiceRef        = useRef(null)
  const startListeningRef      = useRef(null)
  const handleSendWithTextRef  = useRef(null)
  const startMediaRecordingRef = useRef(null)  // MediaRecorder fallback
  const openMicAfterNpcRef     = useRef(null)  // unified dispatcher

  // MediaRecorder fallback state (ref so stale closures always read latest)
  const useMediaRecorderRef = useRef(false)
  const mrRef               = useRef(null)   // MediaRecorder instance
  const audioChunksRef      = useRef([])
  const silenceTimerRef     = useRef(null)
  const mediaStreamRef      = useRef(null)
  const audioCtxRef         = useRef(null)

  const [messages, setMessages]               = useState([])
  const [userInput, setUserInput]             = useState('')
  const [trustScore, setTrustScore]           = useState(50)
  const [escalationLevel, setEscalationLevel] = useState(0)
  const [currentEmotion, setCurrentEmotion]   = useState('calm')
  const [currentTurn, setCurrentTurn]         = useState(0)
  const [isLoading, setIsLoading]             = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [outcome, setOutcome]                 = useState(null)
  const [endReason, setEndReason]             = useState(null)

  const [trustDelta, setTrustDelta]         = useState(null)
  const [npcTone, setNpcTone]               = useState('neutral')
  const [escalationTone, setEscalationTone] = useState('controlled')
  const [previousTrust, setPreviousTrust]   = useState(50)

  const [recommendedTurns, setRecommendedTurns] = useState(
    recommendedTurnsFromState || totalTurns || 6
  )
  const [maxTurns, setMaxTurns] = useState(maxTurnsFromState || null)

  // ── Voice ──────────────────────────────────────────────────────────────────
  const [isListening,      setIsListening]      = useState(false)
  const [voiceEnabled,     setVoiceEnabled]     = useState(true)    // on by default
  const [speechSupported,  setSpeechSupported]  = useState(false)
  const [micError,         setMicError]         = useState(null)
  const [voiceUnavailable, setVoiceUnavailable] = useState(false)
  const [npcSpeaking,      setNpcSpeaking]      = useState(false)
  const [autoMicEnabled,   setAutoMicEnabled]   = useState(true)
  const [countdown,        setCountdown]        = useState(null)    // 2, 1, null
  const [useMediaRecorder, setUseMediaRecorder] = useState(false)   // switched on by network error

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    setMessages([{ role: 'npc', message: openingNpcLine, npcTone: 'hostile' }])
    if (!maxTurnsFromState) {
      rpeService.getSessionSummary(sessionId)
        .then((data) => {
          if (data.recommended_turns) setRecommendedTurns(data.recommended_turns)
          if (data.max_turns)         setMaxTurns(data.max_turns)
        })
        .catch(() => {})
    }
  }, [])

  // ── Speech recognition support check ──────────────────────────────────────
  useEffect(() => {
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
      setSpeechSupported(true)
    }
  }, [])

  // ── Play opening NPC line on mount — always use ref to get latest function ─
  useEffect(() => {
    if (openingNpcLine) {
      setTimeout(() => playNpcVoiceRef.current?.(openingNpcLine), 800)
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // ── startListening — fresh SpeechRecognition instance each press ──────────
  // Fresh instance avoids InvalidStateError after onend fires.
  // onresult captures handleSendWithText from the current render closure.
  const startListening = () => {
    if (isListening || isLoading || sessionComplete) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    const rec = new SR()
    rec.continuous     = false
    rec.interimResults = false
    rec.lang           = 'en-US'

    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      setUserInput(transcript)
      setIsListening(false)

      // 2-second auto-send countdown
      let count = 2
      setCountdown(count)
      countdownRef.current = setInterval(() => {
        count -= 1
        setCountdown(count)
        if (count <= 0) {
          clearInterval(countdownRef.current)
          setCountdown(null)
        }
      }, 1000)
      autoSendRef.current = setTimeout(() => {
        clearInterval(countdownRef.current)
        setCountdown(null)
        handleSendWithTextRef.current?.(transcript)   // always latest render's version
      }, 2000)
    }

    rec.onerror = (event) => {
      console.warn('Speech recognition error:', event.error)
      setIsListening(false)
      setCountdown(null)
      if (autoSendRef.current)  clearTimeout(autoSendRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)

      if (event.error === 'network') {
        // Google speech servers unreachable (common on localhost / restricted networks).
        // Silently fall back to MediaRecorder + Groq Whisper — no error shown to user.
        useMediaRecorderRef.current = true
        setUseMediaRecorder(true)
        setTimeout(() => startMediaRecordingRef.current?.(), 300)
        return
      }

      const MSGS = {
        'not-allowed':         'Microphone access denied — allow mic in browser settings.',
        'service-not-allowed': 'Speech service blocked — try a different browser.',
      }
      if (MSGS[event.error]) setMicError(MSGS[event.error])
    }

    rec.onend = () => setIsListening(false)

    recognitionRef.current = rec
    try {
      rec.start()
      setIsListening(true)
      setUserInput('')
      setMicError(null)
      setCountdown(null)
    } catch (e) {
      console.error('Could not start speech recognition:', e)
      setIsListening(false)
    }
  }

  // Update refs so async callbacks always call the latest versions
  startListeningRef.current   = startListening
  useMediaRecorderRef.current = useMediaRecorder

  const stopListening = () => {
    recognitionRef.current?.stop()
    if (mrRef.current?.state === 'recording') mrRef.current.stop()
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    setIsListening(false)
    if (autoSendRef.current)  clearTimeout(autoSendRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(null)
  }

  const toggleMic = () => {
    if (isListening) {
      stopListening()
    } else if (useMediaRecorderRef.current) {
      startMediaRecordingRef.current?.()
    } else {
      startListening()
    }
  }

  // ── MediaRecorder fallback — used after Web Speech API 'network' error ───
  // Records mic audio, detects silence via AudioContext RMS, sends blob to
  // Groq Whisper for transcription, then fires the 2-second auto-send loop.
  const startMediaRecording = async () => {
    if (isListening || isLoading || sessionComplete) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      // Build analyser for silence detection
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source   = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const dataArr = new Uint8Array(analyser.frequencyBinCount)

      const recorder = new MediaRecorder(stream)
      mrRef.current         = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        try { audioCtxRef.current?.close() } catch (_) {}
        audioCtxRef.current = null
        setIsListening(false)

        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        if (blob.size < 500) return  // nothing meaningful recorded

        const result     = await rpeService.transcribeAudio(blob)
        const transcript = result?.transcript?.trim()
        if (!transcript) return

        setUserInput(transcript)

        // 2-second auto-send countdown — same as Web Speech API path
        let count = 2
        setCountdown(count)
        countdownRef.current = setInterval(() => {
          count -= 1
          setCountdown(count)
          if (count <= 0) { clearInterval(countdownRef.current); setCountdown(null) }
        }, 1000)
        autoSendRef.current = setTimeout(() => {
          clearInterval(countdownRef.current)
          setCountdown(null)
          handleSendWithTextRef.current?.(transcript)
        }, 2000)
      }

      recorder.start()
      setIsListening(true)
      setUserInput('')
      setMicError(null)
      setCountdown(null)

      // Silence detection — stops recording 1.8 s after last detected speech
      const THRESHOLD    = 8     // RMS (0–100); below = silence
      const SILENCE_WAIT = 1800  // ms of continuous silence before auto-stop
      const MAX_DURATION = 14000 // hard cap so mic doesn't run forever

      let lastSoundMs  = Date.now()
      let voiceStarted = false

      const checkSilence = () => {
        if (!mrRef.current || mrRef.current.state !== 'recording') return
        analyser.getByteTimeDomainData(dataArr)
        let sum = 0
        for (let i = 0; i < dataArr.length; i++) {
          const v = (dataArr[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / dataArr.length) * 100
        if (rms > THRESHOLD) { lastSoundMs = Date.now(); voiceStarted = true }
        if (voiceStarted && Date.now() - lastSoundMs > SILENCE_WAIT) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
          mrRef.current.stop()
          return
        }
        silenceTimerRef.current = setTimeout(checkSilence, 80)
      }
      silenceTimerRef.current = setTimeout(checkSilence, 80)

      // Hard cap
      setTimeout(() => {
        if (mrRef.current?.state === 'recording') {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
          mrRef.current.stop()
        }
      }, MAX_DURATION)

    } catch (err) {
      console.error('MediaRecorder start error:', err)
      setIsListening(false)
      if (err.name === 'NotAllowedError') {
        setMicError('Microphone access denied — allow mic in browser settings.')
      }
    }
  }
  startMediaRecordingRef.current = startMediaRecording

  // ── Unified mic dispatcher — called by all auto-flow triggers ─────────────
  // Reads the latest render's state so it always picks the right implementation.
  const openMicAfterNpc = () => {
    if (!autoMicEnabled || sessionComplete) return
    if (useMediaRecorderRef.current) startMediaRecordingRef.current?.()
    else if (speechSupported)        startListeningRef.current?.()
  }
  openMicAfterNpcRef.current = openMicAfterNpc

  // ── NPC voice playback — auto-opens mic when audio ends ───────────────────
  const playNpcVoice = async (npcText) => {
    if (!voiceEnabled || !npcText?.trim()) return

    setNpcSpeaking(true)

    try {
      const result = await rpeService.getNpcVoice(npcText, conflictType)

      if (!result.available) {
        setVoiceUnavailable(true)
        // Gemini TTS unavailable — browser speech synthesis keeps the loop going
        speakWithBrowser(npcText)
        return
      }
      setVoiceUnavailable(false)

      if (!result.audio_base64) {
        // Gemini returned no audio — use browser speech synthesis so the loop continues
        speakWithBrowser(npcText)
        return
      }

      const raw   = atob(result.audio_base64)
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      const blob  = new Blob([bytes], { type: 'audio/wav' })
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)

      if (npcAudioRef.current) {
        npcAudioRef.current.pause()
        npcAudioRef.current = null
      }
      npcAudioRef.current = audio

      audio.play().catch(e => {
        // Browser blocked autoplay (common before first user interaction).
        // Clear speaking state and open mic so the loop can continue.
        console.warn('NPC audio autoplay blocked:', e)
        URL.revokeObjectURL(url)
        npcAudioRef.current = null
        setNpcSpeaking(false)
        setTimeout(() => openMicAfterNpcRef.current?.(), 400)
      })

      audio.onended = () => {
        URL.revokeObjectURL(url)
        npcAudioRef.current = null
        setNpcSpeaking(false)
        setTimeout(() => openMicAfterNpcRef.current?.(), 400)
      }

      audio.onerror = () => {
        URL.revokeObjectURL(url)
        npcAudioRef.current = null
        setNpcSpeaking(false)
        setTimeout(() => openMicAfterNpcRef.current?.(), 400)
      }

    } catch (e) {
      console.error('NPC voice playback error:', e)
      setNpcSpeaking(false)
    }
  }

  // ── Browser speech synthesis fallback ─────────────────────────────────────
  // Used when Gemini TTS is unavailable or returns no audio.
  // speechSynthesis is exempt from autoplay policy — works even before user interaction.
  const speakWithBrowser = (text) => {
    if (!window.speechSynthesis) {
      setNpcSpeaking(false)
      setTimeout(() => openMicAfterNpcRef.current?.(), 400)
      return
    }

    window.speechSynthesis.cancel()   // stop any current utterance
    const clean = text.replace(/[*_]/g, '').trim()
    const utt   = new SpeechSynthesisUtterance(clean)
    utt.rate    = 0.88
    utt.pitch   = 0.82    // lower pitch → authority / tension
    utt.volume  = 1.0

    // Prefer a deep US-English voice if available
    const voices = window.speechSynthesis.getVoices()
    const preferred = voices.find(v => v.lang === 'en-US' && v.name.includes('Male'))
                   || voices.find(v => v.lang.startsWith('en'))
    if (preferred) utt.voice = preferred

    utt.onend  = () => {
      setNpcSpeaking(false)
      setTimeout(() => openMicAfterNpcRef.current?.(), 400)
    }
    utt.onerror = () => setNpcSpeaking(false)

    setNpcSpeaking(true)
    window.speechSynthesis.speak(utt)
  }

  // Update ref so mount effect and onended always call the latest playNpcVoice
  playNpcVoiceRef.current = playNpcVoice

  // ── handleSendWithText — sends transcript directly (avoids stale state) ───
  const handleSendWithText = async (text) => {
    if (!text?.trim() || isLoading || sessionComplete) return

    stopListening()

    const userMsg = { role: 'user', message: text, emotion: null, trustDelta: null }
    setMessages(prev => [...prev, userMsg])
    setUserInput('')
    setIsLoading(true)

    try {
      const response   = await rpeService.sendTurn(sessionId, text)
      const delta      = response.trust_score - previousTrust
      const newTone    = computeNpcTone(response.trust_score)
      const newEscTone = computeEscalationTone(response.escalation_level)

      setTrustScore(response.trust_score)
      setEscalationLevel(response.escalation_level)
      setCurrentEmotion(response.emotion)
      setCurrentTurn(response.turn)
      setTrustDelta(delta)
      setPreviousTrust(response.trust_score)
      setNpcTone(newTone)
      setEscalationTone(newEscTone)

      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          emotion: response.emotion, trustDelta: delta,
        }
        return [...updated, { role: 'npc', message: response.npc_response, npcTone: newTone }]
      })

      setIsLoading(false)

      if (response.session_complete) {
        setSessionComplete(true)
        setOutcome(response.outcome)
        setEndReason(response.end_reason)
        await playNpcVoiceRef.current?.(response.npc_response)
        setTimeout(() => {
          navigate('/roleplay/session/complete', {
            state: {
              sessionId, trustScore: response.trust_score,
              escalationLevel: response.escalation_level,
              outcome: response.outcome, endReason: response.end_reason,
              recommendedTurns, maxTurns, totalTurns,
              scenarioTitle, currentTurn: response.turn,
            },
          })
        }, 3000)
        return
      }

      // Play NPC response — mic opens automatically in audio.onended
      await playNpcVoiceRef.current?.(response.npc_response)

    } catch (err) {
      setIsLoading(false)
      setMessages(prev => [
        ...prev,
        { role: 'npc', message: `[System error: ${err.message}]`, npcTone: null },
      ])
      setTimeout(() => openMicAfterNpcRef.current?.(), 1000)
    }
  }

  // Update ref so onresult setTimeout always calls the latest handleSendWithText
  handleSendWithTextRef.current = handleSendWithText

  const handleSend = async () => {
    const input = userInput.trim()
    if (!input || isLoading || sessionComplete) return

    const userMsg = { role: 'user', message: input, emotion: null, trustDelta: null }
    setMessages(prev => [...prev, userMsg])
    setUserInput('')
    setIsLoading(true)

    try {
      const response = await rpeService.sendTurn(sessionId, input)

      const delta      = response.trust_score - previousTrust
      const newTone    = computeNpcTone(response.trust_score)
      const newEscTone = computeEscalationTone(response.escalation_level)

      setTrustScore(response.trust_score)
      setEscalationLevel(response.escalation_level)
      setCurrentEmotion(response.emotion)
      setCurrentTurn(response.turn)
      setTrustDelta(delta)
      setPreviousTrust(response.trust_score)
      setNpcTone(newTone)
      setEscalationTone(newEscTone)

      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          emotion:    response.emotion,
          trustDelta: delta,
        }
        return [
          ...updated,
          { role: 'npc', message: response.npc_response, npcTone: newTone },
        ]
      })

      // Fire-and-forget: audio fetches in background, doesn't delay the turn UI
      playNpcVoice(response.npc_response)

      if (response.session_complete) {
        setSessionComplete(true)
        setOutcome(response.outcome)
        setEndReason(response.end_reason)

        setTimeout(() => {
          navigate('/roleplay/session/complete', {
            state: {
              sessionId,
              trustScore:       response.trust_score,
              escalationLevel:  response.escalation_level,
              outcome:          response.outcome,
              endReason:        response.end_reason,
              recommendedTurns,
              maxTurns,
              totalTurns,
              scenarioTitle,
              currentTurn:      response.turn,
            },
          })
        }, 2000)
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'npc', message: `[System error: ${err.message}]`, npcTone: null },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /* ── turn counter sub-label ─────────────────────────────── */
  const turnLabel = (() => {
    if (!maxTurns) return `Recommended: ${recommendedTurns} turns`
    if (currentTurn < recommendedTurns) return `Recommended: ${recommendedTurns} turns`
    if (currentTurn < maxTurns) return `Extended — Max: ${maxTurns} turns`
    return 'Final turns ⚠'
  })()

  // REDESIGN: turnLabel color now uses tokens (was text-amber-500 / text-red-500)
  const turnLabelColor = (() => {
    if (!maxTurns || currentTurn < recommendedTurns) return 'var(--text-tertiary)'
    if (currentTurn < maxTurns) return 'var(--warning)'
    return 'var(--danger)'
  })()

  /* ── escalation warning threshold ──────────────────────── */
  const warnAt = failureEscalationThreshold != null
    ? Math.max(1, failureEscalationThreshold - 2)
    : 3

  return (
    <div
      style={{
        height: 'calc(100vh - 48px)',
        background: 'var(--bg-canvas)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* REDESIGN: top bar restyled with bg-surface + border-subtle, prototype 48px height */}
      <header
        style={{
          flexShrink: 0,
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <h1
            className="fg"
            style={{
              fontWeight: 600,
              fontSize: 15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {scenarioTitle}
          </h1>
          {difficulty && (
            <Badge variant={DIFFICULTY_BADGE[difficulty] ?? 'neutral'}>
              <span style={{ textTransform: 'capitalize' }}>{difficulty}</span>
            </Badge>
          )}
        </div>

        {/* Right side: voice toggle + turn counter */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexShrink: 0,
          }}
        >
          {/* Auto-mic toggle */}
          {speechSupported && (
            <button
              onClick={() => setAutoMicEnabled(v => !v)}
              title="Auto mic — mic opens automatically after NPC speaks"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                border: 'none',
                transition: 'background 200ms',
                background: autoMicEnabled ? '#16a34a' : 'var(--bg-elevated)',
                color:      autoMicEnabled ? '#fff'    : 'var(--text-tertiary)',
              }}
            >
              {autoMicEnabled ? '🔁 Auto' : '⏸ Manual'}
            </button>
          )}

          {/* NPC voice toggle */}
          <button
            onClick={() => { setVoiceEnabled(v => !v); setVoiceUnavailable(false) }}
            title={
              voiceUnavailable ? 'NPC voice unavailable — GEMINI_API_KEY not configured?' :
              voiceEnabled     ? 'NPC voice on — click to mute' :
                                 'NPC voice off — click to enable'
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
              transition: 'background 200ms',
              background: voiceUnavailable ? 'var(--bg-elevated)' :
                          voiceEnabled     ? 'var(--accent)'      : 'var(--bg-elevated)',
              color: voiceUnavailable ? 'var(--danger)'     :
                     voiceEnabled     ? '#fff'               : 'var(--text-tertiary)',
            }}
          >
            {voiceUnavailable
              ? <VolumeX size={13} strokeWidth={2} />
              : voiceEnabled
                ? <Volume2 size={13} strokeWidth={2} />
                : <VolumeX size={13} strokeWidth={2} />}
            {voiceUnavailable ? 'Voice N/A' : voiceEnabled ? 'Voice On' : 'Voice Off'}
          </button>

          {/* Turn counter */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            {currentTurn === 0 ? (
              <span className="t-cap">Not started</span>
            ) : (
              <span className="score-num fg" style={{ fontSize: 14, fontWeight: 600 }}>
                Turn {currentTurn}
              </span>
            )}
            {currentTurn > 0 && (
              <span className="score-num" style={{ fontSize: 11, color: turnLabelColor }}>
                {turnLabel}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Chat column */}
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>

          {/* REDESIGN: messages scroll uses custom-scrollbar; spacing tweaked, no semantic change */}
          <div
            className="custom-scrollbar"
            style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            {messages.map((msg, i) => (
              <ChatBubble
                key={i}
                role={msg.role}
                message={msg.message}
                emotion={msg.emotion}
                trustDelta={msg.trustDelta}
                npcTone={msg.npcTone}
                npcRole={npcRole}
              />
            ))}

            {/* NPC speaking animation — bouncing dots while audio plays */}
            {npcSpeaking && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '10px 14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ display: 'inline-flex', gap: 5 }}>
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className="animate-bounce"
                        style={{
                          width: 7, height: 7,
                          background: '#3b82f6',
                          borderRadius: '50%',
                          animationDelay: `${i * 150}ms`,
                        }}
                      />
                    ))}
                  </span>
                  <span style={{ fontSize: 12, color: '#3b82f6', fontWeight: 500 }}>
                    NPC is speaking…
                  </span>
                </div>
              </div>
            )}

            {/* REDESIGN: typing indicator now uses bg-surface + border-subtle (was bg-slate-900) */}
            {isLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '10px 14px',
                  }}
                >
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="animate-bounce"
                        style={{
                          width: 6,
                          height: 6,
                          background: 'var(--text-tertiary)',
                          borderRadius: '50%',
                          animationDelay: `${i * 150}ms`,
                        }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* REDESIGN: session-complete banners replaced bg-emerald-50/red-50/amber-50 with semantic Banner */}
          {sessionComplete && endReason === 'trust_sustained' && (
            <div style={{ margin: '0 24px 12px' }}>
              <Banner variant="success">You built strong trust — the situation has been resolved!</Banner>
            </div>
          )}
          {sessionComplete && endReason === 'npc_exit' && (
            <div style={{ margin: '0 24px 12px' }}>
              <Banner variant="danger">The conversation broke down — the NPC ended the session.</Banner>
            </div>
          )}
          {sessionComplete && endReason === 'max_turns_reached' && (
            <div style={{ margin: '0 24px 12px' }}>
              <Banner variant={outcome === 'success' ? 'success' : 'warning'}>
                {outcome === 'success'
                  ? 'Session complete — well handled!'
                  : 'Maximum turns reached — review your feedback.'}
              </Banner>
            </div>
          )}

          {/* REDESIGN: escalation warning replaced bg-red-50 with Banner danger; CSS height-transition preserved */}
          <div
            style={{
              margin: '0 24px',
              overflow: 'hidden',
              transition: 'max-height 300ms var(--ease)',
              maxHeight: escalationLevel >= warnAt ? 64 : 0,
              marginBottom: escalationLevel >= warnAt ? 8 : 0,
            }}
          >
            <Banner variant="danger">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                <span style={{ fontWeight: 500 }}>
                  Tension is rising. Try to de-escalate your response.
                </span>
              </div>
            </Banner>
          </div>

          {/* REDESIGN: input bar now uses bg-surface, .input class for textarea, .btn-primary for send */}
          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              padding: '16px 24px',
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <textarea
                ref={textareaRef}
                rows={2}
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || sessionComplete || isListening || countdown !== null}
                placeholder={
                  isListening      ? 'Listening… speak now' :
                  countdown !== null ? 'Sending shortly… or edit to cancel' :
                                     'Type your response… (Enter to send, Shift+Enter for newline)'
                }
                className={cn('input', 'textarea')}
                style={{ flex: 1, minHeight: 64, padding: 12, lineHeight: 1.5 }}
              />

              {/* Mic button — only shown when browser supports Web Speech API */}
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={isLoading || sessionComplete || countdown !== null || npcSpeaking}
                  title={isListening ? 'Stop recording' : 'Speak your response'}
                  style={{
                    width: 40, height: 40, padding: 0, flexShrink: 0,
                    borderRadius: '50%', border: 'none',
                    cursor: (isLoading || sessionComplete || countdown !== null || npcSpeaking)
                      ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 200ms',
                    background: isListening ? '#ef4444' : 'var(--bg-elevated)',
                    color:      isListening ? '#fff'    : 'var(--text-tertiary)',
                  }}
                  aria-label={isListening ? 'Stop recording' : 'Speak your response'}
                >
                  {isListening
                    ? <MicOff size={16} strokeWidth={1.8} />
                    : <Mic    size={16} strokeWidth={1.8} />}
                </button>
              )}

              <button
                type="button"
                onClick={handleSend}
                disabled={!userInput.trim() || isLoading || sessionComplete}
                className="btn btn-primary"
                style={{ width: 40, height: 40, padding: 0, flexShrink: 0 }}
                aria-label="Send"
              >
                <span className="btn-label">
                  {isLoading
                    ? <Loader2 size={16} strokeWidth={1.8} className="animate-spin" />
                    : <Send size={16} strokeWidth={1.8} />}
                </span>
              </button>
            </div>

            {/* Countdown — auto-send in N seconds */}
            {countdown !== null && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8,
                            fontSize: 12, color: '#f97316', fontWeight: 500 }}>
                <span>Sending in {countdown}s…</span>
                <button
                  onClick={() => {
                    if (autoSendRef.current)  clearTimeout(autoSendRef.current)
                    if (countdownRef.current) clearInterval(countdownRef.current)
                    setCountdown(null)
                    setUserInput('')
                  }}
                  style={{ fontSize: 11, color: 'var(--text-tertiary)', textDecoration: 'underline',
                           background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Listening indicator */}
            {isListening && countdown === null && (
              <p className="animate-pulse"
                 style={{ marginTop: 6, fontSize: 12, color: '#ef4444', fontWeight: 500 }}>
                ● Listening… speak now
              </p>
            )}

            {/* Mic error */}
            {!isListening && countdown === null && micError && (
              <p style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)', fontWeight: 500 }}>
                ⚠ {micError}
              </p>
            )}
          </div>
        </div>

        {/* REDESIGN: sidebar restyled with bg-surface + border-subtle */}
        <aside
          className="custom-scrollbar"
          style={{
            display: 'none',
            width: 288,
            flexShrink: 0,
            flexDirection: 'column',
            gap: 16,
            borderLeft: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            overflowY: 'auto',
            padding: 16,
          }}
          // Restored desktop visibility via CSS media style
          data-rpe-sidebar
        >
          <MetricsHUD
            trustScore={trustScore}
            escalationLevel={escalationLevel}
            emotion={currentEmotion}
            trustDelta={trustDelta}
            npcTone={npcTone}
            escalationTone={escalationTone}
            failureEscalationThreshold={failureEscalationThreshold}
          />

          {/* REDESIGN: session info card now uses Card + KeyValuePair */}
          <div className="card card-elevated" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--bg-elevated)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div className="t-over" style={{ color: 'var(--accent)' }}>Session Info</div>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <KeyValuePair k="Scenario" v={scenarioTitle} />
              <KeyValuePair k="NPC Role" v={npcRole} />
              <KeyValuePair k="Conflict" v={conflictType} />
              <KeyValuePair
                k="Progress"
                v={currentTurn === 0 ? 'Not started' : `Turn ${currentTurn} of ${recommendedTurns}`}
                mono
              />
              {maxTurns && (
                <KeyValuePair k="Max turns" v={`${maxTurns} (hard cap)`} mono />
              )}
            </div>
          </div>
        </aside>

      </div>

      {/* Inline style override to make the sidebar visible on desktop only,
          replacing the original 'hidden md:flex' Tailwind utility */}
      <style>{`
        @media (min-width: 768px) {
          aside[data-rpe-sidebar] { display: flex !important; }
        }
      `}</style>
    </div>
  )
}
