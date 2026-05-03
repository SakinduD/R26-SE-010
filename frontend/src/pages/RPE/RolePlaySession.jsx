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
  } = location.state || {}

  const bottomRef    = useRef(null)
  const textareaRef  = useRef(null)

  const [messages, setMessages]             = useState([])
  const [userInput, setUserInput]           = useState('')
  const [trustScore, setTrustScore]         = useState(50)
  const [escalationLevel, setEscalationLevel] = useState(0)
  const [currentEmotion, setCurrentEmotion] = useState('calm')
  const [currentTurn, setCurrentTurn]       = useState(0)
  const [isLoading, setIsLoading]           = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [outcome, setOutcome]               = useState(null)

  // Phase 2 state
  const [trustDelta, setTrustDelta]           = useState(null)
  const [npcTone, setNpcTone]                 = useState('hostile')
  const [escalationTone, setEscalationTone]   = useState('controlled')
  const [previousTrust, setPreviousTrust]     = useState(50)

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    setMessages([{ role: 'npc', message: openingNpcLine, npcTone: 'hostile' }])
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

      const delta    = response.trust_score - previousTrust
      const newTone  = computeNpcTone(response.trust_score)
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
          emotion: response.emotion,
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
        setTimeout(() => {
          navigate('/roleplay/session/complete', {
            state: {
              sessionId,
              trustScore:      response.trust_score,
              escalationLevel: response.escalation_level,
              outcome:         response.outcome,
              totalTurns,
              scenarioTitle,
              currentTurn:     response.turn,
            },
          })
        }, 1500)
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
        <span className="ml-auto shrink-0 text-sm text-gray-400 tabular-nums">
          Turn {currentTurn} / {totalTurns}
        </span>
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

          {/* Session complete banner */}
          {sessionComplete && (
            <div className={cn(
              'mx-6 mb-3 rounded-lg px-4 py-3 text-sm font-medium text-center border',
              outcome === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-700'
            )}>
              {outcome === 'success'
                ? '🎉 Session Complete — Success!'
                : 'Session Complete — Keep Practicing!'}
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
                ['Scenario',  scenarioTitle],
                ['NPC Role',  npcRole],
                ['Conflict',  conflictType],
                ['Progress',  `Turn ${currentTurn} of ${totalTurns}`],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-xs text-gray-400">{label}</dt>
                  <dd className="text-gray-700 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>

      </div>
    </div>
  )
}
