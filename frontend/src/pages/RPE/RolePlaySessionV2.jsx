import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { analyticsService } from '@/services/analytics/analyticsService'
import { integrateCompletedSession } from '@/pages/Analytics/analyticsIntegrationUtils'
import { useAuth } from '@/lib/auth/context'
import { cn } from '@/lib/utils'
import TalkingHeadAvatar from '@/components/RPE/TalkingHeadAvatar'
import SessionLoadingScreen from '@/components/RPE/SessionLoadingScreen'
// ResponseChoiceCardsV2 / ConversationReplayV2 — isolated redesigns (see
// their own files for the "why"), swapped in here in place of the original
// ResponseChoiceCards and this page's own first-pass TranscriptDrawer.
// Neither ResponseChoiceCards.jsx nor V1 are touched by this swap.
import ResponseChoiceCardsV2 from '@/components/RPE/ResponseChoiceCardsV2'
import ConversationReplayV2 from '@/components/RPE/ConversationReplayV2'
// ContentRequestInputV2 — the other half of the interaction-type split (see
// lib/rpe/interaction.js's resolveInteraction). ResponseChoiceCardsV2 stays
// responsible only for communication-decision turns.
import ContentRequestInputV2 from '@/components/RPE/ContentRequestInputV2'
import { resolveInteraction } from '@/lib/rpe/interaction'
// SceneEnvironmentV2 — new, isolated cinematic backdrop for the stage (see
// its own file for the "why"). Purely presentational, gated behind
// ENABLE_CINEMATIC_ENVIRONMENT so it can be switched off in one place.
import SceneEnvironmentV2, { EnvironmentDebugPanel } from '@/components/RPE/SceneEnvironmentV2'
import { ENABLE_CINEMATIC_ENVIRONMENT, resolveEnvironmentId } from '@/lib/rpe/sceneEnvironments'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { useNudgeSensing } from '@/hooks/useNudgeSensing'
import { getAvatarOption, pickNpcAvatar, pickNpcProfileImage } from '@/lib/rpe/npcAvatars'
import SessionTopBar from '@/components/RPE/v2/SessionTopBar'
import { AnimatePresence } from 'framer-motion'
import NPCDialogue from '@/components/RPE/v2/NPCDialogue'
import ConversationStateIndicatorV2 from '@/components/RPE/v2/ConversationStateIndicatorV2'
import ConversationIntelligenceDebugPanel from '@/components/RPE/v2/ConversationIntelligenceDebugPanel'
import {
  normalizeTurnResponse, createInitialIntelligence, advanceIntelligence, computeDirection,
} from '@/components/RPE/v2/conversationIntelligenceV2'
import UserCameraPreview from '@/components/RPE/v2/UserCameraPreview'
import TrustIndicator from '@/components/RPE/v2/TrustIndicator'
import VoiceDock from '@/components/RPE/v2/VoiceDock'
import CoachingNudge, { CoachingToggle } from '@/components/RPE/v2/CoachingNudge'
import SessionSignals from '@/components/RPE/v2/SessionSignals'
import SessionCompleteOverlay from '@/components/RPE/v2/SessionCompleteOverlay'
import EndConfirmModal from '@/components/RPE/v2/EndConfirmModal'
import { prefersReducedMotion } from '@/components/RPE/feedback/feedbackTheme'
import './RolePlaySessionV2.css'

/*
 * RolePlaySessionV2 — isolated redesign of the role-play session screen.
 *
 * This is a NEW, parallel implementation, not a modification of
 * RolePlaySession.jsx. That file is untouched. Because it's a genuinely
 * separate mounted component tree, the state machine and turn-handling
 * logic below is necessarily re-implemented here rather than imported —
 * there is no shared-state mechanism between two independently-routed
 * pages — but every SERVICE, HOOK, and REUSABLE COMPONENT that logic
 * depends on (rpeService, useVoiceRecorder, useNudgeSensing,
 * TalkingHeadAvatar, ResponseChoiceCards, SessionLoadingScreen, the
 * npcAvatars picker) is the exact same one V1 uses, imported fresh, not
 * duplicated. Only the UI layer and this orchestration wiring are new.
 */

