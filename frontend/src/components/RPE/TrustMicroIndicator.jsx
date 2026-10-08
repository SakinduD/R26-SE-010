import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const DIRECTION_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus }

// Compact, single-turn trust readout for ConversationReplayV2's replay
// mode — NOT a chart, just a value (and, when the caller has the prior
// turn's real value too, a "before → after" delta). `value`/`previous`/
// `direction` all come straight from the backend's own
// viz_payload.trust_curve / trust_deltas (same real fields
// FeedbackDashboard's TrustJourney chart already uses) — this component
// never computes or guesses any of them; if `previous` isn't available it
// just shows the current value, never a fabricated delta.
export default function TrustMicroIndicator({ value, previous, direction }) {
  if (value == null) return null
  const Icon = DIRECTION_ICON[direction] || Minus
  const delta = previous != null ? value - previous : null

  return (
    <div className={`crv2-trust-micro ${direction || ''}`}>
      <span className="crv2-trust-micro-label">Trust</span>
      {delta != null ? (
        <span className="crv2-trust-micro-delta">
          {previous} <span className="crv2-trust-micro-arrow">→</span> {value}
          <span className="crv2-trust-micro-change">
            <Icon size={11} strokeWidth={2.2} />
            {delta > 0 ? '+' : ''}{delta}
          </span>
        </span>
      ) : (
        <span className="crv2-trust-micro-val">
          <Icon size={11} strokeWidth={2.2} />
          {value}
        </span>
      )}
    </div>
  )
}
