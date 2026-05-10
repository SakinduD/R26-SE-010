// REDESIGN: bg-white/bg-gray/bg-red/bg-yellow → semantic tokens (dark-mode safe)
import { CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const SEVERITY_CARD = {
  high:   'border-danger/20 bg-danger/5',
  medium: 'border-warning/20 bg-warning/5',
  low:    'border-border bg-muted/30',
}

const SEVERITY_PILL = {
  high:   'bg-danger/10 text-danger',
  medium: 'bg-warning/10 text-warning',
  low:    'bg-muted text-muted-foreground',
}

function toReadableLabel(str) {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function RiskFlagsPanel({ riskFlags = [], limit }) {
  const displayed = limit ? riskFlags.slice(0, limit) : riskFlags
  const hiddenCount = riskFlags.length - displayed.length

  if (riskFlags.length === 0) {
    return (
      <div className="bg-success/10 border border-success/20 rounded-xl p-4">
        <p className="text-success text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          No risk patterns detected. Great session!
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-3">

      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-foreground">Risk Patterns Detected</h3>
        <span className="bg-danger/10 text-danger rounded-full px-2 text-xs font-semibold">
          {riskFlags.length}
        </span>
      </div>

      {displayed.map((flag, i) => (
        <div
          key={i}
          className={cn(
            'rounded-lg border p-4',
            SEVERITY_CARD[flag.severity] ?? SEVERITY_CARD.low
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm text-foreground">
              {toReadableLabel(flag.flag_type)}
            </span>
            <span className={cn(
              'text-xs rounded-full px-2 py-0.5 font-semibold capitalize',
              SEVERITY_PILL[flag.severity] ?? SEVERITY_PILL.low
            )}>
              {flag.severity}
            </span>
          </div>

          <p className="text-sm text-t-secondary mt-1">{flag.description}</p>

          {flag.affected_turns?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-xs text-muted-foreground">Affected turns:</span>
              {flag.affected_turns.map((t) => (
                <span
                  key={t}
                  className="bg-muted text-muted-foreground text-xs rounded px-1.5 py-0.5"
                >
                  T{t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {hiddenCount > 0 && (
        <p className="text-xs text-muted-foreground text-right">+{hiddenCount} more — see Risk &amp; Blind Spots tab</p>
      )}
    </div>
  )
}
