import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Send, Loader2, ShieldAlert } from 'lucide-react'
import ChatBubble from '@/components/RPE/ChatBubble'
import MetricsHUD from '@/components/RPE/MetricsHUD'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'

const computeNpcTone = (trust) =>
  trust >= 70 ? 'cooperative' : trust >= 40 ? 'neutral' : 'hostile'

const computeEscalationTone = (level) =>
  level >= 4 ? 'furious' : level >= 2 ? 'irritated' : 'controlled'

const DIFFICULTY_STYLES = {
  beginner:     'bg-emerald-100 text-emerald-700',
  intermediate: 'bg-amber-100 text-amber-700',
  advanced:     'bg-red-100 text-red-700',
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

  const bottomRef   = useRef(null)
  const textareaRef = useRef(null)

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

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

  const turnLabelColor = (() => {
    if (!maxTurns || currentTurn < recommendedTurns) return 'text-muted-foreground'
    if (currentTurn < maxTurns) return 'text-amber-500'
    return 'text-red-500'
  })()

  /* ── escalation warning threshold ──────────────────────── */
  const warnAt = failureEscalationThreshold != null
    ? Math.max(1, failureEscalationThreshold - 2)
    : 3

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="shrink-0 bg-card border-b border-border px-6 py-3 flex items-center gap-3 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="font-bold text-foreground truncate">{scenarioTitle}</h1>
          {difficulty && (
            <span className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
              DIFFICULTY_STYLES[difficulty] ?? 'bg-muted text-muted-foreground'
            )}>
              {difficulty}
            </span>
          )}
        </div>

        {/* Turn counter */}
        <div className="ml-auto shrink-0 flex flex-col items-end">
          {currentTurn === 0
            ? <span className="text-muted-foreground text-sm">Not started</span>
            : <span className="text-sm font-bold text-foreground tabular-nums">Turn {currentTurn}</span>
          }
          {currentTurn > 0 && (
            <span className={cn('text-xs tabular-nums', turnLabelColor)}>
              {turnLabel}
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Chat column */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Messages scroll area */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar">
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

            {/* NPC typing indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-900 border border-slate-700/60 rounded-2xl px-4 py-3 shadow-md">
                  <span className="flex gap-1.5 items-center">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Session complete banners */}
          {sessionComplete && endReason === 'trust_sustained' && (
            <div className="mx-6 mb-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm font-semibold text-emerald-700">
              You built strong trust — the situation has been resolved!
            </div>
          )}
          {sessionComplete && endReason === 'npc_exit' && (
            <div className="mx-6 mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold text-red-700">
              The conversation broke down — the NPC ended the session.
            </div>
          )}
          {sessionComplete && endReason === 'max_turns_reached' && (
            <div className={cn(
              'mx-6 mb-3 rounded-xl px-4 py-3 text-sm font-semibold border',
              outcome === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-amber-50 border-amber-200 text-amber-700'
            )}>
              {outcome === 'success'
                ? 'Session complete — well handled!'
                : 'Maximum turns reached — review your feedback.'}
            </div>
          )}

          {/* Escalation warning banner */}
          <div className={cn(
            'mx-6 overflow-hidden transition-all duration-300',
            escalationLevel >= warnAt ? 'max-h-16 mb-2' : 'max-h-0'
          )}>
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-red-600 font-medium">
              <ShieldAlert size={15} className="shrink-0" />
              Tension is rising. Try to de-escalate your response.
            </div>
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-border bg-card px-6 py-4">
            <div className="flex gap-3 items-end">
              <textarea
                ref={textareaRef}
                rows={2}
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || sessionComplete}
                placeholder="Type your response… (Enter to send, Shift+Enter for newline)"
                className="flex-1 resize-none rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!userInput.trim() || isLoading || sessionComplete}
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-primary/25"
              >
                {isLoading
                  ? <Loader2 size={16} className="animate-spin" />
                  : <Send size={16} />
                }
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="hidden md:flex w-72 shrink-0 flex-col gap-4 border-l border-border bg-card overflow-y-auto p-4 custom-scrollbar">
          <MetricsHUD
            trustScore={trustScore}
            escalationLevel={escalationLevel}
            emotion={currentEmotion}
            trustDelta={trustDelta}
            npcTone={npcTone}
            escalationTone={escalationTone}
            failureEscalationThreshold={failureEscalationThreshold}
          />

          {/* Session info card */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-4 pt-3 pb-2.5 bg-gradient-to-r from-secondary/8 to-transparent border-b border-border/60">
              <p className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Session Info</p>
            </div>
            <dl className="p-4 space-y-3">
              {[
                ['Scenario',  scenarioTitle],
                ['NPC Role',  npcRole],
                ['Conflict',  conflictType],
                ['Progress',  currentTurn === 0 ? 'Not started' : `Turn ${currentTurn} of ${recommendedTurns}`],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <dt className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</dt>
                  <dd className="text-sm text-foreground font-medium">{value}</dd>
                </div>
              ))}
              {maxTurns && (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Max turns</dt>
                  <dd className="text-sm text-muted-foreground">{maxTurns} (hard cap)</dd>
                </div>
              )}
            </dl>
          </div>
        </aside>

      </div>
    </div>
  )
}