// Same two lookup tables RolePlaySession.jsx keeps module-local (not
// exported, so not importable without editing that file) — duplicated
// here rather than touching V1 to export them. Verified against the same
// TalkingHead vocabulary V1's comments already cite.
const EMOTION_TO_MOOD = {
  neutral: 'neutral', happy: 'happy', angry: 'angry', sad: 'sad',
  surprised: 'fear', frustrated: 'angry', skeptical: 'disgust', thinking: 'neutral',
}
const ANIMATION_TO_GESTURE = {
  thumbsUp: 'thumbup', thumbsDown: 'thumbdown', shrug: 'shrug',
  openHandPause: 'handup', pointing: 'index', handsClasped: 'namaste', wave: '👋',
}
// Generic, contentType-derived transcript label for a content_request/
// direct_input submission — see handleSubmitContent below. Deliberately
// generic rather than a fabricated specific title (e.g. never invents
// "Section 5.3 — Instrumentation Plan"); the frontend only knows the kind
// of thing that was asked for, not what it's actually about.
const CONTENT_TYPE_LABEL = {
  paragraph: 'Paragraph provided', section: 'Section provided', evidence: 'Evidence provided',
  long_text: 'Content provided', filename: 'Filename provided', number: 'Figure provided',
  short_text: 'Value provided',
}
// The pause between the NPC's mood/gesture changing and the line actually
// starting — long enough to read as "I heard you and I'm reacting", short
// enough to never feel like an artificial wait. Within the spec's suggested
// 250-900ms range; skipped entirely under prefers-reduced-motion.
const REACTION_PAUSE_MS = 450

