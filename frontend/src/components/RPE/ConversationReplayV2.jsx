import { useEffect, useRef, useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ConversationTurnV2 from './ConversationTurnV2'
import './ConversationReplayV2.css'

/*
 * ConversationReplayV2 — isolated redesign of the RPE transcript.
 *
 * NEW, standalone component. Does not modify or replace the transcript
 * markup already inline in RolePlaySession.jsx (V1). Drop-in props-
 * compatible with both live sessions and (once wired up) the post-session
 * feedback screen.
 *
 * Two modes, same data:
 *   live   — during the role-play. Conversational only, no scoring exposed.
 *   replay — after the session. Adds turn markers/trust ONLY where the
 *            caller actually supplies real per-turn metadata (`turnMeta`) —
 *            never inferred from message text here. With no turnMeta, replay
 *            mode renders identically to a clean transcript.
 *
 * `messages` keeps the exact existing shape, plus one new optional field:
 *   { role: 'npc' | 'user', message, emotion, deliverableLabel, turnKind }
 * turnKind ('handoff' | 'content') only matters together with
 * deliverableLabel — it picks which kicker ConversationTurnV2 shows
 * ("Handoff" vs "Content provided"), see RolePlaySessionV2.jsx's
 * handleSendWithText for where it's set.
 *
 * `turnMeta` (optional, replay only) keyed by turn number (1-based — turn N
 * is "the NPC line the user was responding to" + "the user's Nth reply",
 * matching the backend's own `turn` field and turn_metrics indexing exactly:
 * turn_metrics[N-1] describes the same user reply that display-turn N shows).
 *   {
 *     trust: number,                 // viz_payload.trust_curve[n].value
 *     direction: 'up'|'down'|'flat', // viz_payload.trust_deltas[n-1].direction
 *     flags: string[],               // turn_metrics[n-1].flags
 *     explanation: string,           // optional — only if the caller has real text
 *   }
 */

// Real flag vocabulary -> display marker. Source: rpe_nlp_service.py's
// PASSIVE_KEYWORDS/AGGRESSIVE_KEYWORDS/too_short/too_long flags, and the
// LLM-assigned userBehavior taxonomy (rpe_llm_service.UserBehaviorLabel),
// surfaced as turn_metrics[].flags in the form "passive" | "aggressive" |
// "too_short" | "too_long" | "behavior:<label>". Nothing here is guessed —
// this only relabels values the backend already produced.
const FLAG_MARKERS = {
  passive: { symbol: '⚠', tone: 'warning', text: 'Read as passive' },
  aggressive: { symbol: '⚠', tone: 'danger', text: 'Read as aggressive' },
  too_short: { symbol: '⚠', tone: 'neutral', text: 'Very short reply' },
  too_long: { symbol: '⚠', tone: 'neutral', text: 'Ran long' },
  'behavior:assertive_statement': { symbol: '✓', tone: 'success', text: 'Clear position stated' },
  'behavior:proposal': { symbol: '✓', tone: 'success', text: 'Concrete proposal' },
  'behavior:acknowledgment': { symbol: '✓', tone: 'success', text: 'Acknowledged their point' },
  'behavior:de_escalation': { symbol: '↘', tone: 'success', text: 'De-escalated' },
  'behavior:clarifying_question': { symbol: '?', tone: 'neutral', text: 'Asked a clarifying question' },
  'behavior:concession': { symbol: '→', tone: 'neutral', text: 'Conceded ground' },
  'behavior:deflection': { symbol: '⚠', tone: 'warning', text: 'Deflected the question' },
  'behavior:escalation': { symbol: '⚠', tone: 'danger', text: 'Escalated tension' },
}

function markersFor(flags) {
  if (!Array.isArray(flags)) return []
  return flags.map((f) => FLAG_MARKERS[f]).filter(Boolean)
}

// Pairs messages as [npc(i), user(i+1)] -> turn i/2+1. The opening NPC line
// is messages[0], so it becomes Turn 1's NPC side alongside the user's
// first reply — no more separate, unnumbered "intro" block. Each
// following turn's NPC line is the *reaction* to the previous turn's user
// reply, which simultaneously reads as that new turn's opening line —
// exactly the "NPC / YOU, NPC / YOU" alternation the redesign asked for,
// and it falls out of the existing message order for free.
function groupIntoTurns(messages, isTyping) {
  const turns = []
  let turnNumber = 1
  for (let i = 0; i < messages.length; i += 2) {
    const npc = messages[i]?.role === 'npc' ? messages[i] : null
    const user = messages[i + 1]?.role === 'user' ? messages[i + 1] : null
    if (!npc && !user) continue
    turns.push({ turnNumber, npc, user })
    turnNumber += 1
  }
  if (isTyping) {
    turns.push({ turnNumber, npc: null, user: null, typing: true })
  }
  return turns
}

export default function ConversationReplayV2({
  open, onClose, messages, npcDisplayName,
  mode = 'live', turnMeta, isTyping,
}) {
  const bodyRef = useRef(null)
  const bottomRef = useRef(null)
  const isNearBottomRef = useRef(true)
  const turnRefs = useRef({})
  const [newCount, setNewCount] = useState(0)
  const [selectedTurn, setSelectedTurn] = useState(null)
  const [highlightedTurn, setHighlightedTurn] = useState(null)

  const isReplay = mode === 'replay'
  const turns = useMemo(() => groupIntoTurns(messages || [], isTyping), [messages, isTyping])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    isNearBottomRef.current = true
    setNewCount(0)
  }

  // Same "don't yank the reader back down" behavior as before, now with a
  // single running counter instead of a plain pill — one indicator for the
  // whole drawer, never one per turn.
  const prevMessageCount = useRef(messages?.length || 0)
  useEffect(() => {
    if (!open) return
    const grew = (messages?.length || 0) > prevMessageCount.current
    prevMessageCount.current = messages?.length || 0
    if (isNearBottomRef.current) {
      scrollToBottom()
    } else if (grew) {
      setNewCount((n) => n + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messages?.length, isTyping])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    isNearBottomRef.current = nearBottom
    if (nearBottom) setNewCount(0)
  }

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Real per-turn trust points, only when the caller actually supplied at
  // least two — a single number never becomes a fabricated trajectory.
  const trustPoints = useMemo(() => {
    if (!isReplay || !turnMeta) return []
    return turns
      .filter((t) => turnMeta[t.turnNumber]?.trust != null)
      .map((t) => ({ turn: t.turnNumber, value: turnMeta[t.turnNumber].trust }))
  }, [isReplay, turnMeta, turns])

  // Important Moments — derived straight from the same real turnMeta flags
  // already used for inline markers, never a separate guess.
  const importantMoments = useMemo(() => {
    if (!isReplay || !turnMeta) return []
    const out = []
    turns.forEach((t) => {
      const markers = markersFor(turnMeta[t.turnNumber]?.flags)
      if (markers.length > 0) out.push({ turn: t.turnNumber, marker: markers[0] })
    })
    return out
  }, [isReplay, turnMeta, turns])

  const jumpToTurn = (turnNumber) => {
    setSelectedTurn(turnNumber)
    setHighlightedTurn(turnNumber)
    turnRefs.current[turnNumber]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setTimeout(() => setHighlightedTurn((v) => (v === turnNumber ? null : v)), 1400)
  }

  if (!open) return null

  return (
    <>
      <div className="crv2-backdrop" onClick={onClose} />
      <div className="crv2-drawer" role="dialog" aria-label={isReplay ? 'Conversation replay' : 'Conversation'}>
        <div className="crv2-header">
          <div>
            <div className="crv2-title-row">
              <p className="crv2-title">{isReplay ? 'Conversation Replay' : 'Conversation'}</p>
              <span className={cn('crv2-mode-badge', isReplay && 'replay')}>{isReplay ? 'Replay' : 'Live'}</span>
            </div>
            <p className="crv2-subtitle">{turns.filter((t) => !t.typing).length} turn{turns.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" className="crv2-close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {isReplay && trustPoints.length >= 2 && (
          <TrustSparkline points={trustPoints} onJump={jumpToTurn} />
        )}

        {isReplay && importantMoments.length > 0 && (
          <div className="crv2-moments">
            <p className="crv2-moments-label">Important moments</p>
            <div className="crv2-moments-list">
              {importantMoments.map(({ turn, marker }) => (
                <button
                  key={turn}
                  type="button"
                  className={cn('crv2-moment', marker.tone)}
                  onClick={() => jumpToTurn(turn)}
                >
                  {marker.symbol} {marker.text} — Turn {turn}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="crv2-body" ref={bodyRef} onScroll={handleScroll}>
          <div className="crv2-timeline">
            {turns.map((t) => {
              const meta = turnMeta?.[t.turnNumber]
              const prevMeta = turnMeta?.[t.turnNumber - 1]
              const markers = isReplay ? markersFor(meta?.flags) : []
              return (
                <ConversationTurnV2
                  key={t.turnNumber}
                  ref={(el) => { turnRefs.current[t.turnNumber] = el }}
                  turnNumber={t.typing ? null : t.turnNumber}
                  userMessage={t.user?.message}
                  deliverableLabel={t.user?.deliverableLabel}
                  turnKind={t.user?.turnKind}
                  npcMessage={t.npc?.message}
                  npcEmotion={t.npc?.emotion}
                  npcName={npcDisplayName}
                  mode={mode}
                  markers={markers}
                  trust={isReplay ? meta?.trust : undefined}
                  previousTrust={isReplay ? prevMeta?.trust : undefined}
                  direction={isReplay ? meta?.direction : undefined}
                  explanation={isReplay ? meta?.explanation : undefined}
                  selectable={isReplay && !!meta}
                  selected={isReplay && selectedTurn === t.turnNumber}
                  highlighted={highlightedTurn === t.turnNumber}
                  onSelect={() => setSelectedTurn((v) => (v === t.turnNumber ? null : t.turnNumber))}
                  isTyping={!!t.typing}
                />
              )
            })}

            <div ref={bottomRef} />
          </div>
        </div>

        <button
          type="button"
          className={cn('crv2-scroll-pill', newCount > 0 && 'show')}
          onClick={scrollToBottom}
        >
          ↓ {newCount > 1 ? `${newCount} new messages` : 'New message'}
        </button>
      </div>
    </>
  )
}

// Small clickable trust trajectory across replayed turns — not a full
// chart, just enough shape to answer "where did this move." Only rendered
// by the caller when at least 2 real points exist (see trustPoints above).
function TrustSparkline({ points, onJump }) {
  const width = 100
  const height = 28
  const minV = Math.min(...points.map((p) => p.value), 0)
  const maxV = Math.max(...points.map((p) => p.value), 100)
  const span = Math.max(1, maxV - minV)
  const step = points.length > 1 ? width / (points.length - 1) : 0
  const coords = points.map((p, i) => ({
    ...p,
    x: i * step,
    y: height - ((p.value - minV) / span) * height,
  }))
  const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ')

  return (
    <div className="crv2-spark-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="crv2-spark-svg" preserveAspectRatio="none" aria-hidden>
        <path d={d} fill="none" stroke="var(--crv2-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="crv2-spark-points">
        {coords.map((c) => (
          <button
            key={c.turn}
            type="button"
            className="crv2-spark-point"
            style={{ left: `${(c.x / width) * 100}%` }}
            onClick={() => onJump(c.turn)}
            aria-label={`Jump to turn ${c.turn}, trust ${c.value}`}
            title={`Turn ${c.turn} · Trust ${c.value}`}
          />
        ))}
      </div>
      <div className="crv2-spark-ends">
        <span>{points[0].value}</span>
        <span>{points[points.length - 1].value}</span>
      </div>
    </div>
  )
}
