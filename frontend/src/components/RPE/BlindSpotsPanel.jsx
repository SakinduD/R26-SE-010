import { AlertTriangle } from 'lucide-react'

function toReadableLabel(str) {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * BlindSpotsPanel
 * Props:
 *   blindSpots: [{ blind_spot_type, description, affected_turns, recommendation }]
 *   limit?: number — show only first N spots (used in Overview)
 */
export default function BlindSpotsPanel({ blindSpots = [], limit }) {
  const displayed = limit ? blindSpots.slice(0, limit) : blindSpots
  const hiddenCount = blindSpots.length - displayed.length

  if (blindSpots.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <p className="text-green-700 text-sm">✅ No blind spots detected. Strong performance!</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">

      {/* Header */}
      <div>
        <h3 className="font-semibold text-gray-900">Blind Spots Identified</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Areas where your performance consistently fell below the target
        </p>
      </div>

      {/* Spot cards */}
      {displayed.map((spot, i) => (
        <div
          key={i}
          className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-2"
        >
          {/* Top row */}
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-orange-500 w-4 h-4 flex-shrink-0" />
            <span className="font-medium text-sm text-orange-800">
              {toReadableLabel(spot.blind_spot_type)}
            </span>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-600">{spot.description}</p>

          {/* Affected turns */}
          {spot.affected_turns?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-400">Affected turns:</span>
              {spot.affected_turns.map((t) => (
                <span
                  key={t}
                  className="bg-gray-200 text-gray-600 text-xs rounded px-1.5 py-0.5"
                >
                  T{t}
                </span>
              ))}
            </div>
          )}

          {/* Recommendation */}
          {spot.recommendation && (
            <div className="bg-white border border-orange-200 rounded-lg px-3 py-2 mt-2">
              <p className="text-xs font-semibold text-orange-600 mb-0.5">💡 Recommendation</p>
              <p className="text-sm text-gray-700">{spot.recommendation}</p>
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
