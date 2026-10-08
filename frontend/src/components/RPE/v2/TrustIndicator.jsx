import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const DIRECTION_META = {
  up:   { Icon: TrendingUp, label: 'Trust improving' },
  down: { Icon: TrendingDown, label: 'Trust under pressure' },
  flat: { Icon: Minus, label: 'Trust holding' },
}

// A compact relationship readout, not a progress-bar/dashboard meter —
// "TRUST 42 ↑" rather than a labeled track with a sliding node. Real value
// from the same backend field V1 already uses (liveTrust), nothing
// fabricated. `direction` ('up'|'down'|'flat'|null) is real too —
// RolePlaySessionV2.jsx tracks the trust value from the PREVIOUS turn in a
// ref and only sets a direction once there's an actual prior turn to
// compare against (null on the very first turn / right after a session
// recovery, so this never shows an interpretation the data doesn't
// support). No count-up number animation here on purpose — that flourish
// belongs to SessionComplete's one-time reveal, not a value that updates
// every turn; the number just changes, with a brief color pulse on the
// figure itself so a real change still reads as a real change.
export default function TrustIndicator({ value, direction }) {
  const meta = direction ? DIRECTION_META[direction] : null

  return (
    <div className="rps2-trust-compact" aria-label={`Trust ${value} out of 100${meta ? `, ${meta.label}` : ''}`}>
      <span className="rps2-trust-compact-label">Trust</span>
      <span className="rps2-trust-compact-value">{value}</span>
      {meta && (
        <span className={`rps2-trust-compact-dir ${direction}`} title={meta.label}>
          <meta.Icon size={13} strokeWidth={2.4} aria-hidden />
        </span>
      )}
    </div>
  )
}
