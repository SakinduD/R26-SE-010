import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Send, Loader2 } from 'lucide-react'
import ChatBubble from '@/components/RPE/ChatBubble'
import MetricsHUD from '@/components/RPE/MetricsHUD'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'

const computeNpcTone = (trust) =>
  trust >= 70 ? 'cooperative' : trust >= 40 ? 'neutral' : 'hostile'

const computeEscalationTone = (level) =>
  level >= 4 ? 'furious' : level >= 2 ? 'irritated' : 'controlled'

export default function RolePlaySession() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, openingNpcLine, scenarioTitle, difficulty,
    conflictType, totalTurns, npcRole,
    recommendedTurns: recommendedTurnsFromState,
    maxTurns:         maxTurnsFromState,
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

  // Phase 2 state
  const [trustDelta, setTrustDelta]         = useState(null)
  const [npcTone, setNpcTone]               = useState('hostile')
  const [escalationTone, setEscalationTone] = useState('controlled')
  const [previousTrust, setPreviousTrust]   = useState(50)

  // Dynamic turn limits — populated from session summary on mount
  const [recommendedTurns, setRecommendedTurns] = useState(
    recommendedTurnsFromState || totalTurns || 6
  )
  const [maxTurns, setMaxTurns] = useState(maxTurnsFromState || null)

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    setMessages([{ role: 'npc', message: openingNpcLine, npcTone: 'hostile' }])
    // Fetch session config to get max_turns (not in nav state from ScenarioSelect)
    if (!maxTurnsFromState) {
      rpeService.getSessionSummary(sessionId)
        .then((data) => {
          if (data.recommended_turns) setRecommendedTurns(data.recommended_turns)
          if (data.max_turns)         setMaxTurns(data.max_turns)
        })
        .catch(() => {}) // degrade gracefully — UI still works without max_turns
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

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <h1 className="font-semibold text-gray-900 truncate">{scenarioTitle}</h1>
        <span className={cn(
          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
          difficulty === 'beginner'     ? 'bg-green-100 text-green-700'   :
          difficulty === 'intermediate' ? 'bg-yellow-100 text-yellow-700' :
                                          'bg-red-100 text-red-700'
        )}>
          {difficulty}
        </span>

        {/* Turn counter — dynamic with context */}
        <div className="ml-auto shrink-0 flex flex-col items-end">
          <span className="text-sm font-semibold text-gray-700">
            Turn {currentTurn}
          </span>
          <span className={cn(
            'text-xs',
            !maxTurns || currentTurn < recommendedTurns
              ? 'text-gray-400'
              : currentTurn < maxTurns
                ? 'text-yellow-500'
                : 'text-red-500'
          )}>
            {!maxTurns
              ? `Recommended: ${recommendedTurns} turns`
              : currentTurn < recommendedTurns
                ? `Recommended: ${recommendedTurns} turns`
                : currentTurn < maxTurns
                  ? `Extended — Max: ${maxTurns} turns`
                  : 'Final turns ⚠'}
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Chat column */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Messages scroll area */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
                <div className="bg-gray-800 rounded-2xl px-4 py-3 border-l-4 border-gray-300">
                  <span className="flex gap-1 items-center">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* End-reason-aware session complete banners */}
          {sessionComplete && endReason === 'trust_sustained' && (
            <div className="mx-6 mb-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm font-medium text-green-700">
              🎉 You built strong trust — the situation has been resolved!
            </div>
          )}
          {sessionComplete && endReason === 'npc_exit' && (
            <div className="mx-6 mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-medium text-red-700">
              💢 The conversation broke down — the NPC ended the session.
            </div>
          )}
          {sessionComplete && endReason === 'max_turns_reached' && (
            <div className={cn(
              'mx-6 mb-3 rounded-xl px-4 py-3 text-sm font-medium border',
              outcome === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-yellow-50 border-yellow-200 text-yellow-700'
            )}>
              {outcome === 'success'
                ? '✅ Session complete — well handled!'
                : '⏱ Maximum turns reached — review your feedback.'}
            </div>
          )}

          {/* Escalation warning banner */}
          <div className={cn(
            'mx-6 overflow-hidden transition-all duration-300',
            escalationLevel >= 3 ? 'max-h-16 mb-2' : 'max-h-0'
          )}>
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
              ⚠ Tension is rising. Try to de-escalate your response.
            </div>
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4">
            <div className="flex gap-3 items-end">
              <textarea
                ref={textareaRef}
                rows={2}
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || sessionComplete}
                placeholder="Type your response… (Enter to send, Shift+Enter for newline)"
                className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleSend}
                disabled={!userInput.trim() || isLoading || sessionComplete}
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading
                  ? <Loader2 size={16} className="animate-spin" />
                  : <Send size={16} />
                }
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar — hidden on mobile */}
        <aside className="hidden md:flex w-72 shrink-0 flex-col gap-4 border-l border-gray-200 bg-white overflow-y-auto p-4">
          <MetricsHUD
            trustScore={trustScore}
            escalationLevel={escalationLevel}
            emotion={currentEmotion}
            trustDelta={trustDelta}
            npcTone={npcTone}
            escalationTone={escalationTone}
          />

          {/* Session info */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Session Info
            </h3>
            <dl className="space-y-1.5 text-sm">
              {[
                ['Scenario',    scenarioTitle],
                ['NPC Role',    npcRole],
                ['Conflict',    conflictType],
                ['Progress',    `Turn ${currentTurn} of ${recommendedTurns}`],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-xs text-gray-400">{label}</dt>
                  <dd className="text-gray-700 font-medium">{value}</dd>
                </div>
              ))}
              {maxTurns && (
                <div className="flex flex-col">
                  <dt className="text-xs text-gray-400">Max turns</dt>
                  <dd className="text-gray-500 text-xs">{maxTurns} (hard cap)</dd>
                </div>
              )}
            </dl>
          </div>
        </aside>

      </div>
    </div>
  )
}
