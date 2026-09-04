import { useState } from 'react'
import { Gauge, TrendingUp, TrendingDown, Minus } from 'lucide-react'

const DIRECTION_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus }

// Small direction glyph next to a signal value — real, derived from the
// same conversationIntelligenceV2.relationshipImpact this-turn-vs-last-turn
// comparison TrustIndicator already uses, just applied to tension/clarity
// too. null (no icon at all) whenever there's no real prior value to
// compare against yet, same as trust's own direction indicator.
function DirectionGlyph({ direction }) {
  const Icon = direction && DIRECTION_ICON[direction]
  if (!Icon) return null
  return <Icon size={11} strokeWidth={2.2} aria-hidden style={{ marginLeft: 4, verticalAlign: -1 }} />
}

// Turn count, Tension, and Clarity — real, all secondary to Trust (which
// stays permanently visible via TrustIndicator). Section 10/11 of the
// redesign spec: tension gets a subtle environmental cue on the stage
// already (see RolePlaySessionV2.jsx's data-tension attribute) but still
// needs an actual readable value somewhere, and clarity should sit behind
// a small "Signals" control rather than a permanent dashboard meter. Turn
// count lives here too rather than its own separate UI element, for the
// same "keep it secondary" reason. Values are exactly what V1 already
// tracks (turn/maxTurns/liveTension/liveClarity) — nothing computed here.
export default function SessionSignals({
  turn, maxTurns, tension, clarity, failureEscalationThreshold,
  tensionDirection, clarityDirection,
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rps2-signals-wrap">
      <button
        type="button"
        className="rps2-action-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Gauge size={14} strokeWidth={1.8} />
        Signals
      </button>

      {open && (
        <div className="rps2-signals-popover" role="dialog" aria-label="Session signals">
          <p className="rps2-coaching-title">Session signals</p>
          <div className="rps2-signal-row">
            <span className="rps2-signal-label">Turn</span>
            <span className="rps2-signal-val">{turn}{maxTurns ? ` / ${maxTurns}` : ''}</span>
          </div>
          <div className="rps2-signal-row">
            <span className="rps2-signal-label">Tension</span>
            <span className="rps2-signal-val">{tension} / 5<DirectionGlyph direction={tensionDirection} /></span>
          </div>
          {failureEscalationThreshold != null && (
            <p className="rps2-coaching-desc" style={{ margin: '2px 0 0' }}>
              NPC exits at {failureEscalationThreshold}/5 tension
            </p>
          )}
          {clarity != null && (
            <div className="rps2-signal-row">
              <span className="rps2-signal-label">Clarity</span>
              <span className="rps2-signal-val">{clarity} / 10<DirectionGlyph direction={clarityDirection} /></span>
            </div>
          )}
          <p className="rps2-coaching-desc" style={{ marginTop: 10, marginBottom: 0 }}>
            Coaching signals to guide you, not a strict grade.
          </p>
        </div>
      )}
    </div>
  )
}
