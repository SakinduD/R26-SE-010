// REDESIGN: bg-white/bg-gray/bg-green-50/bg-orange-50 → semantic tokens (dark-mode safe)
import { AlertTriangle, CheckCircle } from 'lucide-react'

function toReadableLabel(str) {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function BlindSpotsPanel({ blindSpots = [], limit }) {
  const displayed = limit ? blindSpots.slice(0, limit) : blindSpots
  const hiddenCount = blindSpots.length - displayed.length

  if (blindSpots.length === 0) {
    return (
      <div className="bg-success/10 border border-success/20 rounded-xl p-4">
        <p className="text-success text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          No blind spots detected. Strong performance!
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-4">

      <div>
        <h3 className="font-semibold text-foreground">Blind Spots Identified</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Areas where your performance consistently fell below the target
        </p>
      </div>

      {displayed.map((spot, i) => (
        <div
          key={i}
          className="rounded-lg border border-warning/20 bg-warning/5 p-4 space-y-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-warning w-4 h-4 flex-shrink-0" />
            <span className="font-medium text-sm text-warning">
              {toReadableLabel(spot.blind_spot_type)}
            </span>
          </div>

          <p className="text-sm text-t-secondary">{spot.description}</p>

          {spot.affected_turns?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">Affected turns:</span>
              {spot.affected_turns.map((t) => (
                <span
                  key={t}
                  className="bg-muted text-muted-foreground text-xs rounded px-1.5 py-0.5"
                >
                  T{t}
                </span>
              ))}
            </div>
          )}

          {spot.recommendation && (
            <div className="bg-card border border-warning/20 rounded-lg px-3 py-2 mt-2">
              <p className="text-xs font-semibold text-warning mb-0.5">Recommendation</p>
              <p className="text-sm text-foreground">{spot.recommendation}</p>
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
