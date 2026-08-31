import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Joyride, STATUS } from 'react-joyride'
import { ArrowLeft, Send, Loader2, Smile, Meh, AlertCircle, AlertTriangle, Frown, HelpCircle, Angry, Brain, Mic, MicOff, MessageCircle, X, Paperclip, Video, VideoOff, Activity } from 'lucide-react'
import Webcam from 'react-webcam'
import { rpeService } from '@/services/rpe/rpeService'
import { analyticsService } from '@/services/analytics/analyticsService'
import { integrateCompletedSession } from '@/pages/Analytics/analyticsIntegrationUtils'
import { useAuth } from '@/lib/auth/context'
import { cn } from '@/lib/utils'
import TalkingHeadAvatar from '@/components/RPE/TalkingHeadAvatar'
import SessionLoadingScreen from '@/components/RPE/SessionLoadingScreen'
import ResponseChoiceCards from '@/components/RPE/ResponseChoiceCards'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { useNudgeSensing } from '@/hooks/useNudgeSensing'
import { getAvatarOption, pickNpcAvatar, pickNpcProfileImage } from '@/lib/rpe/npcAvatars'
import { joyrideOptions, joyrideStyles } from '@/lib/tour/joyrideTheme'

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

// RPE's 8 emotions -> TalkingHead's real mood vocabulary (verified against
// node_modules/@met4citizen/talkinghead — its animMoods are only neutral |
// happy | angry | sad | fear | disgust | love | sleep). Four map exactly;
// the rest are the closest visual match TalkingHead actually has.
const EMOTION_TO_MOOD = {
  neutral:    'neutral',
  happy:      'happy',
  angry:      'angry',
  sad:        'sad',
  surprised:  'fear',      // wide-eyed, alert — closest available to surprise
  frustrated: 'angry',     // milder anger; no dedicated "frustrated" mood exists
  skeptical:  'disgust',   // closest visual to a doubtful/skeptical expression
  thinking:   'neutral',   // no "thinking" mood — conveyed via gesture instead
}

// RPE's animation labels -> TalkingHead's real playGesture() names (verified
// against gestureTemplates in the same library file). 'idle' plays nothing.
const ANIMATION_TO_GESTURE = {
  thumbsUp:      'thumbup',
  thumbsDown:    'thumbdown',
  shrug:         'shrug',
  openHandPause: 'handup',
  pointing:      'index',
  handsClasped:  'namaste',
  wave:          '👋',
}

// First-time-only walkthrough of the live session screen — separate from
// ScenarioSelect's own tour since these targets (meters, mic, nudges) don't
// exist until a session is actually running.
const SESSION_TOUR_SEEN_KEY = 'rpe_tour_session_seen'

const sessionTourSteps = [
  {
    target: '[data-tour="rpe-session-npc"]',
    title: "Who you're talking to",
    content: "This is the character for this scenario — their name, role, and difficulty. Speak to them like a real coworker.",
    disableBeacon: true,
    placement: 'right',
  },
  {
    target: '[data-tour="rpe-session-meters"]',
    title: 'Trust, Tension & Clarity',
    content: 'Trust rises when you sound calm and constructive, drops when things get heated. Tension is how escalated things are — if it maxes out, the NPC walks away. Clarity scores how well-formed your responses are. These are coaching signals to guide you, not a strict grade.',
    placement: 'right',
  },
  {
    target: '[data-tour="rpe-session-voice"]',
    title: 'Talk or type',
    content: "Tap the mic to talk — your words fill in live as you speak. Tap it again to stop, review or edit what it heard, then hit Send. Or just type instead, any time.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="rpe-session-sensing"]',
    title: 'Live coaching nudges',
    content: "Turn on your camera for gentle real-time nudges about your tone and body language while you talk — fully optional.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="rpe-session-chat"]',
    title: 'Full transcript',
    content: 'Everything said so far, any time you want to scroll back through it.',
    placement: 'left',
  },
  {
    target: '[data-tour="rpe-session-end"]',
    title: 'Ending things',
    content: "End whenever you want — you'll still get feedback on how it went so far.",
    placement: 'right',
  },
]

const END_REASON_COPY = {
  natural_resolution: { icon: '✅', title: 'Conversation Resolved',    sub: 'You reached a natural, positive conclusion.' },
  user_exit_intent:   { icon: '👋', title: 'Session Ended',            sub: 'You chose to end the conversation.' },
  npc_exit:           { icon: '💢', title: 'Session Ended',            sub: 'The session ended because of repeated inappropriate language.' },
  trust_sustained:    { icon: '🎉', title: 'Trust Built',              sub: 'You built enough trust to resolve the situation.' },
  max_turns_reached:  { icon: '⏱', title: 'Maximum Turns Reached',    sub: 'Session ended at the turn limit.' },
}

