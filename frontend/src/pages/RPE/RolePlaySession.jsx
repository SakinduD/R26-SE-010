import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, Loader2, Smile, Meh, AlertCircle, AlertTriangle, Frown, HelpCircle, Angry, Brain, Mic, MicOff } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { analyticsService } from '@/services/analytics/analyticsService'
import { integrateCompletedSession } from '@/pages/Analytics/analyticsIntegrationUtils'
import { cn } from '@/lib/utils'
import TalkingHeadAvatar from '@/components/RPE/TalkingHeadAvatar'
import { useVoiceRecorder, canRecord } from '@/hooks/useVoiceRecorder'

// NPC's own emotional reaction per turn (8-value, from NPCResponse.emotion) — tints
// the NPC's message bubble and shows a small reaction icon. Not the user's emotion.
const EMOTION_META = {
  neutral:    { color: '#8B949E', glow: 'rgba(139,148,158,0.10)', Icon: Meh },
  happy:      { color: '#3FB950', glow: 'rgba(63,185,80,0.10)',   Icon: Smile },
  surprised:  { color: '#D29922', glow: 'rgba(210,153,34,0.10)',  Icon: AlertCircle },
  frustrated: { color: '#DB7B2B', glow: 'rgba(219,123,43,0.10)',  Icon: AlertTriangle },
  sad:        { color: '#6E9BC7', glow: 'rgba(110,155,199,0.10)', Icon: Frown },
  skeptical:  { color: '#7C3AED', glow: 'rgba(124,58,237,0.10)',  Icon: HelpCircle },
  angry:      { color: '#F85149', glow: 'rgba(248,81,73,0.12)',   Icon: Angry },
  thinking:   { color: '#5B7CE0', glow: 'rgba(91,124,224,0.10)',  Icon: Brain },
}

const END_REASON_COPY = {
  natural_resolution: { icon: '✅', title: 'You Worked It Out',        sub: 'You brought the conversation to a good place.' },
  user_exit_intent:   { icon: '👋', title: 'Session Ended',            sub: 'You chose to end the conversation.' },
  npc_exit:           { icon: '💢', title: 'Session Ended',            sub: 'The conversation broke down under pressure.' },
  trust_sustained:    { icon: '🎉', title: 'Trust Built',              sub: 'You built enough trust to resolve the situation.' },
  max_turns_reached:  { icon: '⏱', title: 'You Reached the Turn Limit', sub: "You've used up all your turns for this session." },
}