const END_REASON_SUB = {
  natural_resolution: 'You reached a natural, positive conclusion.',
  user_exit_intent: 'You chose to end the conversation.',
  npc_exit: 'The session ended because of repeated inappropriate language.',
  trust_sustained: 'You built enough trust to resolve the situation.',
  max_turns_reached: 'Session ended at the turn limit.',
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function RolePlaySessionV2Inner({ navState, recoveredTurns, recoveredTrustHistory }) {
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuth()
  const {
    sessionId, openingNpcLine, scenarioTitle, difficulty,
    totalTurns, npcRole, npcGender, npcName, avatarId, failureEscalationThreshold,
    recommendedTurns: recommendedTurnsFromState,
    maxTurns: maxTurnsFromState,
    category: scenarioCategory, conflictType, context: scenarioContext,
  } = navState || {}

  // Scenario metadata -> cinematic environment preset, resolved once per
  // session (a scenario's category/conflict_type never changes mid-session).
  // See sceneEnvironments.js for the mapping — this page doesn't know or
  // care what the presets look like, only which one applies here.
  const [environmentId] = useState(() => resolveEnvironmentId(scenarioCategory, conflictType))
  // Dev-only override (EnvironmentDebugPanel renders nothing outside
  // import.meta.env.DEV) — lets QA cycle through every preset in a single
  // real session instead of needing 4 different scenarios. null = auto.
  const [environmentOverride, setEnvironmentOverride] = useState(null)
  // Both dev-only debug panels (environment + conversation intelligence)
  // collapse behind this single toggle, closed by default — see the
  // "Dev tools" button below. Irrelevant/unused in production (the button
  // that flips it doesn't even render there).
  const [devToolsOpen, setDevToolsOpen] = useState(false)

  const chosenAvatarOption = avatarId ? getAvatarOption(avatarId) : null
  const [npcProfileImage] = useState(() => chosenAvatarOption?.photo ?? pickNpcProfileImage(npcGender))
  const [npcAvatar] = useState(() => chosenAvatarOption ?? pickNpcAvatar(npcGender, npcRole, scenarioTitle))
  const npcDisplayName = npcName || npcRole || 'NPC'

  const headRef = useRef(null)
  const sensingAutoStartedRef = useRef(false)
  const openingSpokenRef = useRef(false)
  const completeTimeoutRef = useRef(null)
  const completeNavStateRef = useRef(null)
  const replyInputRef = useRef(null)
  const reactionTimeoutRef = useRef(null)
  // Trust value going INTO the turn currently in flight — read (not just
  // set) by handleSendWithText to compute a real turn-over-turn direction
  // for TrustIndicator. A ref, not state: it needs to be readable inside a
  // useCallback without adding liveTrust to that callback's own dependency
  // list. null until the first turn actually completes (or a recovered
  // session seeds it — see the recoveredTurns effect), so a delta is never
  // shown against a value that isn't real.
  const previousTrustRef = useRef(null)
  // Same idea, for tension/clarity — feeds conversationIntelligenceV2's
  // relationshipImpact directions. Clarity has no persisted history at all
  // (the backend computes it live per-turn but never stores it — see
  // Backend/app/api/v1/rpe/router.py's turn_data dict), so on a recovered
  // session this one always starts at null regardless of prior turns; a
  // fresh session starts null either way.
  const previousTensionRef = useRef(null)
  const previousClarityRef = useRef(null)
  // Real emotion continuity (conversationIntelligenceV2's emotionTransition)
  // and the real NPC line history (for its literal-text repetition check) —
  // both refs for the same reason previousTrustRef is: read inside
  // handleSendWithText without adding them to its dependency list.
  const previousNpcEmotionRef = useRef(null)
  const npcLinesRef = useRef([])

  const [messages, setMessages] = useState([])
  const [userInput, setUserInput] = useState('')
  const [currentTurn, setCurrentTurn] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const [endReason, setEndReason] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [npcSpeaking, setNpcSpeaking] = useState(false)
  // True only during the brief pause between a response arriving and the
  // NPC's line actually starting — mood/gesture already applied, TTS not
  // started yet. See speak() below and REACTION_PAUSE_MS.
  const [npcReacting, setNpcReacting] = useState(false)
  // 'up' | 'down' | 'flat' | null — null means "no real prior turn to
  // compare against yet", never shown as a delta in that case.
  const [trustDirection, setTrustDirection] = useState(null)
  // Set only on a failed sendTurn — a subtle system-level notice + retry,
  // never a fake NPC transcript message (see the catch block below).
  const [sendError, setSendError] = useState(null)
  // conversationIntelligenceV2's normalization/continuity layer — scenario
  // objective, real turn-over-turn directions, emotion continuity, and
  // (today, always empty — see that file's own comment) memory scaffolding.
  // Presentation-invisible in production; only ConversationIntelligenceDebugPanel
  // reads it, gated behind import.meta.env.DEV.
  const [intelligence, setIntelligence] = useState(() => {
    const initial = createInitialIntelligence(scenarioContext)
    // A recovered session already has turns behind it — 'opening' would be
    // wrong (and there's no structural signal for anything more specific
    // than "somewhere in progress" from a mid-session reload; see
    // derivePhase's own comment on why this stays null rather than a guess).
    if (recoveredTurns?.length) initial.phase = null
    return initial
  })
  // Single source of truth for "what does the learner do right now" —
  // { type: 'normal' } | { type: 'deliverable_choice', options } |
  // { type: 'content_request'|'direct_input', contentType, prompt }.
  // Set from resolveInteraction(response) after every turn; see that
  // function for why this replaced a plain choiceOptions boolean/array.
  const [interaction, setInteraction] = useState({ type: 'normal' })
  const [liveTrust, setLiveTrust] = useState(50)
  const [liveTension, setLiveTension] = useState(0)
  const [liveClarity, setLiveClarity] = useState(null)
  const [avatarReady, setAvatarReady] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const [endConfirmOpen, setEndConfirmOpen] = useState(false)
  // Off by default — the colorful landmark-tracking overlay reads as a
  // computer-vision debug view, competing with the NPC for attention in a
  // small corner preview that's meant to stay secondary. Purely a drawing
  // toggle (confirmed in useNudgeSensing.js: showMeshRef only gates the
  // drawConnectors() calls, never the actual metrics/coaching analysis
  // those metrics feed) — real-time coaching sensing runs identically
  // either way. Still user-togglable via the existing mesh-toggle button.
  const [showMesh, setShowMesh] = useState(false)

  // Full screen — the browser Fullscreen API, not a CSS trick, so it
  // actually hides the OS/browser chrome too. Tracks the real state via
  // fullscreenchange rather than just flipping a boolean on click, since
  // the user can also exit with Esc or their browser's own UI — that has
  // to update this button/label too, not just clicking it again.
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }, [])

  const [recommendedTurns, setRecommendedTurns] = useState(recommendedTurnsFromState || totalTurns || 6)
  const [maxTurns, setMaxTurns] = useState(maxTurnsFromState || null)

  useEffect(() => {
    if (sessionComplete) return
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [sessionComplete])

  const chatOpenRef = useRef(transcriptOpen)
  useEffect(() => { chatOpenRef.current = transcriptOpen }, [transcriptOpen])
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'npc' && !chatOpenRef.current) setHasUnread(true)
  }, [messages])

  const handleToggleTranscript = useCallback(() => {
    setTranscriptOpen((v) => {
      const next = !v
      if (next) setHasUnread(false)
      return next
    })
  }, [])

  // Same voice pipeline as V1 (see useVoiceRecorder.js) — native
  // SpeechRecognition with a MediaRecorder+backend-STT fallback.
  const {
    isListening, isTranscribing, startListening: toggleVoiceInput, stopListening: stopVoiceInput,
    liveTranscript, lowConfidence, canRecord: micAvailable, usesLiveCaptions,
  } = useVoiceRecorder()

  const autoStartMic = useCallback(() => {
    if (!micAvailable) return
    setUserInput('')
    toggleVoiceInput()
  }, [micAvailable, toggleVoiceInput])

  const speak = useCallback((text, { emotion, animation } = {}) => {
    return new Promise((resolve) => {
      if (!text) { resolve(); return }
      const head = headRef.current

      const startSpeaking = () => {
        if (head) {
          setNpcSpeaking(true)
          head.speakText(text)
          head.speakMarker(() => { setNpcSpeaking(false); resolve() })
          return
        }
        if (!window.speechSynthesis) { resolve(); return }
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.onstart = () => setNpcSpeaking(true)
        utterance.onend = () => { setNpcSpeaking(false); resolve() }
        utterance.onerror = () => { setNpcSpeaking(false); resolve() }
        window.speechSynthesis.speak(utterance)
      }

      // Reaction beat — only when there's a real emotion to react to (the
      // scripted opening line never passes one, so it always skips straight
      // to startSpeaking). Mood/gesture land first, silently, then a short
      // pause, then the line starts — "I heard you and I'm reacting" rather
      // than mood and speech firing in the same instant. Uses the real
      // emotion/animation the backend already returned; nothing invented.
      if (head && emotion) {
        head.setMood(EMOTION_TO_MOOD[emotion] ?? 'neutral')
        if (animation && animation !== 'idle') {
          const gesture = ANIMATION_TO_GESTURE[animation]
          if (gesture) head.playGesture(gesture)
        }
        if (prefersReducedMotion()) {
          startSpeaking()
          return
        }
        setNpcReacting(true)
        reactionTimeoutRef.current = setTimeout(() => {
          reactionTimeoutRef.current = null
          setNpcReacting(false)
          startSpeaking()
        }, REACTION_PAUSE_MS)
        return
      }

      startSpeaking()
    })
  }, [])

  const speakOpeningLine = useCallback(() => {
    if (openingSpokenRef.current) return
    openingSpokenRef.current = true
    speak(openingNpcLine).then(() => autoStartMic())
  }, [speak, openingNpcLine, autoStartMic])

  const handleSendWithText = useCallback(async (rawInput, deliverableLabel, turnKind) => {
    const input = (rawInput ?? '').trim()
    if (!input || isLoading || sessionComplete) return

    setSendError(null)
    setMessages((prev) => [...prev, { role: 'user', message: input, deliverableLabel, turnKind }])
    setUserInput('')
    setIsLoading(true)

    try {
      const response = await rpeService.sendTurn(sessionId, input)
      setCurrentTurn(response.turn)

      // Snapshot "going in" values before anything below overwrites them —
      // conversationIntelligenceV2 needs the real prior value to compute a
      // real direction, not the one we're about to set.
      const priorTrust = previousTrustRef.current
      const priorTension = previousTensionRef.current
      const priorClarity = previousClarityRef.current
      const priorNpcEmotion = previousNpcEmotionRef.current
      const priorNpcLines = npcLinesRef.current

      setLiveTrust(response.trust_score)
      // Real turn-over-turn direction, only once there's an actual prior
      // value to compare against — see previousTrustRef's own comment.
      if (priorTrust != null) setTrustDirection(computeDirection(priorTrust, response.trust_score))
      previousTrustRef.current = response.trust_score
      setLiveTension(response.escalation_level)
      previousTensionRef.current = response.escalation_level
      if (response.clarity_score != null) {
        setLiveClarity(response.clarity_score)
        previousClarityRef.current = response.clarity_score
      }
      previousNpcEmotionRef.current = response.emotion ?? priorNpcEmotion
      if (response.npc_response) npcLinesRef.current = [...npcLinesRef.current, response.npc_response]

      // conversationIntelligenceV2 — normalization + continuity only, see
      // that file's own header for exactly what is and isn't real here.
      const normalized = normalizeTurnResponse(response)
      setIntelligence((prev) => advanceIntelligence(prev, {
        normalized, turnNumber: response.turn,
        priorTrust, priorTension, priorClarity, priorNpcEmotion, priorNpcLines,
      }))

      setMessages((prev) => [...prev, { role: 'npc', message: response.npc_response, emotion: response.emotion }])

      if (response.session_complete) {
        integrateCompletedSession(analyticsService, sessionId)
        if (isAuthenticated && user?.id) {
          rpeService.notifySessionComplete(user.id, sessionId).catch(() => {})
        }

        completeNavStateRef.current = {
          sessionId,
          trustScore: response.trust_score,
          escalationLevel: response.escalation_level,
          outcome: response.outcome,
          endReason: response.end_reason,
          recommendedTurns, maxTurns, totalTurns, scenarioTitle, npcRole,
          npcName: npcDisplayName,
          currentTurn: response.turn,
        }

        await speak(response.npc_response, { emotion: response.emotion, animation: response.animation })

        setSessionComplete(true)
        setOutcome(response.outcome)
        setEndReason(response.end_reason)

        completeTimeoutRef.current = setTimeout(() => {
          navigate('/roleplay/session/complete', { state: completeNavStateRef.current })
        }, 2000)
      } else {
        await speak(response.npc_response, { emotion: response.emotion, animation: response.animation })
        const resolved = resolveInteraction(response)
        setInteraction(resolved)
        // Only 'normal' turns get the mic back — deliverable_choice/
        // content_request/direct_input render their own interaction UI
        // instead (see the voiceState/render section below), and STT is a
        // poor fit for dictating a document/filename/exact figures anyway.
        if (resolved.type === 'normal') autoStartMic()
      }
    } catch (err) {
      // Never fake an NPC reply for a transport/backend failure — the NPC
      // didn't say anything, so the optimistic user bubble we added above
      // (never actually acknowledged) comes back out of the transcript too,
      // and a subtle system-level notice + retry replaces it instead. For a
      // plain typed/voice message this restores the exact text so nothing
      // has to be retyped; a choice/content submission has no separate
      // "text" to restore, so this just returns them to the normal voice
      // dock rather than losing the whole turn silently.
      setMessages((prev) => prev.slice(0, -1))
      if (!turnKind) setUserInput(input)
      setSendError('Something went wrong sending your response.')
      console.error('[RPE] sendTurn failed:', err)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, sessionComplete, sessionId, speak, recommendedTurns, maxTurns, totalTurns, scenarioTitle, navigate, isAuthenticated, user, autoStartMic, npcRole, npcDisplayName])

  const handleRetrySend = useCallback(() => {
    setSendError(null)
    if (userInput.trim()) handleSendWithText(userInput)
  }, [userInput, handleSendWithText])

  // Does NOT clear `interaction` before sending, on purpose — if sendTurn
  // fails, the exact same 3 cards need to still be here to retry (see
  // ResponseChoiceCardsV2's submitFailed prop below); handleSendWithText's
  // own success path already replaces `interaction` with whatever the new
  // response resolves to, so a successful pick still transitions normally.
  const handleChooseOption = useCallback((option) => {
    handleSendWithText(option.text, option.label, 'choice')
  }, [handleSendWithText])

  // content_request/direct_input submit — same pipeline as a choice pick,
  // the only difference is where the text came from (the user typed/pasted
  // it themselves, not a suggested reply). CONTENT_TYPE_LABEL is a generic,
  // type-derived transcript tag ("Paragraph provided") — never a fabricated
  // specific title, since the frontend has no way to know what the content
  // actually is about. Same "don't clear interaction pre-emptively" reasoning
  // as handleChooseOption — a failed submit leaves the textarea's own typed
  // text untouched (ContentRequestInputV2 never unmounts) instead of losing it.
  const handleSubmitContent = useCallback((text) => {
    const label = CONTENT_TYPE_LABEL[interaction.contentType] || 'Content provided'
    handleSendWithText(text, label, 'content')
  }, [handleSendWithText, interaction.contentType])

  const handleViewFeedbackNow = () => {
    if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
    if (completeNavStateRef.current) navigate('/roleplay/session/complete', { state: completeNavStateRef.current })
  }

  const [nudgeShowMesh] = [showMesh]
  const {
    webcamRef, canvasRef, nudges, isCameraActive,
    toggleCamera, toggleMic, dismissNudge,
  } = useNudgeSensing({ persistMicConnection: true, showMesh: nudgeShowMesh })

  const handleToggleSensing = useCallback(() => {
    toggleCamera()
    toggleMic()
  }, [toggleCamera, toggleMic])

  useEffect(() => {
    setUserInput(liveTranscript)
  }, [liveTranscript])

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

  const handleSendClick = useCallback(() => {
    if (isListening) stopVoiceInput()
    handleSendWithText(userInput)
  }, [isListening, stopVoiceInput, handleSendWithText, userInput])

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
    window.dispatchEvent(new Event('ez:collapse-sidebar'))
    if (!sensingAutoStartedRef.current) {
      sensingAutoStartedRef.current = true
      handleToggleSensing()
    }

    if (recoveredTurns?.length) {
      const rebuilt = [{ role: 'npc', message: openingNpcLine }]
      for (const t of recoveredTurns) {
        rebuilt.push({ role: 'user', message: t.user_input })
        rebuilt.push({ role: 'npc', message: t.npc_response, emotion: t.emotion })
      }
      setMessages(rebuilt)
      setCurrentTurn(recoveredTurns.length)
      const lastRecoveredTurn = recoveredTurns[recoveredTurns.length - 1]
      setLiveTension(lastRecoveredTurn.escalation_level ?? 0)
      // Seed real baselines so direction arrows only ever reflect a turn
      // that actually happened after this page mounted — never a
      // comparison against history from before the recovery/reload.
      // clarity_score is never persisted per-turn (see
      // previousClarityRef's own comment) so there's nothing real to seed
      // it with here; it stays null until the next live turn, same as a
      // fresh session.
      previousTensionRef.current = lastRecoveredTurn.escalation_level ?? null
      previousNpcEmotionRef.current = lastRecoveredTurn.emotion ?? null
      npcLinesRef.current = recoveredTurns.map((t) => t.npc_response).filter(Boolean)
      if (recoveredTrustHistory?.length) {
        const recoveredTrust = recoveredTrustHistory[recoveredTrustHistory.length - 1]
        setLiveTrust(recoveredTrust)
        previousTrustRef.current = recoveredTrust
      }
      // user_behavior IS persisted per turn (unlike clarity_score/
      // interaction_type — see Backend/app/api/v1/rpe/router.py's turn_data
      // dict) — real data, safe to restore as the last known userIntent.
      if (lastRecoveredTurn.user_behavior) {
        setIntelligence((prev) => ({ ...prev, userIntent: lastRecoveredTurn.user_behavior }))
      }
      openingSpokenRef.current = true
    } else {
      setMessages([{ role: 'npc', message: openingNpcLine }])
    }

    if (!maxTurnsFromState) {
      rpeService.getSessionSummary(sessionId)
        .then((data) => {
          if (data.recommended_turns) setRecommendedTurns(data.recommended_turns)
          if (data.max_turns) setMaxTurns(data.max_turns)
        })
        .catch(() => {})
    }

    return () => {
      stopVoiceInput()
      if (window.speechSynthesis) window.speechSynthesis.cancel()
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
      if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lastNpcMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'npc') return messages[i].message
    }
    return null
  }, [messages])

  // Same idea as lastNpcMessage — real backend-provided emotion off the
  // latest npc turn, defaulting to 'neutral' (the opening line carries no
  // emotion field). Only consumed by SceneEnvironmentV2's atmosphere.
  const lastNpcEmotion = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'npc' && messages[i].emotion) return messages[i].emotion
    }
    return 'neutral'
  }, [messages])

  // isLoading now takes priority over interaction.type (used to be the
  // other way around) — a choice/content resubmission needs to actually
  // show "processing" instead of appearing to still be sitting on the
  // cards/textarea untouched. This is also what makes the failed-choice/
  // content retry work: handleChooseOption/handleSubmitContent no longer
  // clear `interaction` before sending, so on failure (isLoading back to
  // false, interaction untouched) voiceState naturally falls back to
  // 'choice'/'content' again — the exact same cards/input, not a fresh copy.
  const voiceState = sessionComplete
    ? 'complete'
    : npcSpeaking
      ? 'speaking'
      : npcReacting
        ? 'reacting'
        : isLoading
          ? 'processing'
          : interaction.type === 'deliverable_choice'
            ? 'choice'
            : interaction.type === 'content_request' || interaction.type === 'direct_input'
              ? 'content'
              : 'manual'

  // Which interaction panel renders — kept separate from voiceState/
  // conversationState (the STATE LABEL) on purpose: interaction.type is
  // what's actually pending, independent of whether a submission for it is
  // currently mid-flight. See the voiceState comment above for why.
  const showChoicePanel = interaction.type === 'deliverable_choice'
  const showContentPanel = interaction.type === 'content_request' || interaction.type === 'direct_input'

  // The single label ConversationStateIndicatorV2 shows — refines voiceState
  // with a couple of signals it doesn't carry (mic/transcript state) rather
  // than introducing a second state machine; 'manual' is the only bucket
  // that needs splitting further (ready vs listening vs transcribing vs a
  // captured-but-unsent response sitting in the box).
  const conversationState = voiceState === 'manual'
    ? (isListening ? 'listening' : isTranscribing ? 'transcribing' : userInput.trim() ? 'review' : 'ready')
    : voiceState === 'content'
      ? (interaction.type === 'direct_input' ? 'directInput' : 'content')
      : voiceState === 'complete'
        ? null
        : voiceState

  return (
    <div className="rps2-root" data-voice-state={voiceState}>
      <SessionTopBar
        duration={formatDuration(elapsedSeconds)}
        onBack={() => navigate('/roleplay')}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      <div className="rps2-stage" data-tension={liveTension >= 3 ? 'elevated' : undefined}>
        {ENABLE_CINEMATIC_ENVIRONMENT && (
          <SceneEnvironmentV2
            environmentId={environmentOverride || environmentId}
            npcEmotion={lastNpcEmotion}
            npcSpeaking={npcSpeaking}
            trust={liveTrust}
            tension={liveTension}
            sessionState={voiceState}
          />
        )}
        {/* Both debug panels used to render permanently over the scene in
            dev — exactly the "developer tools dominating the composition"
            the visual-composition pass flagged. Collapsed behind one small
            toggle now, closed by default; import.meta.env.DEV-gated same
            as the panels themselves, so in a production build this button
            doesn't render either — not just hidden, genuinely absent. */}
        {import.meta.env.DEV && (
          <button
            type="button"
            className="rps2-devtools-toggle"
            onClick={() => setDevToolsOpen((v) => !v)}
            aria-expanded={devToolsOpen}
          >
            Dev tools
          </button>
        )}
        {devToolsOpen && ENABLE_CINEMATIC_ENVIRONMENT && (
          <EnvironmentDebugPanel value={environmentOverride} onChange={setEnvironmentOverride} />
        )}
        {devToolsOpen && <ConversationIntelligenceDebugPanel intelligence={intelligence} />}

        <div className={cn('rps2-avatar-layer', npcSpeaking && 'rps2-speaking')}>
          <TalkingHeadAvatar
            onReady={(head) => { headRef.current = head; setAvatarReady(true); speakOpeningLine() }}
            onError={() => { setAvatarReady(true); speakOpeningLine() }}
            className="rps2-avatar-fill"
            avatarUrl={npcAvatar.url}
            avatarBody={npcAvatar.body}
            ttsVoice={npcAvatar.ttsVoice}
          />
        </div>

        {/* Consolidated scenario/NPC identity — replaces the old separate
            SessionTopBar title + this block's own npcDisplayName pairing.
            One compact top-left readout instead of two, per the visual-
            composition pass: scenario title first (what situation this is),
            then who/how-hard on a quieter second line. Real data throughout —
            nothing here is new, just regrouped. */}
        <div className="rps2-npc-identity">
          {npcProfileImage
            ? <img src={npcProfileImage} alt="" className="rps2-npc-photo" />
            : <span className="rps2-npc-photo-fallback">🧑‍💼</span>}
          <div className="rps2-npc-text">
            {scenarioTitle && <span className="rps2-scenario-title">{scenarioTitle}</span>}
            <span className="rps2-npc-role">
              {[npcRole || npcDisplayName, difficulty].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>

        <CoachingToggle active={isCameraActive} onToggle={handleToggleSensing} />

        {isCameraActive && (
          <UserCameraPreview
            webcamRef={webcamRef}
            canvasRef={canvasRef}
            showMesh={showMesh}
            onToggleMesh={() => setShowMesh((v) => !v)}
          />
        )}

        <CoachingNudge nudges={nudges} onDismiss={dismissNudge} />

        {voiceState === 'complete' && (
          <SessionCompleteOverlay
            trustScore={liveTrust}
            subtitle={END_REASON_SUB[endReason] || ''}
            onViewFeedback={handleViewFeedbackNow}
          />
        )}
      </div>

      {/* Scene -> response transition, as ONE group pulled up over the
          stage's own bottom fade (.rps2-stage::after) — the negative margin
          lives on this wrapper, not on the dialogue alone, so it overlaps
          the STAGE (removing the empty band the visual-composition pass
          flagged) without also overlapping the state indicator sitting
          right above the dialogue inside this same group. */}
      {voiceState !== 'complete' && (
        <div className="rps2-scene-transition">
          {/* One stable slot for "whose turn is it / what's happening" —
              always mounted here, so its own height never causes a layout
              jump as the label underneath changes turn to turn. */}
          <ConversationStateIndicatorV2
            state={conversationState}
            errorMessage={sendError}
            onRetry={handleRetrySend}
          />

          {/* Not an overlay on top of the avatar (that used to cover its
              lower body/hands) — visually connected to the scene edge
              instead via the wrapper's own overlap, while staying in
              normal flow below the stage. Face -> dialogue -> trust ->
              your response, the avatar's own framing never obscured
              regardless of how long the line runs.

              AnimatePresence lives here (not inside NPCDialogue itself) so
              it catches every reason the caption can disappear — the NPC
              line itself changing, session completion, or switching to a
              choice/content interaction — not just a text prop going
              empty. `key={currentTurn}` (the real turn number, not the
              text) retriggers the enter animation exactly once per turn,
              including the rare case where the backend genuinely repeats
              the same line verbatim. */}
          <AnimatePresence mode="wait">
            {!showChoicePanel && !showContentPanel && lastNpcMessage && (
              <NPCDialogue
                key={currentTurn}
                text={lastNpcMessage}
                npcName={npcDisplayName}
                npcEmotion={lastNpcEmotion}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {voiceState !== 'complete' && (
        <div className="rps2-panel">
          {showChoicePanel ? (
            <div className="rps2-panel-inner">
              <div className="rps2-choice-zone">
                <ResponseChoiceCardsV2
                  options={interaction.options}
                  onChoose={handleChooseOption}
                  submitFailed={!!sendError}
                />
              </div>
            </div>
          ) : showContentPanel ? (
            <div className="rps2-panel-inner">
              <div className="rps2-choice-zone">
                <ContentRequestInputV2
                  prompt={interaction.prompt}
                  contentType={interaction.contentType}
                  onSubmit={handleSubmitContent}
                  disabled={isLoading}
                  submitFailed={!!sendError}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="rps2-panel-inner rps2-trust-zone">
                <TrustIndicator value={liveTrust} direction={trustDirection} />
              </div>
              <VoiceDock
                userInput={userInput}
                onInputChange={setUserInput}
                inputRef={replyInputRef}
                isListening={isListening}
                isTranscribing={isTranscribing}
                micAvailable={micAvailable}
                usesLiveCaptions={usesLiveCaptions}
                onToggleMic={handleToggleMic}
                onSend={handleSendClick}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendWithText(userInput)
                  }
                }}
                isLoading={isLoading}
                disabled={voiceState !== 'manual'}
                lowConfidence={lowConfidence}
              />
            </>
          )}

          <div className="rps2-action-row">
            <button type="button" className="rps2-action-btn" onClick={handleToggleTranscript}>
              <MessageCircle size={14} strokeWidth={1.8} />
              Transcript
              {hasUnread && <span className="rps2-action-badge">•</span>}
            </button>
            <SessionSignals
              turn={currentTurn}
              maxTurns={maxTurns}
              tension={liveTension}
              clarity={liveClarity}
              failureEscalationThreshold={failureEscalationThreshold}
              tensionDirection={intelligence.relationshipImpact.tension}
              clarityDirection={intelligence.relationshipImpact.clarity}
            />
            <button
              type="button"
              className="rps2-action-btn danger"
              onClick={() => setEndConfirmOpen(true)}
              disabled={isLoading || sessionComplete}
            >
              End session
            </button>
          </div>
        </div>
      )}

      <ConversationReplayV2
        open={transcriptOpen}
        onClose={handleToggleTranscript}
        messages={messages}
        npcDisplayName={npcDisplayName}
        mode="live"
        isTyping={isLoading && !npcSpeaking}
      />

      {endConfirmOpen && (
        <EndConfirmModal
          onCancel={() => setEndConfirmOpen(false)}
          onConfirm={() => { setEndConfirmOpen(false); handleSendWithText('exit') }}
        />
      )}

      <SessionLoadingScreen scenarioTitle={scenarioTitle} npcRole={npcDisplayName} visible={!avatarReady} />
    </div>
  )
}

// Same recovery contract as RolePlaySession.jsx's own wrapper — deliberately
// re-implemented rather than imported (that wrapper isn't exported), but
// identical in behavior: a fresh navigate() with matching router state
// renders immediately, anything else (refresh, direct link, or returning to
// a session that already produced real turns) re-fetches from the backend.
// Uses the SAME sessionStorage key namespace as V1 on purpose — "has this
// session already gone live" is a property of the session, not of which UI
// is currently looking at it, so switching between V1/V2 on the same
// session_id must not let a stale fast-path wipe the transcript either way.
export default function RolePlaySessionV2() {
  const { sessionId: sessionIdParam } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const alreadyLive = !!sessionIdParam && sessionStorage.getItem(`rpe-session-live:${sessionIdParam}`) === '1'
  const freshNavState = !alreadyLive && location.state?.sessionId === sessionIdParam ? location.state : null

  useEffect(() => {
    if (sessionIdParam) sessionStorage.setItem(`rpe-session-live:${sessionIdParam}`, '1')
  }, [sessionIdParam])

  // Full immersion — hide the app's own sidebar and topbar for the whole
  // time this route is mounted (loading/recovery states included, not just
  // once the live conversation is up), so the avatar and conversation get
  // the entire screen with nothing competing for attention. Reverts itself
  // the moment this page unmounts (route change away), regardless of which
  // branch below was rendering. AppLayout's own ez:collapse-sidebar
  // listener (V1's mechanism) is untouched — this is a separate event.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ez:immersive-mode', { detail: true }))
    return () => window.dispatchEvent(new CustomEvent('ez:immersive-mode', { detail: false }))
  }, [])

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
          navigate(`/roleplay/feedback/${sessionIdParam}`, { replace: true })
          return
        }
        const scenario = await rpeService.getScenarioDetail(session.scenario_id)
        if (cancelled) return

        setRecovered({
          turns: session.turns || [],
          trustHistory: session.trust_history || [],
          navState: {
            sessionId: sessionIdParam,
            openingNpcLine: session.opening_npc_line,
            scenarioTitle: scenario.title,
            difficulty: scenario.difficulty,
            totalTurns: session.recommended_turns ?? scenario.recommended_turns,
            recommendedTurns: session.recommended_turns ?? scenario.recommended_turns,
            maxTurns: session.max_turns ?? scenario.max_turns,
            npcRole: scenario.npc_role,
            npcGender: scenario.npc_gender,
            npcName: session.npc_name,
            failureEscalationThreshold: scenario.end_conditions?.failure_escalation_threshold,
            category: scenario.category,
            conflictType: scenario.conflict_type,
            context: scenario.context,
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
    return <RolePlaySessionV2Inner navState={freshNavState} />
  }

  if (recoveryError) {
    return (
      <div className="rps2-recover">
        <p className="rps2-recover-title">We couldn't reconnect to this session</p>
        <p className="rps2-recover-sub">{recoveryError}</p>
        <button type="button" onClick={() => navigate('/roleplay')} className="rps2-recover-btn">
          Back to Practice Lab
        </button>
      </div>
    )
  }

  if (!recovered) {
    return <SessionLoadingScreen scenarioTitle="Reconnecting to your session…" visible />
  }

  return (
    <RolePlaySessionV2Inner
      navState={recovered.navState}
      recoveredTurns={recovered.turns}
      recoveredTrustHistory={recovered.trustHistory}
    />
  )
}