const formatDuration = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// The actual session screen — always mounted with a complete navState,
// whether that came straight from ScenarioSelect's navigate() (fresh start)
// or was reconstructed by the RolePlaySession wrapper below (a refresh or a
// direct link to an in-progress session's URL). Keeping that reconstruction
// entirely in the wrapper means every hook and lazy useState initializer
// here — several of which (npcAvatar, npcProfileImage, recommendedTurns)
// deliberately resolve once at mount and never again — always sees final
// data on the very first render, fresh start or recovered.
function RolePlaySessionInner({ navState, recoveredTurns, recoveredTrustHistory }) {
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuth()
  const {
    sessionId, openingNpcLine, scenarioTitle, difficulty,
    totalTurns, npcRole, npcGender, npcName, avatarId, failureEscalationThreshold,
    recommendedTurns: recommendedTurnsFromState,
    maxTurns:         maxTurnsFromState,
  } = navState || {}

  // The learner may have picked a specific avatar (+ name) from the
  // scenario's "view details" screen — avatarId carries that choice through
  // navigation state. No override means "never opened that screen", so fall
  // back to a random pick within the matching gender, same as before this
  // existed. Picked/resolved once per session mount, not re-rolled on
  // every render.
  const chosenAvatarOption = avatarId ? getAvatarOption(avatarId) : null
  const [npcProfileImage] = useState(() => chosenAvatarOption?.photo ?? pickNpcProfileImage(npcGender))
  const [npcAvatar] = useState(() => chosenAvatarOption ?? pickNpcAvatar(npcGender, npcRole, scenarioTitle))
  // npcName is the backend's *effective* name (custom or scenario.npc_role,
  // already resolved server-side) — always display-ready, no local fallback
  // logic needed here beyond the pre-existing-session-state edge case.
  const npcDisplayName = npcName || npcRole || 'NPC'

  const bottomRef            = useRef(null)
  const transcriptRef        = useRef(null)
  const replyInputRef        = useRef(null)
  const isNearBottomRef      = useRef(true)
  const completeTimeoutRef   = useRef(null)
  const completeNavStateRef  = useRef(null)
  const headRef              = useRef(null)
  const sensingAutoStartedRef = useRef(false)
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
  const [npcSpeaking, setNpcSpeaking]       = useState(false)
  // Set when the NPC's last line asked the user to hand over something
  // concrete — replaces the mic/manual-input with tappable reply cards for
  // that one turn (see ResponseChoiceCards.jsx).
  const [choiceOptions, setChoiceOptions]   = useState(null)
  // Live conversation indicators — trust/escalation are already returned on
  // every turn, clarity is a cheap local heuristic computed inline on the
  // backend now too (see session_respond in router.py). Shown in the sidebar
  // so the user can see the NPC visibly reacting turn by turn, not just at
  // the end.
  const [liveTrust, setLiveTrust]     = useState(50)
  const [liveTension, setLiveTension] = useState(0)
  const [liveClarity, setLiveClarity] = useState(null)

  // Avatar loads in the background from mount; the loading screen just
  // covers that wait with tips instead of a bare spinner in a corner panel.
  const [avatarReady, setAvatarReady] = useState(false)
  // Transcript is hidden by default (that's the whole point — the avatar is
  // the conversation, not a scrolling log next to it) and opens as a
  // floating panel, chat-widget style.
  const [chatOpen, setChatOpen]   = useState(false)
  const [hasUnread, setHasUnread] = useState(false)

  const [recommendedTurns, setRecommendedTurns] = useState(
    recommendedTurnsFromState || totalTurns || 6
  )
  const [maxTurns, setMaxTurns] = useState(maxTurnsFromState || null)
  const [runTour, setRunTour] = useState(false)

  // First session ever in this browser gets a short walkthrough of the
  // meters/mic/nudges — a brief delay lets the rail finish its initial paint
  // before Joyride measures target positions.
  useEffect(() => {
    try {
      if (localStorage.getItem(SESSION_TOUR_SEEN_KEY) === 'true') return
    } catch {
      return
    }
    const id = setTimeout(() => setRunTour(true), 600)
    return () => clearTimeout(id)
  }, [])

  const handleTourCallback = (data) => {
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(data.status)) {
      setRunTour(false)
      try { localStorage.setItem(SESSION_TOUR_SEEN_KEY, 'true') } catch { /* ignore */ }
    }
  }

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

  // Flag the floating chat button when an NPC line arrives while the
  // transcript panel is closed, so hiding it by default doesn't mean losing
  // track of what was said.
  const chatOpenRef = useRef(chatOpen)
  useEffect(() => { chatOpenRef.current = chatOpen }, [chatOpen])
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'npc' && !chatOpenRef.current) setHasUnread(true)
  }, [messages])

  const handleToggleChat = useCallback(() => {
    setChatOpen((v) => {
      const next = !v
      if (next) setHasUnread(false)
      return next
    })
  }, [])

  const handleTranscriptScroll = () => {
    const el = transcriptRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    isNearBottomRef.current = nearBottom
    setShowScrollPill(!nearBottom)
  }

  const speak = useCallback((text, { emotion, animation } = {}) => {
    return new Promise((resolve) => {
      if (!text) { resolve(); return }

      const head = headRef.current
      if (head) {
        // Mood + gesture react to what the NPC is feeling this turn, set
        // just before the line plays so the avatar's face/pose has already
        // shifted by the time speech starts. Both are safe no-ops when
        // emotion/animation aren't provided (e.g. the static opening line).
        if (emotion) {
          head.setMood(EMOTION_TO_MOOD[emotion] ?? 'neutral')
        }
        if (animation && animation !== 'idle') {
          const gesture = ANIMATION_TO_GESTURE[animation]
          if (gesture) head.playGesture(gesture)
        }

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
    speak(openingNpcLine)
  }, [speak, openingNpcLine])

  const handleSendWithText = useCallback(async (rawInput, deliverableLabel) => {
    const input = (rawInput ?? '').trim()
    if (!input || isLoading || sessionComplete) return

    setMessages(prev => [...prev, { role: 'user', message: input, deliverableLabel }])
    setUserInput('')
    setIsLoading(true)

    try {
      const response = await rpeService.sendTurn(sessionId, input)
      setCurrentTurn(response.turn)
      setLiveTrust(response.trust_score)
      setLiveTension(response.escalation_level)
      if (response.clarity_score != null) setLiveClarity(response.clarity_score)
      if (import.meta.env.DEV) {
        console.log('[RPE] turn', response.turn, '| emotion:', response.emotion, '| animation:', response.animation)
      }

      setMessages(prev => [
        ...prev,
        { role: 'npc', message: response.npc_response, emotion: response.emotion },
      ])

      if (response.session_complete) {
        // Hand the finished session to the analytics module straight away, so
        // scores, XP and the adapted training plan are ready without the learner
        // having to open an analytics page first. Fire-and-forget by design: it
        // never throws and must not delay the completion overlay.
        integrateCompletedSession(analyticsService, sessionId)

        // Tell APA a session finished so it can update the learner's profile.
        // Same fire-and-forget contract as above — guests have no persistent
        // profile for APA to adjust, so this only fires when signed in.
        if (isAuthenticated && user?.id) {
          rpeService.notifySessionComplete(user.id, sessionId).catch(() => {})
        }

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
          npcName: npcDisplayName,
          currentTurn:     response.turn,
        }

        // Let the avatar finish speaking the NPC's final line before
        // showing the "Session Complete" overlay — sessionComplete drives
        // data-voice-state="complete", which is what makes the overlay
        // visible, so setting it any earlier popped the notice up mid-speech.
        await speak(response.npc_response, { emotion: response.emotion, animation: response.animation })

        setSessionComplete(true)
        setOutcome(response.outcome)
        setEndReason(response.end_reason)

        completeTimeoutRef.current = setTimeout(() => {
          navigate('/roleplay/session/complete', { state: completeNavStateRef.current })
        }, 2000)
      } else {
        await speak(response.npc_response, { emotion: response.emotion, animation: response.animation })
        if (response.requests_deliverable && response.response_options?.length >= 2) {
          setChoiceOptions(response.response_options)
        }
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'npc', message: `[System error: ${err.message}]` },
      ])
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, sessionComplete, sessionId, speak, recommendedTurns, maxTurns, totalTurns, scenarioTitle, navigate, isAuthenticated, user])

  const handleChooseOption = useCallback((option) => {
    setChoiceOptions(null)
    handleSendWithText(option.text, option.label)
  }, [handleSendWithText])

  const handleViewFeedbackNow = () => {
    if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
    if (completeNavStateRef.current) {
      navigate('/roleplay/session/complete', { state: completeNavStateRef.current })
    }
  }

  // Reuses MCA's live behavioral-sensing pipeline (camera/face-mesh + a
  // continuous mic stream feeding the nudge-analysis socket) so the same
  // real-time coaching nudges can surface over a role-play conversation.
  // Auto-starts with the simulation; the learner can still turn it off via
  // the pill, and independently hide just the face-mesh overlay on the
  // camera preview via showMesh (the raw feed stays visible either way —
  // see useNudgeSensing's onResults).
  const [showMesh, setShowMesh] = useState(true)
  const {
    webcamRef, canvasRef, nudges, isCameraActive,
    toggleCamera, toggleMic, dismissNudge,
  } = useNudgeSensing({ persistMicConnection: true, showMesh })

  const handleToggleSensing = useCallback(() => {
    toggleCamera()
    toggleMic()
  }, [toggleCamera, toggleMic])

  // Manual, click-to-talk voice input — ports /baseline's AIChatbot capture
  // mechanism directly (native SpeechRecognition, continuous + interim
  // results — see useVoiceRecorder's own comment for why that replaced the
  // backend-STT round trip this used before). Tap the mic, talk, watch the
  // reply bar fill in live, tap again to stop, then review and hit Send
  // yourself. Nothing here auto-starts or auto-sends — the old
  // auto-restart-after-every-NPC-line loop misfired more than it helped.
  const {
    isListening, isTranscribing, startListening: toggleVoiceInput, stopListening: stopVoiceInput,
    liveTranscript, lowConfidence, canRecord: micAvailable, usesLiveCaptions,
  } = useVoiceRecorder()

  // Syncs the reply bar to whatever the mic has captured so far. On browsers
  // with native live captions this fires continuously while isListening is
  // true; on the MediaRecorder/backend-STT fallback (no native
  // SpeechRecognition) it only fires once, after stopping, once the
  // transcription round trip resolves — isListening is already false by
  // then, so this can't gate on it the way an earlier version did.
  useEffect(() => {
    setUserInput(liveTranscript)
  }, [liveTranscript])

  // Textareas don't grow with wrapped content on their own — rows={1} fixes
  // the box at one line's height regardless of how much text is actually in
  // it, so a longer reply (typed or spoken) just overflowed past the pill's
  // rounded edge instead of the box growing to fit. Re-measure on every
  // change (typing AND the live-fill effect above both land here) and let
  // CSS's max-height/overflow-y take over with an internal scrollbar past
  // that cap instead of growing forever.
  useEffect(() => {
    const el = replyInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [userInput])

  const handleToggleMic = useCallback(() => {
    if (isListening) {
      stopVoiceInput()
    } else {
      setUserInput('')
      toggleVoiceInput()
    }
  }, [isListening, stopVoiceInput, toggleVoiceInput])

  // Nudges should only ever surface during the user's own speaking turn —
  // the fusion analyzer keeps running continuously in the background
  // regardless (coaching stays on across the whole session), but a nudge
  // timed to a moment the NPC was talking (or a lull between turns) isn't
  // useful feedback, it's just noise. Drop any nudge the instant it arrives
  // outside that window; one already shown during a real speaking turn
  // keeps its normal lifecycle even if isListening flips right after.
  const seenNudgeIdsRef = useRef(new Set())
  useEffect(() => {
    for (const nudge of nudges) {
      if (seenNudgeIdsRef.current.has(nudge.id)) continue
      seenNudgeIdsRef.current.add(nudge.id)
      if (!isListening) dismissNudge(nudge.id)
    }
  }, [nudges, isListening, dismissNudge])

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    // The avatar stage wants the full width — collapse the app sidebar the
    // moment a session actually starts (AppLayout owns the real state).
    window.dispatchEvent(new Event('ez:collapse-sidebar'))
    // Coaching (nudge-sensing mic) starts on automatically with the
    // simulation — the learner no longer has to remember to opt in each
    // session; they can still turn it off manually via the pill if they want.
    // Guarded by a ref (not just the [] deps below) because StrictMode's dev
    // double-invoke of this effect would otherwise call the relative
    // toggleMic twice in the same tick and cancel itself out.
    if (!sensingAutoStartedRef.current) {
      sensingAutoStartedRef.current = true
      handleToggleSensing()
    }

    if (recoveredTurns?.length) {
      // Resuming after a refresh/reconnect — rebuild the transcript and live
      // meters from what the backend already has instead of starting over.
      const rebuilt = [{ role: 'npc', message: openingNpcLine }]
      for (const t of recoveredTurns) {
        rebuilt.push({ role: 'user', message: t.user_input })
        rebuilt.push({ role: 'npc', message: t.npc_response, emotion: t.emotion })
      }
      setMessages(rebuilt)
      setCurrentTurn(recoveredTurns.length)
      setLiveTension(recoveredTurns[recoveredTurns.length - 1].escalation_level ?? 0)
      if (recoveredTrustHistory?.length) {
        setLiveTrust(recoveredTrustHistory[recoveredTrustHistory.length - 1])
      }
      // The opening line already played the first time this session was
      // live; don't replay it just because the page reloaded.
      openingSpokenRef.current = true
    } else {
      setMessages([{ role: 'npc', message: openingNpcLine }])
    }

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
      stopVoiceInput()
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

  // 'manual' covers the whole "it's the learner's turn" phase, typing or
  // talking alike — isListening (see the mic-toggle bar below) is just an
  // internal visual state within it now, not a separate top-level phase; the
  // old auto-mic loop that made "listening" its own phase is gone.
  const voiceState = sessionComplete
    ? 'complete'
    : npcSpeaking
      ? 'speaking'
      : choiceOptions
        ? 'choice'
        : isLoading
          ? 'processing'
          : 'manual'

  return (
    <div className="rpe-vs" data-voice-state={voiceState} style={{ height: '100%' }}>

      <Joyride
        steps={sessionTourSteps}
        run={runTour}
        continuous
        showSkipButton
        showProgress
        callback={handleTourCallback}
        options={joyrideOptions}
        styles={joyrideStyles}
      />

      <div className="shell">
        {/* ── Identity rail ───────────────────────────────── */}
        <aside className="rail">
          <button type="button" className="back-btn" onClick={() => navigate('/roleplay')} aria-label="Back">
            <ArrowLeft size={16} strokeWidth={1.8} />
          </button>

          <div className="npc-card" data-tour="rpe-session-npc">
            <div className={cn('avatar-wrap', npcSpeaking && 'speaking')}>
              <div className="avatar-pulse" />
              <div className="avatar-inner">
                {npcProfileImage
                  ? <img src={npcProfileImage} alt="" className="avatar-photo" />
                  : '🧑‍💼'}
              </div>
            </div>
            <div>
              <div className="npc-name">{npcDisplayName}</div>
              {npcRole && npcDisplayName !== npcRole ? (
                <div className="npc-role">{npcRole}{difficulty ? ` · ${difficulty}` : ''}</div>
              ) : (
                difficulty && <div className="npc-role">{difficulty} scenario</div>
              )}
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

          <div className="live-meters" data-tour="rpe-session-meters">
            <div className="rail-label">How it's going</div>
            <div className="meter-row">
              <span className="meter-label">Trust</span>
              <div className="meter-track"><div className="meter-fill trust" style={{ width: `${liveTrust}%` }} /></div>
              <span className="meter-val">{liveTrust}</span>
            </div>
            <div className="meter-row">
              <span className="meter-label">Tension</span>
              <div className="meter-track"><div className="meter-fill tension" style={{ width: `${(liveTension / 5) * 100}%` }} /></div>
              <span className="meter-val">{liveTension}/5</span>
            </div>
            {failureEscalationThreshold != null && (
              <p className="meter-hint">NPC exits at {failureEscalationThreshold}/5 tension</p>
            )}
            {liveClarity != null && (
              <div className="meter-row">
                <span className="meter-label">Clarity</span>
                <div className="meter-track"><div className="meter-fill clarity" style={{ width: `${(liveClarity / 10) * 100}%` }} /></div>
                <span className="meter-val">{liveClarity}</span>
              </div>
            )}
          </div>

          <div className="rail-divider" />
          <div className="rail-spacer" />

          <button
            type="button"
            className="end-btn"
            onClick={() => handleSendWithText('exit')}
            disabled={isLoading || sessionComplete}
            data-tour="rpe-session-end"
          >
            End Session
          </button>
        </aside>

        {/* ── Main column ─────────────────────────────────── */}
        <main className="main">
          {/* Stage — the avatar fills the whole main area now. The topbar
              and voice controls float over it; the transcript no longer
              lives here at all, it's the floating panel below. */}
          <div className="stage">
            <TalkingHeadAvatar
              onReady={(head) => { headRef.current = head; setAvatarReady(true); speakOpeningLine() }}
              onError={() => { setAvatarReady(true); speakOpeningLine() }}
              className="character-avatar"
              avatarUrl={npcAvatar.url}
              avatarBody={npcAvatar.body}
              ttsVoice={npcAvatar.ttsVoice}
            />

            <div className="stage-topbar">
              <div className="topbar-title">{scenarioTitle}</div>
              <button
                type="button"
                className={cn('sensing-pill', !isCameraActive && 'muted')}
                onClick={handleToggleSensing}
                title={isCameraActive ? 'Turn off camera' : 'Turn on camera for live nudges'}
                data-tour="rpe-session-sensing"
              >
                {isCameraActive ? <Video size={12} strokeWidth={2} /> : <VideoOff size={12} strokeWidth={2} />}
                {isCameraActive ? 'Analyzing On' : 'Analyzing'}
              </button>
            </div>

            {isCameraActive && (
              <div className="camera-dock">
                <Webcam
                  audio={false}
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  className="hidden"
                  videoConstraints={{ facingMode: 'user', aspectRatio: 1.333333 }}
                />
                <canvas ref={canvasRef} className="camera-dock-canvas" />
                <button
                  type="button"
                  className={cn('mesh-toggle-btn', !showMesh && 'muted')}
                  onClick={() => setShowMesh((v) => !v)}
                  title={showMesh ? 'Hide face tracking overlay' : 'Show face tracking overlay'}
                  aria-label={showMesh ? 'Hide face mesh' : 'Show face mesh'}
                >
                  <Activity size={12} strokeWidth={2} />
                </button>
              </div>
            )}

            {nudges.length > 0 && (
              <div className="nudge-stack">
                {nudges.map((nudge, index) => (
                  <div
                    key={nudge.id}
                    className={cn('nudge-toast', nudge.severity, index > 0 && 'stacked')}
                  >
                    <div className="nudge-icon"><Activity size={15} strokeWidth={2} /></div>
                    <div className="nudge-body">
                      <p className="nudge-text">{nudge.text}</p>
                      <span className="nudge-time">{nudge.timestamp}</span>
                    </div>
                    <button
                      type="button"
                      className="nudge-dismiss"
                      onClick={() => dismissNudge(nudge.id)}
                      aria-label="Dismiss nudge"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="stage-bottom">
              <div className="state-block state-speaking">
                <div className="wave"><span /><span /><span /><span /><span /><span /><span /></div>
                <div className="state-text"><div className="state-title">{npcDisplayName} is speaking…</div></div>
              </div>

              <div className="state-block state-processing">
                <div className="spinner-arc" />
                <div className="state-text"><div className="state-title muted">Processing…</div></div>
              </div>

              {/* Always the input for the learner's turn now — talk or type,
                  same bar. Tap the mic to start; it live-fills the text below
                  as you talk, tap again to stop, review/edit like any typed
                  message, then hit Send yourself. Nothing here auto-sends. */}
              {voiceState === 'manual' && (
                <div className="manual-bar-wrap">
                  <div className="manual-bar">
                  <button
                    type="button"
                    onClick={handleToggleMic}
                    disabled={!micAvailable || isTranscribing || isLoading || sessionComplete}
                    className={cn('mic-toggle-btn', isListening && 'active')}
                    title={isListening ? 'Stop and review before sending' : 'Tap to talk'}
                    aria-label={isListening ? 'Stop listening' : 'Start talking'}
                    data-tour="rpe-session-voice"
                  >
                    {isListening && <span className="mic-toggle-ring" />}
                    {isListening ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
                  </button>
                  <textarea
                    ref={replyInputRef}
                    rows={1}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendWithText(userInput)
                      }
                    }}
                    disabled={isListening || isTranscribing || isLoading || sessionComplete}
                    placeholder={
                      isTranscribing
                        ? 'Transcribing…'
                        : isListening
                          ? (usesLiveCaptions ? 'Listening…' : "Listening… I'll fill this in once you stop")
                          : 'Type your response, or tap the mic to talk…'
                    }
                    className="manual-input"
                  />
                  <button
                    type="button"
                    onClick={() => handleSendWithText(userInput)}
                    disabled={!userInput.trim() || isListening || isTranscribing || isLoading || sessionComplete}
                    className="manual-send"
                    aria-label="Send"
                  >
                    {isLoading ? <Loader2 size={16} strokeWidth={1.8} className="spin" /> : <Send size={16} strokeWidth={1.8} />}
                  </button>
                  </div>

                  {/* Confidence is the one real signal either capture path
                      gives about whether it heard you right — there's no
                      ground truth to check the transcript against, so this
                      is a hint to re-read it before sending, never a block
                      (confidence scoring from either backend is known to be
                      inconsistent). Only shown once capture has fully
                      settled — mid-listening or mid-transcribing it'd just
                      flicker against a stale value. */}
                  {!isListening && !isTranscribing && lowConfidence && userInput.trim() && (
                    <p className="low-confidence-hint">
                      <AlertTriangle size={12} strokeWidth={2} />
                      Wasn't fully sure I heard that right — worth a quick read before sending.
                    </p>
                  )}
                </div>
              )}

              {voiceState === 'choice' && (
                <ResponseChoiceCards options={choiceOptions} onChoose={handleChooseOption} />
              )}
            </div>
          </div>

          {/* Floating chat toggle — the transcript is hidden by default so
              it doesn't compete with the avatar; this is the only way back
              to it, website-chat-widget style. */}
          <button
            type="button"
            className="chat-fab"
            onClick={handleToggleChat}
            aria-label={chatOpen ? 'Hide transcript' : 'Show transcript'}
            aria-expanded={chatOpen}
            data-tour="rpe-session-chat"
          >
            {chatOpen ? <X size={20} strokeWidth={2} /> : <MessageCircle size={20} strokeWidth={2} />}
            {!chatOpen && hasUnread && <span className="fab-dot" />}
          </button>

          {chatOpen && (
            <div className="chat-panel">
              <div className="chat-panel-header">
                <span>Transcript</span>
                <button type="button" onClick={handleToggleChat} aria-label="Close transcript" className="chat-panel-close">
                  <X size={15} strokeWidth={1.8} />
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
                          <span className="bullet">●</span>{msg.role === 'npc' ? npcDisplayName : 'You'}
                          {emo && <emo.Icon size={11} strokeWidth={2} className="emo-icon" style={{ color: emo.color }} />}
                        </div>
                        {msg.deliverableLabel && (
                          <div className="msg-attachment">
                            <Paperclip size={12} strokeWidth={2} />
                            {msg.deliverableLabel}
                          </div>
                        )}
                        <div className="msg-body">{msg.message}</div>
                      </div>
                    )
                  })}

                  {isLoading && !npcSpeaking && (
                    <div className="typing">
                      <div className="msg-label"><span className="bullet">●</span>{npcDisplayName}</div>
                      <div className="typing-dots"><span /><span /><span /></div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>

                <div className={cn('scroll-pill', showScrollPill && 'show')} onClick={scrollToBottom}>
                  ↓ New message
                </div>
              </div>
            </div>
          )}

          <div className="overlay">
            <div className={cn('result-card', cardVariant)}>
              <span className="result-icon">{endReasonMeta?.icon ?? '👋'}</span>
              <div className="result-title">{endReasonMeta?.title ?? 'Session Complete'}</div>
              <div className="result-sub">{endReasonMeta?.sub ?? ''}</div>
              <button type="button" className="view-feedback" onClick={handleViewFeedbackNow}>
                View Outcome
              </button>
            </div>
          </div>
        </main>
      </div>

      <SessionLoadingScreen scenarioTitle={scenarioTitle} npcRole={npcDisplayName} visible={!avatarReady} />


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
          --warning:       #D29922;
          --warning-glow:  rgba(210,153,34,0.18);
          --text-hi:       #F0F6FC;
          --text-med:      #8B949E;
          --text-low:      #484F58;

          /* Stage-locked tokens — the avatar viewport's floating overlay UI
             (topbar, voice/sensing pills, camera dock, nudge toasts, state
             indicators) sits directly over the dark 3D canvas, not the page
             background, so it must stay legible regardless of app theme.
             These are never redefined in the light-mode override below. */
          --stage-text-hi:    #F0F6FC;
          --stage-text-med:   #8B949E;
          --stage-text-low:   #6E7681;
          --stage-success:    #3FB950;
          --stage-primary:    #4493F8;
          --stage-primary-glow:        rgba(68,147,248,0.15);
          --stage-primary-glow-strong: rgba(68,147,248,0.35);
          --stage-accent:     #7C3AED;
          --stage-accent-glow: rgba(124,58,237,0.15);
          --stage-danger:     #F85149;
          --stage-danger-glow: rgba(248,81,73,0.18);
          --stage-warning:    #D29922;
          --stage-warning-glow: rgba(210,153,34,0.18);
          --stage-border:     #30363D;
          --stage-surface-hi: #21262D;
          --stage-scrim:        rgba(22,27,34,0.75);
          --stage-scrim-strong: rgba(22,27,34,0.92);
          --stage-edge-rgb: 13,17,23;
          --stage-danger-tint-bg:  rgba(45,20,20,0.92);
          --stage-warning-tint-bg: rgba(45,36,14,0.92);

          --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
          --ease: cubic-bezier(0.22, 1, 0.36, 1);

          /* Overlays floating on the avatar stage — kept dark-by-default
             since they were designed against the dark stage background, but
             now themeable since the stage surface itself follows the app
             theme (var(--surface)) rather than staying permanently black. */
          --scrim-top:    linear-gradient(180deg, rgba(13,17,23,0.85) 0%, rgba(13,17,23,0.55) 60%, transparent 100%);
          --scrim-bottom: linear-gradient(0deg, rgba(13,17,23,0.9) 0%, rgba(13,17,23,0.6) 55%, transparent 100%);
          --overlay-chip-bg:  rgba(22,27,34,0.75);
          --overlay-toast-bg: rgba(22,27,34,0.92);
          --overlay-toast-critical-bg: rgba(45,20,20,0.92);
          --overlay-toast-warning-bg:  rgba(45,36,14,0.92);
          --overlay-dismiss-bg:       rgba(255,255,255,0.08);
          --overlay-dismiss-bg-hover: rgba(255,255,255,0.16);
          --choice-card-bg: rgba(22,27,34,0.85);
          --choice-card-hover-bg: rgba(68,147,248,0.1);

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
          position:absolute; inset:4px; border-radius:50%; overflow:hidden;
          background:linear-gradient(160deg, var(--surface-hi), var(--surface));
          border:1px solid var(--border);
          display:flex; align-items:center; justify-content:center; font-size:44px;
        }
        .rpe-vs .avatar-photo{ width:100%; height:100%; object-fit:cover; display:block; }
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

        .rpe-vs .live-meters{ display:flex; flex-direction:column; gap:10px; }
        .rpe-vs .meter-row{ display:flex; align-items:center; gap:8px; }
        .rpe-vs .meter-label{ font-size:11px; color:var(--text-med); width:46px; flex-shrink:0; }
        .rpe-vs .meter-track{ flex:1; height:5px; border-radius:100px; background:var(--surface-hi); border:1px solid var(--border-soft); overflow:hidden; }
        .rpe-vs .meter-fill{ height:100%; border-radius:100px; transition:width .5s var(--ease); }
        .rpe-vs .meter-fill.trust{ background:linear-gradient(90deg, var(--primary), #6BB2FF); }
        .rpe-vs .meter-fill.tension{ background:linear-gradient(90deg, var(--danger), #FF8A85); }
        .rpe-vs .meter-fill.clarity{ background:linear-gradient(90deg, var(--success), #6BDE85); }
        .rpe-vs .meter-val{ font-size:11px; font-weight:700; color:var(--text-hi); width:26px; text-align:right; flex-shrink:0; font-variant-numeric:tabular-nums; }
        .rpe-vs .meter-hint{ font-size:10.5px; color:var(--text-low); margin:2px 0 0; }

        .rpe-vs .rail-spacer{ flex:1; }

        .rpe-vs .end-btn{
          width:100%; background:transparent; color:var(--text-med);
          border:1px solid var(--border); border-radius:10px; padding:12px 14px;
          font-size:13px; font-weight:600; cursor:pointer;
          transition:border-color .2s var(--ease), color .2s var(--ease), background .2s var(--ease);
        }
        .rpe-vs .end-btn:hover:not(:disabled){ border-color:var(--danger); color:var(--danger-hover-text, #FF7B72); background:var(--danger-glow); }
        .rpe-vs .end-btn:disabled{ opacity:.4; cursor:default; }
        .rpe-vs .end-btn:focus-visible{ outline:2px solid var(--danger); outline-offset:2px; }

        .rpe-vs .main{ display:flex; flex-direction:column; height:100%; min-width:0; position:relative; }

        /* Stage — the avatar fills the whole main column; the topbar and
           voice controls float over it on scrims so the 3D character reads
           as the primary surface instead of sharing space with a panel. */
        .rpe-vs .stage{ position:relative; flex:1; min-height:0; background:var(--surface); overflow:hidden; }
        .rpe-vs .character-avatar{ width:100%; height:100%; }

        .rpe-vs .stage-topbar{
          position:absolute; top:0; left:0; right:0; z-index:5;
          height:56px; display:flex; align-items:center; gap:14px; padding:0 20px;
          background:var(--scrim-top);
        }
        .rpe-vs .back-btn{
          background:var(--overlay-chip-bg); border:1px solid var(--border); color:var(--text-med); cursor:pointer;
          width:30px; height:30px; border-radius:8px; display:flex; align-items:center; justify-content:center;
          transition:background .2s var(--ease), color .2s var(--ease); flex-shrink:0;
          align-self:flex-start; margin-bottom:18px;
        }
        .rpe-vs .back-btn:hover{ background:var(--surface-hi); color:var(--text-hi); }
        .rpe-vs .topbar-title{ font-size:12.5px; color:var(--text-hi); flex:1; text-align:center; letter-spacing:.01em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-shadow:var(--topbar-title-shadow, 0 1px 4px rgba(0,0,0,0.6)); }

        .rpe-vs .sensing-pill{
          font-size:11px; font-weight:650; letter-spacing:.03em; color:var(--accent);
          background:var(--overlay-chip-bg); border:1px solid rgba(124,58,237,0.35); backdrop-filter:blur(4px);
          padding:5px 11px 5px 9px; border-radius:100px; display:flex; align-items:center; gap:7px; flex-shrink:0;
          cursor:pointer; transition:filter .2s var(--ease), background .2s var(--ease), color .2s var(--ease), border-color .2s var(--ease);
        }
        .rpe-vs .sensing-pill:hover{ filter:brightness(1.15); }
        .rpe-vs .sensing-pill.muted{ color:var(--text-med); background:var(--overlay-chip-bg); border-color:var(--border); }

        /* Compact learner-camera feed, docked beside the avatar — off by
           default, opt-in via the "Coaching" pill above. The mesh-toggle
           button only hides the wireframe overlay (see useNudgeSensing's
           showMesh) — the raw feed keeps showing either way. */
        .rpe-vs .camera-dock{
          position:absolute; top:66px; left:20px; z-index:6;
          width:200px; aspect-ratio:4/3; border-radius:12px; overflow:hidden;
          background:var(--stage-surface-hi); border:1px solid var(--stage-border);
          box-shadow:0 10px 26px rgba(0,0,0,0.45);
          opacity:0; animation: rpevsCameraDockIn .35s var(--ease) forwards;
        }
        @keyframes rpevsCameraDockIn{ from{ opacity:0; transform:translateY(-8px); } to{ opacity:1; transform:none; } }
        .rpe-vs .camera-dock-canvas{ width:100%; height:100%; object-fit:cover; display:block; }
        .rpe-vs .mesh-toggle-btn{
          position:absolute; top:6px; right:6px; z-index:2;
          width:22px; height:22px; border-radius:6px; display:flex; align-items:center; justify-content:center;
          background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.15); color:#fff; cursor:pointer;
          transition:background .2s ease, opacity .2s ease;
        }
        .rpe-vs .mesh-toggle-btn:hover{ background:rgba(0,0,0,0.75); }
        .rpe-vs .mesh-toggle-btn.muted{ opacity:.45; }

        /* Nudge toasts — same severity language (critical/warning/info) and
           slide-in/stack behaviour as MCA's live coaching screen. Colors are
           the fixed --stage-* tokens (never redefined for light mode): these
           float directly over the dark avatar canvas, not the page
           background, so they must stay legible regardless of app theme. */
        .rpe-vs .nudge-stack{
          position:absolute; top:66px; right:20px; z-index:12;
          display:flex; flex-direction:column; align-items:flex-end; gap:10px;
          pointer-events:none; max-width:min(320px, calc(100% - 40px));
        }
        .rpe-vs .nudge-toast{
          pointer-events:auto; display:flex; align-items:center; gap:16px;
          padding:14px 24px; border-radius:16px; width:100%;
          background:var(--nudge-info-bg); backdrop-filter:blur(10px);
          border:1px solid rgba(255,255,255,0.2); color:#ffffff;
          box-shadow:0 14px 34px rgba(0,0,0,0.4);
          opacity:0; transform:translateX(24px);
          animation: rpevsNudgeIn .4s var(--ease) forwards;
          transition:transform .3s var(--ease), opacity .3s var(--ease);
        }
        @keyframes rpevsNudgeIn{ to{ opacity:1; transform:none; } }
        .rpe-vs .nudge-toast.stacked{ transform:scale(0.94); opacity:0.55; }
        .rpe-vs .nudge-toast.stacked:hover{ transform:scale(1); opacity:1; }
        .rpe-vs .nudge-toast.critical{ border-color:rgba(255,255,255,0.3); background:var(--nudge-critical-bg); }
        .rpe-vs .nudge-toast.warning{ border-color:rgba(255,255,255,0.3); background:var(--nudge-warning-bg); }
        .rpe-vs .nudge-icon{
          flex-shrink:0; width:36px; height:36px; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          background:rgba(255,255,255,0.2); color:#ffffff;
        }
        .rpe-vs .nudge-toast.critical .nudge-icon{ background:rgba(255,255,255,0.3); }
        .rpe-vs .nudge-toast.warning .nudge-icon{ background:rgba(255,255,255,0.2); }
        .rpe-vs .nudge-body{ flex:1; min-width:0; display:flex; flex-direction:column; }
        .rpe-vs .nudge-text{ font-size:11px; font-weight:500; line-height:1.25; margin:0; letter-spacing:0.05em; text-transform:uppercase; color:#ffffff; }
        .rpe-vs .nudge-time{ font-size:9px; color:rgba(255,255,255,0.5); font-weight:700; margin-top:6px; }
        .rpe-vs .nudge-dismiss{
          flex-shrink:0; width:28px; height:28px; border-radius:50%; border:none; cursor:pointer;
          background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.7);
          display:flex; align-items:center; justify-content:center;
          transition:background .2s var(--ease), color .2s var(--ease);
        }
        .rpe-vs .nudge-dismiss:hover{ background:rgba(255,255,255,0.2); color:#ffffff; }

        .rpe-vs .stage-bottom{
          position:absolute; bottom:0; left:0; right:0; z-index:5;
          min-height:96px; display:flex; align-items:center; justify-content:center; padding:20px;
          background:var(--scrim-bottom);
        }

        /* Floating chat toggle — bottom-right FAB, website-chat-widget style. */
        .rpe-vs .chat-fab{
          position:absolute; right:20px; bottom:20px; z-index:15;
          width:52px; height:52px; border-radius:50%; border:none; cursor:pointer;
          background:linear-gradient(135deg, var(--primary), var(--accent)); color:#fff;
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 10px 28px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset;
          transition:transform .2s var(--ease), filter .2s var(--ease);
        }
        .rpe-vs .chat-fab:hover{ transform:translateY(-2px); filter:brightness(1.08); }
        .rpe-vs .fab-dot{
          position:absolute; top:4px; right:4px; width:11px; height:11px; border-radius:50%;
          background:var(--danger); border:2px solid var(--bg);
          animation:rpevsDotBeat 1.6s ease-in-out infinite;
        }

        .rpe-vs .chat-panel{
          position:absolute; right:20px; bottom:84px; z-index:14;
          width:min(380px, calc(100% - 40px)); height:min(520px, calc(100% - 120px));
          background:var(--surface); border:1px solid var(--border); border-radius:16px;
          display:flex; flex-direction:column; overflow:hidden;
          box-shadow:0 24px 60px rgba(0,0,0,0.5);
          animation:rpevsChatIn .25s var(--ease);
        }
        @keyframes rpevsChatIn{ from{ opacity:0; transform:translateY(12px) scale(0.98); } to{ opacity:1; transform:none; } }
        .rpe-vs .chat-panel-header{
          flex-shrink:0; height:44px; display:flex; align-items:center; justify-content:space-between;
          padding:0 14px 0 18px; border-bottom:1px solid var(--border);
          font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-med);
        }
        .rpe-vs .chat-panel-close{
          background:none; border:none; color:var(--text-med); cursor:pointer;
          width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center;
          transition:background .2s var(--ease), color .2s var(--ease);
        }
        .rpe-vs .chat-panel-close:hover{ background:var(--surface-hi); color:var(--text-hi); }

        .rpe-vs .transcript-wrap{ position:relative; flex:1; min-height:0; }
        .rpe-vs .transcript{
          height:100%; overflow-y:auto; padding:18px 16px 16px;
          overscroll-behavior:contain; -webkit-overflow-scrolling:touch;
        }
        .rpe-vs .transcript::-webkit-scrollbar{ width:6px; }
        .rpe-vs .transcript::-webkit-scrollbar-thumb{ background:var(--surface-hi); border-radius:100px; }
        .rpe-vs .transcript::-webkit-scrollbar-track{ background:transparent; }

        .rpe-vs .msg{ max-width:100%; margin:0 0 22px; opacity:0; animation: rpevsMsgInLeft .45s var(--ease) forwards; }
        .rpe-vs .msg:last-child{ margin-bottom:8px; }
        .rpe-vs .msg.user{ animation-name: rpevsMsgInRight; margin-left:auto; text-align:right; }
        @keyframes rpevsMsgInLeft{ from{ opacity:0; transform:translateX(-14px) translateY(6px); } to{ opacity:1; transform:none; } }
        @keyframes rpevsMsgInRight{ from{ opacity:0; transform:translateX(14px) translateY(6px); } to{ opacity:1; transform:none; } }

        .rpe-vs .msg-label{ font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; display:flex; align-items:center; gap:7px; margin-bottom:8px; }
        .rpe-vs .msg.npc .msg-label{ color:var(--msg-emotion, var(--accent)); }
        .rpe-vs .msg.user .msg-label{ color:var(--primary); justify-content:flex-end; }
        .rpe-vs .msg-label .bullet{ font-size:8px; }
        .rpe-vs .msg-label .emo-icon{ flex-shrink:0; }

        .rpe-vs .msg-attachment{
          display:inline-flex; align-items:center; gap:6px; margin:0 0 6px;
          font-size:11px; font-weight:650; color:var(--primary);
          background:var(--primary-glow); border:1px solid rgba(68,147,248,0.35);
          border-radius:100px; padding:4px 10px;
        }

        .rpe-vs .msg-body{ font-size:14px; line-height:1.6; letter-spacing:-0.003em; padding:2px 0 2px 12px; border-left:2px solid transparent; }
        .rpe-vs .msg.npc .msg-body{ color:var(--npc-msg-text, #C9D1D9); border-left-color:var(--msg-emotion, var(--accent-glow)); transition:border-color .3s var(--ease); }
        .rpe-vs .msg.user .msg-body{ color:var(--text-hi); border-left:none; border-right:2px solid var(--primary-glow); padding-left:0; padding-right:12px; }

        .rpe-vs .msg.latest .msg-body{ position:relative; border-radius:10px; padding:12px 16px; }
        .rpe-vs .msg.latest.npc .msg-body{ background:linear-gradient(90deg, var(--msg-emotion-glow, rgba(68,147,248,0.055)), transparent 70%); border-left-color:var(--msg-emotion, rgba(124,58,237,0.5)); }
        .rpe-vs .msg.latest.user .msg-body{ background:linear-gradient(270deg, rgba(68,147,248,0.06), transparent 70%); border-right-color:rgba(68,147,248,0.5); padding-left:16px; }

        .rpe-vs .typing{ max-width:100%; margin-bottom:22px; animation: rpevsMsgInLeft .4s var(--ease) forwards; }
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
        .rpe-vs[data-voice-state="processing"] .state-processing{ display:flex; }

        .rpe-vs .wave{ display:flex; align-items:center; gap:3px; height:30px; }
        .rpe-vs .wave span{ width:3.5px; border-radius:3px; background:linear-gradient(180deg, #6BB2FF, var(--stage-primary)); animation: rpevsWaveMove 1s ease-in-out infinite; display:block; }
        .rpe-vs .wave span:nth-child(1){ height:10px; animation-delay:-0.9s; }
        .rpe-vs .wave span:nth-child(2){ height:20px; animation-delay:-0.6s; }
        .rpe-vs .wave span:nth-child(3){ height:28px; animation-delay:-0.3s; }
        .rpe-vs .wave span:nth-child(4){ height:14px; animation-delay:-1.1s; }
        .rpe-vs .wave span:nth-child(5){ height:24px; animation-delay:-0.15s; }
        .rpe-vs .wave span:nth-child(6){ height:17px; animation-delay:-0.75s; }
        .rpe-vs .wave span:nth-child(7){ height:9px; animation-delay:-0.45s; }
        @keyframes rpevsWaveMove{ 0%,100%{ transform:scaleY(0.4); } 50%{ transform:scaleY(1); } }

        .rpe-vs .state-text{ display:flex; flex-direction:column; gap:1px; }
        .rpe-vs .state-title{ font-size:13.5px; font-weight:650; color:var(--stage-text-hi); }
        .rpe-vs .state-title.muted{ color:var(--stage-text-med); }
        .rpe-vs .state-sub{ font-size:11.5px; color:var(--stage-text-med); }

        @keyframes rpevsOrbPulse{ 0%{ transform:scale(0.4); opacity:.9; } 100%{ transform:scale(2.2); opacity:0; } }

        .rpe-vs .spinner-arc{ width:22px; height:22px; border-radius:50%; border:2.5px solid var(--stage-border); border-top-color:var(--stage-primary); animation:rpevsSpin .75s linear infinite; }
        @keyframes rpevsSpin{ to{ transform:rotate(360deg); } }
        .rpe-vs .spin{ animation:rpevsSpin .75s linear infinite; }

        .rpe-vs .manual-bar-wrap{ display:flex; flex-direction:column; gap:6px; width:100%; max-width:640px; }
        .rpe-vs .mic-toggle-btn{
          position:relative; flex-shrink:0; width:38px; height:38px; border-radius:10px; cursor:pointer;
          display:flex; align-items:center; justify-content:center; border:1px solid var(--stage-border);
          background:var(--stage-surface-hi); color:var(--stage-text-hi);
          transition:background .2s var(--ease), border-color .2s var(--ease), color .2s var(--ease);
        }
        .rpe-vs .mic-toggle-btn:hover:not(:disabled){ border-color:var(--stage-primary); }
        .rpe-vs .mic-toggle-btn:disabled{ opacity:.4; cursor:default; }
        .rpe-vs .mic-toggle-btn.active{
          background:var(--stage-primary); border-color:transparent; color:#fff;
        }
        .rpe-vs .mic-toggle-ring{
          position:absolute; inset:-4px; border-radius:12px; border:2px solid var(--stage-primary);
          pointer-events:none; animation:rpevsMicPulse 1.6s ease-out infinite;
        }
        @keyframes rpevsMicPulse{ 0%{ transform:scale(0.9); opacity:.7; } 100%{ transform:scale(1.35); opacity:0; } }
        .rpe-vs .manual-bar{ display:flex; gap:8px; width:100%; align-items:flex-end; }
        .rpe-vs .low-confidence-hint{
          display:flex; align-items:center; gap:6px; margin:0; padding:0 2px;
          font-size:11px; color:var(--stage-warning); line-height:1.4;
        }
        .rpe-vs .manual-input{
          flex:1; resize:none; background:var(--stage-surface-hi); border:1px solid var(--stage-border);
          border-radius:10px; padding:10px 12px; color:var(--stage-text-hi); font-size:13px; line-height:1.5;
          font-family:inherit; min-height:38px; max-height:120px; overflow-y:auto;
        }
        .rpe-vs .manual-input::placeholder{ color:var(--stage-text-low); }
        .rpe-vs .manual-input:focus{ outline:none; border-color:var(--stage-primary); }
        .rpe-vs .manual-send{
          width:38px; height:38px; flex-shrink:0; border:none; border-radius:10px; cursor:pointer;
          background:linear-gradient(135deg, var(--stage-primary), #6BB2FF); color:#fff;
          display:flex; align-items:center; justify-content:center;
          transition:filter .2s var(--ease);
        }
        .rpe-vs .manual-send:hover:not(:disabled){ filter:brightness(1.08); }
        .rpe-vs .manual-send:disabled{ opacity:.4; cursor:default; }

        .rpe-vs .overlay{
          position:absolute; inset:0; display:none; align-items:flex-end; justify-content:center;
          background:var(--overlay-backdrop, rgba(6,8,12,0.72)); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:20;
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

        /* Light theme override — see the matching block in ScenarioSelect.jsx
           for why this needs its own vars rather than inheriting index.css.
           The stage's floating scrims/pills/nudge toasts flip to light too
           (translucent lavender instead of translucent black) — the avatar
           viewport underneath already follows var(--surface), so a dark
           scrim over a light stage looked like a stray black bar. */
        :root[data-theme="light"] .rpe-vs{
          --bg:            #F5F3FD;
          --surface:       #FFFFFF;
          --surface-hi:    #EFEAFB;
          --border:        #D9CFF5;
          --border-soft:   #E9E2FB;
          --primary:       #3D6FE0;
          --primary-glow:  rgba(61,111,224,0.10);
          --primary-glow-strong: rgba(61,111,224,0.30);
          --accent:        #6B3FD6;
          --accent-glow:   rgba(107,63,214,0.12);
          --success:       #1E8E4A;
          --success-glow:  rgba(30,142,74,0.15);
          --danger:        #D93B32;
          --danger-glow:   rgba(217,59,50,0.15);
          --warning:       #B4790E;
          --warning-glow:  rgba(180,121,14,0.15);
          --text-hi:       #241E38;
          --text-med:      #5E5678;
          --text-low:      #8D84A8;
          --npc-msg-text:      #3A3352;
          --danger-hover-text: #B42318;
          --overlay-backdrop:  rgba(245,243,253,0.82);

          --scrim-top:    linear-gradient(180deg, rgba(245,243,253,0.92) 0%, rgba(245,243,253,0.6) 60%, transparent 100%);
          --scrim-bottom: linear-gradient(0deg, rgba(245,243,253,0.94) 0%, rgba(245,243,253,0.65) 55%, transparent 100%);
          --overlay-chip-bg:  rgba(255,255,255,0.8);
          --overlay-toast-bg: rgba(255,255,255,0.92);
          --overlay-toast-critical-bg: rgba(255,231,229,0.95);
          --overlay-toast-warning-bg:  rgba(255,242,220,0.95);
          --overlay-dismiss-bg:       rgba(36,30,56,0.06);
          --overlay-dismiss-bg-hover: rgba(36,30,56,0.12);
          --choice-card-bg: rgba(255,255,255,0.9);
          --choice-card-hover-bg: rgba(61,111,224,0.12);
          --topbar-title-shadow: none;
        }
      `}</style>
    </div>
  )
}

// Resolves the URL's :sessionId into a full navState before RolePlaySessionInner
// ever mounts. Two paths:
//
//   1. Fresh start — ScenarioSelect's navigate() already attached the full
//      navState (scenario title, roles, opening line, ...) via router state,
//      and it matches this URL's :sessionId. Render Inner immediately, same
//      as before this existed — zero extra latency, zero extra requests.
//
//   2. Recovery — router state is missing (a hard refresh drops it) or
//      belongs to a different session (a direct/bookmarked link to this
//      URL). Re-fetch the session from the backend (it's the source of
//      truth regardless — see rpe_session_service's dual Supabase/JSON
//      persistence) plus its scenario, and rebuild the same shape of
//      navState from that, along with the turns/trust history needed to
//      restore the transcript and live meters. An already-finished session
//      has nothing to resume, so that redirects to its feedback screen
//      instead of trying to re-open a live chat.
//
// The one thing recovery can't restore is the specific avatar model/name
// picked at "view details" time — that choice only ever lived in router
// state, never persisted server-side — so a recovered session falls back to
// a gender-matched random pick, same as a scenario started with no
// customization at all.
export default function RolePlaySession() {
  const { sessionId: sessionIdParam } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const freshNavState = location.state?.sessionId === sessionIdParam ? location.state : null

  const [recovered, setRecovered] = useState(null)
  const [recoveryError, setRecoveryError] = useState(null)

  useEffect(() => {
    if (freshNavState) return
    if (!sessionIdParam) { navigate('/roleplay', { replace: true }); return }

    let cancelled = false
    ;(async () => {
      try {
        const session = await rpeService.getSessionSummary(sessionIdParam)
        if (session.ended_at) {
          // Nothing left to resume — send them straight to the results
          // they'd have landed on anyway had the session run to completion.
          navigate(`/roleplay/feedback/${sessionIdParam}`, { replace: true })
          return
        }
        const scenario = await rpeService.getScenarioDetail(session.scenario_id)
        if (cancelled) return

        setRecovered({
          turns:        session.turns || [],
          trustHistory: session.trust_history || [],
          navState: {
            sessionId:                  sessionIdParam,
            openingNpcLine:             session.opening_npc_line,
            scenarioTitle:              scenario.title,
            difficulty:                 scenario.difficulty,
            totalTurns:                 session.recommended_turns ?? scenario.recommended_turns,
            recommendedTurns:           session.recommended_turns ?? scenario.recommended_turns,
            maxTurns:                   session.max_turns ?? scenario.max_turns,
            npcRole:                    scenario.npc_role,
            npcGender:                  scenario.npc_gender,
            npcName:                    session.npc_name,
            failureEscalationThreshold: scenario.end_conditions?.failure_escalation_threshold,
          },
        })
      } catch (err) {
        if (!cancelled) setRecoveryError(err.message || "We couldn't reconnect to this session.")
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdParam])

  if (freshNavState) {
    return <RolePlaySessionInner navState={freshNavState} />
  }

  if (recoveryError) {
    return (
      <div className="rpe-recover-error">
        <p className="rpe-recover-title">We couldn't reconnect to this session</p>
        <p className="rpe-recover-sub">{recoveryError}</p>
        <button type="button" onClick={() => navigate('/roleplay')} className="rpe-recover-btn">
          Back to Practice Lab
        </button>
        <style>{`
          .rpe-recover-error{
            position:fixed; inset:0; z-index:100; display:flex; flex-direction:column;
            align-items:center; justify-content:center; gap:14px; text-align:center; padding:24px;
            background:#0D1117; color:#F0F6FC;
            font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          }
          .rpe-recover-title{ font-size:17px; font-weight:750; margin:0; }
          .rpe-recover-sub{ font-size:13.5px; color:#8B949E; margin:0; max-width:360px; }
          .rpe-recover-btn{
            margin-top:8px; background:linear-gradient(135deg, #7C3AED, #9B6BFF); border:none; color:#fff;
            font-size:13px; font-weight:650; padding:10px 20px; border-radius:10px; cursor:pointer;
          }
          :root[data-theme="light"] .rpe-recover-error{ background:#F5F3FD; color:#241E38; }
          :root[data-theme="light"] .rpe-recover-sub{ color:#5E5678; }
        `}</style>
      </div>
    )
  }

  if (!recovered) {
    return <SessionLoadingScreen scenarioTitle="Reconnecting to your session…" visible />
  }

  return (
    <RolePlaySessionInner
      navState={recovered.navState}
      recoveredTurns={recovered.turns}
      recoveredTrustHistory={recovered.trustHistory}
    />
  )
}