const formatDuration = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function RolePlaySession() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, openingNpcLine, scenarioTitle, difficulty,
    totalTurns, npcRole,
    recommendedTurns: recommendedTurnsFromState,
    maxTurns:         maxTurnsFromState,
  } = location.state || {}

  const bottomRef            = useRef(null)
  const transcriptRef        = useRef(null)
  const startListeningRef    = useRef(() => {})
  const stopListeningRef     = useRef(() => {})
  const shouldListenRef      = useRef(false)
  const listenFailuresRef    = useRef(0)
  const isNearBottomRef      = useRef(true)
  const completeTimeoutRef   = useRef(null)
  const completeNavStateRef  = useRef(null)
  const headRef              = useRef(null)
  const openingSpokenRef     = useRef(false)

  const [messages, setMessages]               = useState([])
  const [userInput, setUserInput]             = useState('')
  const [currentTurn, setCurrentTurn]         = useState(0)
  const [isLoading, setIsLoading]             = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [outcome, setOutcome]                 = useState(null)
  const [endReason, setEndReason]             = useState(null)
  const [showScrollPill, setShowScrollPill]   = useState(false)
  const [elapsedSeconds, setElapsedSeconds]   = useState(0)
  // Not driven visually yet (3D character is a later step) — kept in state so
  // it's available and inspectable per turn.
  const [lastAnimation, setLastAnimation]     = useState(null)

  const [autoMicEnabled, setAutoMicEnabled] = useState(canRecord)
  const [npcSpeaking, setNpcSpeaking]       = useState(false)

  const [recommendedTurns, setRecommendedTurns] = useState(
    recommendedTurnsFromState || totalTurns || 6
  )
  const [maxTurns, setMaxTurns] = useState(maxTurnsFromState || null)

  const turnCap = maxTurns || recommendedTurns || 1
  const progressPct = Math.min(100, Math.round((currentTurn / turnCap) * 100))

  // Session duration clock — freezes once the session ends.
  useEffect(() => {
    if (sessionComplete) return
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [sessionComplete])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    isNearBottomRef.current = true
    setShowScrollPill(false)
  }, [])

  // Only new messages should pull the view back to the bottom — isLoading
  // toggling twice per turn with no new content was re-running this and
  // could yank a mid-scroll user back down without anything new to show.
  useEffect(() => {
    if (isNearBottomRef.current) scrollToBottom()
  }, [messages, scrollToBottom])

  const handleTranscriptScroll = () => {
    const el = transcriptRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    isNearBottomRef.current = nearBottom
    setShowScrollPill(!nearBottom)
  }

  const speak = useCallback((text) => {
    return new Promise((resolve) => {
      if (!text) { resolve(); return }

      const head = headRef.current
      if (head) {
        // Real avatar voice (Google TTS via /api/gtts) + lip sync.
        // speakText() queues the utterance; speakMarker() queues a marker
        // right after it, whose callback fires once the queue reaches that
        // point — i.e. once the utterance has finished playing.
        setNpcSpeaking(true)
        head.speakText(text)
        head.speakMarker(() => { setNpcSpeaking(false); resolve() })
        return
      }

      // Fallback: avatar not loaded/available yet — browser TTS so the
      // session still has a voice instead of silence.
      if (!window.speechSynthesis) { resolve(); return }
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.onstart = () => setNpcSpeaking(true)
      utterance.onend   = () => { setNpcSpeaking(false); resolve() }
      utterance.onerror = () => { setNpcSpeaking(false); resolve() }
      window.speechSynthesis.speak(utterance)
    })
  }, [])

  const speakOpeningLine = useCallback(() => {
    if (openingSpokenRef.current) return
    openingSpokenRef.current = true
    speak(openingNpcLine).then(() => {
      if (autoMicEnabled) startListeningRef.current()
    })
  }, [speak, openingNpcLine, autoMicEnabled])

  const handleSendWithText = useCallback(async (rawInput) => {
    const input = (rawInput ?? '').trim()
    if (!input || isLoading || sessionComplete) return

    stopListeningRef.current()

    setMessages(prev => [...prev, { role: 'user', message: input }])
    setUserInput('')
    setIsLoading(true)

    try {
      const response = await rpeService.sendTurn(sessionId, input)
      setCurrentTurn(response.turn)
      setLastAnimation(response.animation)
      if (import.meta.env.DEV) {
        console.log('[RPE] turn', response.turn, '| emotion:', response.emotion, '| animation:', response.animation)
      }

      setMessages(prev => [
        ...prev,
        { role: 'npc', message: response.npc_response, emotion: response.emotion },
      ])

      if (response.session_complete) {
        shouldListenRef.current = false

        // Hand the finished session to the analytics module straight away, so
        // scores, XP and the adapted training plan are ready without the learner
        // having to open an analytics page first. Fire-and-forget by design: it
        // never throws and must not delay the completion overlay.
        integrateCompletedSession(analyticsService, sessionId)

        completeNavStateRef.current = {
          sessionId,
          trustScore:      response.trust_score,
          escalationLevel: response.escalation_level,
          outcome:         response.outcome,
          endReason:       response.end_reason,
          recommendedTurns,
          maxTurns,
          totalTurns,
          scenarioTitle,
          npcRole,
          currentTurn:     response.turn,
        }

        // Let the avatar finish speaking the NPC's final line before
        // showing the "Session Complete" overlay — sessionComplete drives
        // data-voice-state="complete", which is what makes the overlay
        // visible, so setting it any earlier popped the notice up mid-speech.
        await speak(response.npc_response)

        setSessionComplete(true)
        setOutcome(response.outcome)
        setEndReason(response.end_reason)

        completeTimeoutRef.current = setTimeout(() => {
          navigate('/roleplay/session/complete', { state: completeNavStateRef.current })
        }, 2000)
      } else {
        await speak(response.npc_response)
        if (autoMicEnabled) startListeningRef.current()
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'npc', message: `[System error: ${err.message}]` },
      ])
      if (autoMicEnabled && !sessionComplete) startListeningRef.current()
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, sessionComplete, sessionId, autoMicEnabled, speak, recommendedTurns, maxTurns, totalTurns, scenarioTitle, navigate])

  const handleViewFeedbackNow = () => {
    if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
    if (completeNavStateRef.current) {
      navigate('/roleplay/session/complete', { state: completeNavStateRef.current })
    }
  }

  const { isListening, startListening: startRecording, stopListening } = useVoiceRecorder({
    onResult: (transcript) => {
      listenFailuresRef.current = 0
      handleSendWithText(transcript)
    },
    // Recorded but nothing understood (silence/noise only) — just listen again.
    onEmpty: () => {
      if (shouldListenRef.current) setTimeout(() => startListeningRef.current(), 300)
    },
    // /api/stt request failed (network, backend, Google STT) — retry like
    // SpeechRecognition's old 'network' error, then give up after 3 strikes.
    onError: () => {
      listenFailuresRef.current += 1
      if (listenFailuresRef.current >= 3) {
        listenFailuresRef.current = 0
        setAutoMicEnabled(false)
      } else if (shouldListenRef.current) {
        setTimeout(() => startListeningRef.current(), 300)
      }
    },
    onPermissionDenied: () => setAutoMicEnabled(false),
  })

  const startListening = useCallback(() => {
    if (!shouldListenRef.current) return
    startRecording()
  }, [startRecording])

  useEffect(() => {
    startListeningRef.current = startListening
  }, [startListening])

  useEffect(() => {
    stopListeningRef.current = stopListening
  }, [stopListening])

  // Manual override for the auto-mic detection — auto on/off can misfire
  // (permission hiccup, a few failed STT requests) and there was previously
  // no way back from "Text Mode" except reloading the page. This lets the
  // user flip it themselves at any point in the session.
  const handleToggleMic = useCallback(() => {
    if (autoMicEnabled) {
      setAutoMicEnabled(false)
      stopListeningRef.current()
    } else {
      listenFailuresRef.current = 0
      setAutoMicEnabled(true)
      if (!npcSpeaking && !isLoading && !sessionComplete) {
        startListeningRef.current()
      }
    }
  }, [autoMicEnabled, npcSpeaking, isLoading, sessionComplete])

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    shouldListenRef.current = true
    setMessages([{ role: 'npc', message: openingNpcLine }])

    if (!maxTurnsFromState) {
      rpeService.getSessionSummary(sessionId)
        .then((data) => {
          if (data.recommended_turns) setRecommendedTurns(data.recommended_turns)
          if (data.max_turns)         setMaxTurns(data.max_turns)
        })
        .catch(() => {})
    }

    // Opening line is spoken once the avatar is ready (or has failed to
    // load) — see the TalkingHeadAvatar onReady/onError handlers below.
    // Speaking it here immediately would almost always fire before the
    // avatar finishes loading and fall back to the robotic browser voice.

    return () => {
      shouldListenRef.current = false
      stopListeningRef.current()
      if (window.speechSynthesis) window.speechSynthesis.cancel()
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endReasonMeta = endReason ? END_REASON_COPY[endReason] : null
  const cardVariant =
    outcome === 'success' ? 'success'
      : endReason === 'npc_exit' || outcome === 'failure' ? 'failure'
      : 'natural'

  const voiceState = sessionComplete
    ? 'complete'
    : npcSpeaking
      ? 'speaking'
      : isLoading
        ? 'processing'
        : isListening
          ? 'listening'
          : autoMicEnabled ? 'listening' : 'manual'

  const voicePillLabel = autoMicEnabled ? 'Voice On' : 'Typing'

  return (
    <div className="rpe-vs" data-voice-state={voiceState} style={{ height: 'calc(100vh - 48px)' }}>

      <div className="shell">
        {/* ── Identity rail ───────────────────────────────── */}
        <aside className="rail">
          <div className="npc-card">
            <div className={cn('avatar-wrap', npcSpeaking && 'speaking')}>
              <div className="avatar-pulse" />
              <div className="avatar-inner">🧑‍💼</div>
            </div>
            <div>
              <div className="npc-name">{npcRole || 'Character'}</div>
              {difficulty && <div className="npc-role">{difficulty} scenario</div>}
            </div>
            <div className="scenario-pill">{scenarioTitle}</div>
          </div>

          <div className="rail-divider" />

          <div>
            <div className="rail-label">Conversation</div>
            <div>
              <span className="turn-count" key={currentTurn}>{currentTurn}</span>
              <span className="turn-max">{maxTurns ? `/ ${maxTurns} max` : ''}</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="duration">{formatDuration(elapsedSeconds)}</div>
          </div>

          <div className="rail-divider" />
          <div className="rail-spacer" />

          <button
            type="button"
            className="end-btn"
            onClick={() => handleSendWithText('exit')}
            disabled={isLoading || sessionComplete}
          >
            End Session
          </button>
        </aside>

        {/* ── Main column ─────────────────────────────────── */}
        <main className="main">
          <div className="main-split">
            {/* Character panel — TalkingHead 3D avatar. Speaks every NPC
                line (opening + turns) via speak(), which routes through
                headRef once the avatar is ready. */}
            <div className="character-panel">
              <TalkingHeadAvatar
                onReady={(head) => { headRef.current = head; speakOpeningLine() }}
                onError={() => speakOpeningLine()}
                className="character-avatar"
              />
            </div>

            {/* Conversation panel — existing chat UI, unchanged. */}
            <div className="conversation-panel">
          <div className="topbar">
            <button type="button" className="back-btn" onClick={() => navigate('/roleplay')} aria-label="Back">
              <ArrowLeft size={16} strokeWidth={1.8} />
            </button>
            <div className="topbar-title">{scenarioTitle}</div>
            <button
              type="button"
              className={cn('voice-pill', !autoMicEnabled && 'muted')}
              onClick={handleToggleMic}
              disabled={!canRecord || sessionComplete}
              title={autoMicEnabled ? 'Type instead of talking' : 'Talk instead of typing'}
            >
              {autoMicEnabled ? <Mic size={12} strokeWidth={2} /> : <MicOff size={12} strokeWidth={2} />}
              {voicePillLabel}
            </button>
          </div>

          <div className="transcript-wrap">
            <div className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
              {messages.map((msg, i) => {
                const isLatest = i === messages.length - 1
                const emo = msg.role === 'npc' ? (EMOTION_META[msg.emotion] ?? EMOTION_META.neutral) : null
                return (
                  <div
                    key={i}
                    className={cn('msg', msg.role, isLatest && 'latest')}
                    style={emo ? { '--msg-emotion': emo.color, '--msg-emotion-glow': emo.glow } : undefined}
                  >
                    <div className="msg-label">
                      <span className="bullet">●</span>{msg.role === 'npc' ? (npcRole || 'Character') : 'You'}
                      {emo && <emo.Icon size={11} strokeWidth={2} className="emo-icon" style={{ color: emo.color }} />}
                    </div>
                    <div className="msg-body">{msg.message}</div>
                  </div>
                )
              })}

              {isLoading && !npcSpeaking && (
                <div className="typing">
                  <div className="msg-label"><span className="bullet">●</span>{npcRole || 'Character'}</div>
                  <div className="typing-dots"><span /><span /><span /></div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <div className={cn('scroll-pill', showScrollPill && 'show')} onClick={scrollToBottom}>
              ↓ New message
            </div>
          </div>

          <div className="visualizer">
            <div className="state-block state-speaking">
              <div className="wave"><span /><span /><span /><span /><span /><span /><span /></div>
              <div className="state-text"><div className="state-title">{npcRole || 'Character'} is speaking…</div></div>
            </div>

            <div className="state-block state-listening">
              <div className="listen-orb"><div className="ring" /><div className="ring r2" /><div className="dot" /></div>
              <div className="state-text">
                <div className="state-title">Listening…</div>
                <div className="state-sub">Go ahead and speak</div>
              </div>
            </div>

            <div className="state-block state-processing">
              <div className="spinner-arc" />
              <div className="state-text"><div className="state-title muted">Processing…</div></div>
            </div>

            {voiceState === 'manual' && (
              <div className="manual-bar">
                <textarea
                  rows={1}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendWithText(userInput)
                    }
                  }}
                  disabled={isLoading || sessionComplete}
                  placeholder="Can't use voice right now? Type your reply instead…"
                  className="manual-input"
                />
                <button
                  type="button"
                  onClick={() => handleSendWithText(userInput)}
                  disabled={!userInput.trim() || isLoading || sessionComplete}
                  className="manual-send"
                  aria-label="Send"
                >
                  {isLoading ? <Loader2 size={16} strokeWidth={1.8} className="spin" /> : <Send size={16} strokeWidth={1.8} />}
                </button>
              </div>
            )}
          </div>
            </div>
          </div>

          <div className="overlay">
            <div className={cn('result-card', cardVariant)}>
              <span className="result-icon">{endReasonMeta?.icon ?? '👋'}</span>
              <div className="result-title">{endReasonMeta?.title ?? 'Session Complete'}</div>
              <div className="result-sub">{endReasonMeta?.sub ?? ''}</div>
              <button type="button" className="view-feedback" onClick={handleViewFeedbackNow}>
                View Feedback
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Phase 1 dev-only: manual trigger to verify avatar speech + lip sync.
          Remove once Phase 1 is confirmed. */}
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={() => headRef.current?.speakText(
            'Hello. I am your manager. Please take a seat. We need to discuss your recent work.'
          )}
          className="dev-test-speech-btn"
        >
          Test Avatar Speech
        </button>
      )}

      <style>{`
        .rpe-vs{
          --bg:            #0D1117;
          --surface:       #161B22;
          --surface-hi:    #21262D;
          --border:        #30363D;
          --border-soft:   #21262D;
          --primary:       #4493F8;
          --primary-glow:  rgba(68,147,248,0.15);
          --primary-glow-strong: rgba(68,147,248,0.35);
          --accent:        #7C3AED;
          --accent-glow:   rgba(124,58,237,0.15);
          --success:       #3FB950;
          --success-glow:  rgba(63,185,80,0.18);
          --danger:        #F85149;
          --danger-glow:   rgba(248,81,73,0.18);
          --text-hi:       #F0F6FC;
          --text-med:      #8B949E;
          --text-low:      #484F58;
          --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
          --ease: cubic-bezier(0.22, 1, 0.36, 1);

          background:var(--bg);
          color:var(--text-hi);
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          -webkit-font-smoothing:antialiased;
          overflow:hidden;
        }
        @media (prefers-reduced-motion: reduce){
          .rpe-vs *, .rpe-vs *::before, .rpe-vs *::after{ animation-duration:0.001ms !important; animation-iteration-count:1 !important; transition-duration:0.001ms !important; }
        }
        .rpe-vs button{ font-family:inherit; }

        .rpe-vs .shell{ display:grid; grid-template-columns:320px 1fr; height:100%; width:100%; }
        @media (max-width:980px){ .rpe-vs .shell{ grid-template-columns:260px 1fr; } }
        @media (max-width:720px){ .rpe-vs .shell{ grid-template-columns:1fr; } .rpe-vs .rail{ display:none; } }

        .rpe-vs .rail{
          display:flex; flex-direction:column; height:100%;
          border-right:1px solid var(--border);
          background: radial-gradient(120% 60% at 0% 0%, rgba(124,58,237,0.06) 0%, transparent 55%), var(--surface);
          padding:28px 22px 20px;
          opacity:0; transform:translateX(-16px);
          animation: rpevsRailIn .5s var(--ease) forwards;
        }
        @keyframes rpevsRailIn{ to{ opacity:1; transform:translateX(0); } }

        .rpe-vs .npc-card{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:14px; }

        .rpe-vs .avatar-wrap{ position:relative; width:104px; height:104px; flex-shrink:0; }
        .rpe-vs .avatar-wrap::before{
          content:""; position:absolute; inset:0; border-radius:50%;
          background: conic-gradient(from 0deg, var(--primary), var(--accent), var(--primary));
          opacity:0.45; filter:saturate(0.85);
          animation: rpevsRingSpin 3.2s linear infinite; animation-play-state:paused;
          transition: opacity .35s var(--ease), filter .35s var(--ease);
        }
        .rpe-vs .avatar-wrap.speaking::before{
          opacity:1; filter:saturate(1.15) drop-shadow(0 0 14px var(--primary-glow-strong));
          animation-play-state:running;
        }
        @keyframes rpevsRingSpin{ to{ transform:rotate(360deg); } }
        .rpe-vs .avatar-inner{
          position:absolute; inset:4px; border-radius:50%;
          background:linear-gradient(160deg, var(--surface-hi), var(--surface));
          border:1px solid var(--border);
          display:flex; align-items:center; justify-content:center; font-size:44px;
        }
        .rpe-vs .avatar-pulse{ position:absolute; inset:-8px; border-radius:50%; opacity:0; }
        .rpe-vs .avatar-wrap.speaking .avatar-pulse{ animation: rpevsAvatarPulse 1.8s var(--ease) infinite; }
        @keyframes rpevsAvatarPulse{
          0%{ box-shadow:0 0 0 0 var(--primary-glow-strong); opacity:.9; }
          70%{ box-shadow:0 0 0 16px rgba(68,147,248,0); opacity:0; }
          100%{ opacity:0; }
        }

        .rpe-vs .npc-name{ font-size:15px; font-weight:650; color:var(--text-hi); letter-spacing:-0.01em; text-transform:capitalize; }
        .rpe-vs .npc-role{ font-size:11.5px; color:var(--text-med); margin-top:2px; text-transform:capitalize; }

        .rpe-vs .scenario-pill{
          font-size:11px; font-weight:600; color:var(--primary);
          background:var(--primary-glow); border:1px solid rgba(68,147,248,0.35);
          padding:5px 12px; border-radius:100px; max-width:100%;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        }

        .rpe-vs .rail-divider{ height:1px; background:var(--border); margin:22px 0; flex-shrink:0; }
        .rpe-vs .rail-label{ font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--text-low); margin-bottom:10px; }

        .rpe-vs .turn-count{
          font-size:32px; font-weight:750; letter-spacing:-0.02em; color:var(--text-hi);
          font-variant-numeric:tabular-nums; display:inline-block;
          animation: rpevsTurnPop .45s var(--ease);
        }
        @keyframes rpevsTurnPop{ 0%{ transform:scale(0.85); opacity:0; } 60%{ transform:scale(1.06); } 100%{ transform:scale(1); opacity:1; } }
        .rpe-vs .turn-max{ font-size:13px; color:var(--text-med); margin-left:6px; }

        .rpe-vs .progress-track{ height:4px; border-radius:100px; background:var(--surface-hi); border:1px solid var(--border-soft); margin-top:12px; overflow:hidden; }
        .rpe-vs .progress-fill{
          height:100%; border-radius:100px;
          background:linear-gradient(90deg, var(--primary), #6BB2FF);
          box-shadow:0 0 8px var(--primary-glow-strong);
          transition:width .5s var(--ease);
        }

        .rpe-vs .duration{
          margin-top:16px; font-family:var(--font-mono); font-size:13px; color:var(--text-med);
          display:flex; align-items:center; gap:8px; font-variant-numeric:tabular-nums;
        }
        .rpe-vs .duration::before{ content:"●"; color:var(--success); font-size:8px; animation:rpevsDotBeat 2s ease-in-out infinite; }
        @keyframes rpevsDotBeat{ 0%,100%{ opacity:1; } 50%{ opacity:.35; } }

        .rpe-vs .rail-spacer{ flex:1; }

        .rpe-vs .end-btn{
          width:100%; background:transparent; color:var(--text-med);
          border:1px solid var(--border); border-radius:10px; padding:12px 14px;
          font-size:13px; font-weight:600; cursor:pointer;
          transition:border-color .2s var(--ease), color .2s var(--ease), background .2s var(--ease);
        }
        .rpe-vs .end-btn:hover:not(:disabled){ border-color:var(--danger); color:#FF7B72; background:var(--danger-glow); }
        .rpe-vs .end-btn:disabled{ opacity:.4; cursor:default; }
        .rpe-vs .end-btn:focus-visible{ outline:2px solid var(--danger); outline-offset:2px; }

        .rpe-vs .main{ display:flex; flex-direction:column; height:100%; min-width:0; position:relative; }

        .rpe-vs .main-split{ display:flex; flex-direction:column; flex:1; min-height:0; }
        @media (min-width:768px){ .rpe-vs .main-split{ flex-direction:row; } }

        .rpe-vs .character-panel{
          width:100%; height:200px; flex-shrink:0;
          background:var(--surface); border-radius:14px; overflow:hidden;
          margin:16px 16px 0;
        }
        @media (min-width:768px){
          .rpe-vs .character-panel{ width:42%; height:auto; margin:0; border-radius:0; border-right:1px solid var(--border); }
        }
        .rpe-vs .character-avatar{ width:100%; height:100%; }

        .rpe-vs .conversation-panel{
          width:100%; flex:1; min-height:0; min-width:0;
          display:flex; flex-direction:column; overflow:hidden;
        }
        @media (min-width:768px){ .rpe-vs .conversation-panel{ width:58%; } }

        .dev-test-speech-btn{
          position:fixed; bottom:16px; right:16px; z-index:50;
          background:#4493F8; color:#fff; border:none; border-radius:10px;
          padding:10px 16px; font-size:13px; font-weight:650; cursor:pointer;
          box-shadow:0 8px 24px rgba(0,0,0,0.4);
          font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        }
        .dev-test-speech-btn:hover{ filter:brightness(1.08); }

        .rpe-vs .topbar{
          height:48px; flex-shrink:0; display:flex; align-items:center; gap:14px;
          padding:0 24px; border-bottom:1px solid var(--border); background:var(--bg);
        }
        .rpe-vs .back-btn{
          background:none; border:none; color:var(--text-med); cursor:pointer;
          width:28px; height:28px; border-radius:7px; display:flex; align-items:center; justify-content:center;
          transition:background .2s var(--ease), color .2s var(--ease); flex-shrink:0;
        }
        .rpe-vs .back-btn:hover{ background:var(--surface-hi); color:var(--text-hi); }
        .rpe-vs .topbar-title{ font-size:12.5px; color:var(--text-med); flex:1; text-align:center; letter-spacing:.01em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        .rpe-vs .voice-pill{
          font-size:11px; font-weight:650; letter-spacing:.03em; color:var(--success);
          background:var(--success-glow); border:1px solid rgba(63,185,80,0.3);
          padding:5px 11px 5px 9px; border-radius:100px; display:flex; align-items:center; gap:7px; flex-shrink:0;
          cursor:pointer; transition:filter .2s var(--ease), background .2s var(--ease), color .2s var(--ease), border-color .2s var(--ease);
        }
        .rpe-vs .voice-pill:hover:not(:disabled){ filter:brightness(1.15); }
        .rpe-vs .voice-pill:disabled{ cursor:default; opacity:.55; }
        .rpe-vs .voice-pill.muted{ color:var(--text-med); background:var(--surface-hi); border-color:var(--border); }

        .rpe-vs .transcript-wrap{ position:relative; flex:1; min-height:0; }
        .rpe-vs .transcript{
          height:100%; overflow-y:auto; padding:44px clamp(24px, 6vw, 96px) 28px;
          overscroll-behavior:contain; -webkit-overflow-scrolling:touch;
        }
        .rpe-vs .transcript::-webkit-scrollbar{ width:8px; }
        .rpe-vs .transcript::-webkit-scrollbar-thumb{ background:var(--surface-hi); border-radius:100px; }
        .rpe-vs .transcript::-webkit-scrollbar-track{ background:transparent; }

        .rpe-vs .msg{ max-width:640px; margin:0 0 32px; opacity:0; animation: rpevsMsgInLeft .45s var(--ease) forwards; }
        .rpe-vs .msg:last-child{ margin-bottom:8px; }
        .rpe-vs .msg.user{ animation-name: rpevsMsgInRight; margin-left:auto; text-align:right; }
        @keyframes rpevsMsgInLeft{ from{ opacity:0; transform:translateX(-14px) translateY(6px); } to{ opacity:1; transform:none; } }
        @keyframes rpevsMsgInRight{ from{ opacity:0; transform:translateX(14px) translateY(6px); } to{ opacity:1; transform:none; } }

        .rpe-vs .msg-label{ font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; display:flex; align-items:center; gap:7px; margin-bottom:8px; }
        .rpe-vs .msg.npc .msg-label{ color:var(--msg-emotion, var(--accent)); }
        .rpe-vs .msg.user .msg-label{ color:var(--primary); justify-content:flex-end; }
        .rpe-vs .msg-label .bullet{ font-size:8px; }
        .rpe-vs .msg-label .emo-icon{ flex-shrink:0; }

        .rpe-vs .msg-body{ font-size:18px; line-height:1.7; letter-spacing:-0.003em; padding:2px 0 2px 16px; border-left:2px solid transparent; }
        .rpe-vs .msg.npc .msg-body{ color:#C9D1D9; border-left-color:var(--msg-emotion, var(--accent-glow)); transition:border-color .3s var(--ease); }
        .rpe-vs .msg.user .msg-body{ color:var(--text-hi); border-left:none; border-right:2px solid var(--primary-glow); padding-left:0; padding-right:16px; }

        .rpe-vs .msg.latest .msg-body{ position:relative; border-radius:10px; padding:12px 16px; }
        .rpe-vs .msg.latest.npc .msg-body{ background:linear-gradient(90deg, var(--msg-emotion-glow, rgba(68,147,248,0.055)), transparent 70%); border-left-color:var(--msg-emotion, rgba(124,58,237,0.5)); }
        .rpe-vs .msg.latest.user .msg-body{ background:linear-gradient(270deg, rgba(68,147,248,0.06), transparent 70%); border-right-color:rgba(68,147,248,0.5); padding-left:16px; }

        .rpe-vs .typing{ max-width:640px; margin-bottom:32px; animation: rpevsMsgInLeft .4s var(--ease) forwards; }
        .rpe-vs .typing-dots{ display:inline-flex; gap:5px; padding-left:16px; border-left:2px solid var(--accent-glow); height:24px; align-items:center; }
        .rpe-vs .typing-dots span{ width:6px; height:6px; border-radius:50%; background:var(--accent); animation: rpevsTypingBounce 1.1s ease-in-out infinite; }
        .rpe-vs .typing-dots span:nth-child(2){ animation-delay:.15s; }
        .rpe-vs .typing-dots span:nth-child(3){ animation-delay:.3s; }
        @keyframes rpevsTypingBounce{ 0%,60%,100%{ transform:translateY(0); opacity:.4; } 30%{ transform:translateY(-5px); opacity:1; } }

        .rpe-vs .scroll-pill{
          position:absolute; bottom:18px; left:50%; transform:translateX(-50%) translateY(10px);
          background:var(--surface-hi); border:1px solid var(--border); color:var(--text-hi);
          font-size:12px; font-weight:600; padding:8px 16px; border-radius:100px;
          display:flex; align-items:center; gap:6px; cursor:pointer;
          box-shadow:0 8px 24px rgba(0,0,0,0.4); opacity:0; pointer-events:none;
          transition:opacity .25s var(--ease), transform .25s var(--ease);
        }
        .rpe-vs .scroll-pill.show{ opacity:1; transform:translateX(-50%) translateY(0); pointer-events:auto; }
        .rpe-vs .scroll-pill:hover{ border-color:var(--primary); }

        .rpe-vs .visualizer{
          min-height:76px; flex-shrink:0; border-top:1px solid var(--border); background:var(--surface);
          display:flex; align-items:center; justify-content:center; position:relative; padding:12px 20px;
        }

        .rpe-vs .state-block{ display:none; align-items:center; gap:14px; }
        .rpe-vs[data-voice-state="speaking"] .state-speaking{ display:flex; }
        .rpe-vs[data-voice-state="listening"] .state-listening{ display:flex; }
        .rpe-vs[data-voice-state="processing"] .state-processing{ display:flex; }

        .rpe-vs .wave{ display:flex; align-items:center; gap:3px; height:30px; }
        .rpe-vs .wave span{ width:3.5px; border-radius:3px; background:linear-gradient(180deg, #6BB2FF, var(--primary)); animation: rpevsWaveMove 1s ease-in-out infinite; display:block; }
        .rpe-vs .wave span:nth-child(1){ height:10px; animation-delay:-0.9s; }
        .rpe-vs .wave span:nth-child(2){ height:20px; animation-delay:-0.6s; }
        .rpe-vs .wave span:nth-child(3){ height:28px; animation-delay:-0.3s; }
        .rpe-vs .wave span:nth-child(4){ height:14px; animation-delay:-1.1s; }
        .rpe-vs .wave span:nth-child(5){ height:24px; animation-delay:-0.15s; }
        .rpe-vs .wave span:nth-child(6){ height:17px; animation-delay:-0.75s; }
        .rpe-vs .wave span:nth-child(7){ height:9px; animation-delay:-0.45s; }
        @keyframes rpevsWaveMove{ 0%,100%{ transform:scaleY(0.4); } 50%{ transform:scaleY(1); } }

        .rpe-vs .state-text{ display:flex; flex-direction:column; gap:1px; }
        .rpe-vs .state-title{ font-size:13.5px; font-weight:650; color:var(--text-hi); }
        .rpe-vs .state-title.muted{ color:var(--text-med); }
        .rpe-vs .state-sub{ font-size:11.5px; color:var(--text-med); }

        .rpe-vs .listen-orb{ position:relative; width:30px; height:30px; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
        .rpe-vs .listen-orb .ring{ position:absolute; inset:0; border-radius:50%; background:var(--primary-glow); animation:rpevsOrbPulse 1.8s ease-out infinite; }
        .rpe-vs .listen-orb .ring.r2{ animation-delay:.6s; background:rgba(68,147,248,0.28); }
        .rpe-vs .listen-orb .dot{ width:10px; height:10px; border-radius:50%; background:var(--primary); box-shadow:0 0 10px var(--primary-glow-strong); z-index:1; }
        @keyframes rpevsOrbPulse{ 0%{ transform:scale(0.4); opacity:.9; } 100%{ transform:scale(2.2); opacity:0; } }

        .rpe-vs .spinner-arc{ width:22px; height:22px; border-radius:50%; border:2.5px solid var(--border); border-top-color:var(--primary); animation:rpevsSpin .75s linear infinite; }
        @keyframes rpevsSpin{ to{ transform:rotate(360deg); } }
        .rpe-vs .spin{ animation:rpevsSpin .75s linear infinite; }

        .rpe-vs .manual-bar{ display:flex; gap:8px; width:100%; max-width:640px; align-items:flex-end; }
        .rpe-vs .manual-input{
          flex:1; resize:none; background:var(--surface-hi); border:1px solid var(--border);
          border-radius:10px; padding:10px 12px; color:var(--text-hi); font-size:13px; line-height:1.5;
          font-family:inherit; min-height:38px; max-height:80px;
        }
        .rpe-vs .manual-input::placeholder{ color:var(--text-low); }
        .rpe-vs .manual-input:focus{ outline:none; border-color:var(--primary); }
        .rpe-vs .manual-send{
          width:38px; height:38px; flex-shrink:0; border:none; border-radius:10px; cursor:pointer;
          background:linear-gradient(135deg, var(--primary), #6BB2FF); color:#fff;
          display:flex; align-items:center; justify-content:center;
          transition:filter .2s var(--ease);
        }
        .rpe-vs .manual-send:hover:not(:disabled){ filter:brightness(1.08); }
        .rpe-vs .manual-send:disabled{ opacity:.4; cursor:default; }

        .rpe-vs .overlay{
          position:absolute; inset:0; display:none; align-items:flex-end; justify-content:center;
          background:rgba(6,8,12,0.72); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:20;
        }
        .rpe-vs[data-voice-state="complete"] .overlay{ display:flex; }

        .rpe-vs .result-card{
          width:min(420px, 88%); margin-bottom:9%; background:var(--surface-hi); border:1px solid var(--border);
          border-radius:18px; padding:32px 28px 26px; text-align:center;
          transform:translateY(28px); opacity:0; animation: rpevsCardUp .45s var(--ease) forwards;
          box-shadow:0 24px 60px rgba(0,0,0,0.5);
        }
        @keyframes rpevsCardUp{ to{ transform:translateY(0); opacity:1; } }
        .rpe-vs .result-icon{ font-size:34px; margin-bottom:14px; display:block; }
        .rpe-vs .result-title{ font-size:19px; font-weight:700; color:var(--text-hi); margin-bottom:6px; }
        .rpe-vs .result-sub{ font-size:13px; color:var(--text-med); margin-bottom:22px; }
        .rpe-vs .view-feedback{
          border:none; cursor:pointer; font-size:13.5px; font-weight:650; color:#fff;
          background:linear-gradient(135deg, var(--primary), #6BB2FF); padding:11px 22px; border-radius:10px;
          box-shadow:0 8px 26px var(--primary-glow-strong); transition:filter .2s var(--ease), transform .2s var(--ease);
        }
        .rpe-vs .view-feedback:hover{ filter:brightness(1.08); transform:translateY(-1px); }

        .rpe-vs .result-card.success{ border-color:rgba(63,185,80,0.3); box-shadow:0 24px 60px rgba(63,185,80,0.12); }
        .rpe-vs .result-card.failure{ border-color:rgba(248,81,73,0.3); box-shadow:0 24px 60px rgba(248,81,73,0.12); }
        .rpe-vs .result-card.natural{ border-color:rgba(68,147,248,0.3); box-shadow:0 24px 60px rgba(68,147,248,0.12); }
      `}</style>
    </div>
  )
}
