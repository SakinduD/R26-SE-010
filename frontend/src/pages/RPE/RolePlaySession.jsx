import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Send, Loader2, ShieldAlert } from 'lucide-react'
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
        height: 'calc(100vh - 3.5rem)',
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

        {/* Turn counter */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            flexShrink: 0,
          }}
        >
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
                disabled={isLoading || sessionComplete}
                placeholder="Type your response… (Enter to send, Shift+Enter for newline)"
                className={cn('input', 'textarea')}
                style={{ flex: 1, minHeight: 64, padding: 12, lineHeight: 1.5 }}
              />
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
