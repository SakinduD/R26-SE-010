import { cn } from '@/lib/utils'

const SEVERITY_CARD = {
  high:   'border-red-200 bg-red-50',
  medium: 'border-yellow-200 bg-yellow-50',
  low:    'border-gray-200 bg-gray-50',
}

const SEVERITY_PILL = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-gray-100 text-gray-600',
}

function toReadableLabel(str) {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * RiskFlagsPanel
 * Props:
 *   riskFlags: [{ flag_type, severity, description, affected_turns }]
 *   limit?: number — show only first N flags (used in Overview)
 */
export default function RiskFlagsPanel({ riskFlags = [], limit }) {
  const displayed = limit ? riskFlags.slice(0, limit) : riskFlags
  const hiddenCount = riskFlags.length - displayed.length

  if (riskFlags.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <p className="text-green-700 text-sm">✅ No risk patterns detected. Great session!</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">

      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-gray-900">Risk Patterns Detected</h3>
        <span className="bg-red-100 text-red-700 rounded-full px-2 text-xs font-semibold">
          {riskFlags.length}
        </span>
      </div>

      {/* Flag cards */}
      {displayed.map((flag, i) => (
        <div
          key={i}
          className={cn(
            'rounded-lg border p-4',
            SEVERITY_CARD[flag.severity] ?? SEVERITY_CARD.low
          )}
        >
          {/* Top row */}
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm text-gray-800">
              {toReadableLabel(flag.flag_type)}
            </span>
            <span className={cn(
              'text-xs rounded-full px-2 py-0.5 font-semibold capitalize',
              SEVERITY_PILL[flag.severity] ?? SEVERITY_PILL.low
            )}>
              {flag.severity}
            </span>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-600 mt-1">{flag.description}</p>

          {/* Affected turns */}
          {flag.affected_turns?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-xs text-gray-400">Affected turns:</span>
              {flag.affected_turns.map((t) => (
                <span
                  key={t}
                  className="bg-gray-200 text-gray-600 text-xs rounded px-1.5 py-0.5"
                >
                  T{t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {hiddenCount > 0 && (
        <p className="text-xs text-gray-400 text-right">+{hiddenCount} more — see Risk &amp; Blind Spots tab</p>
      )}
    </div>
  )
}
