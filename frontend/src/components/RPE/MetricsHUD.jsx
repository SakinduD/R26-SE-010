import { cn } from '@/lib/utils'

const EMOTION_COLORS = {
  calm:       'bg-green-100 text-green-700',
  assertive:  'bg-blue-100 text-blue-700',
  anxious:    'bg-yellow-100 text-yellow-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-gray-100 text-gray-700',
}

const getTrustBarColor = (score) =>
  score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-400' : 'bg-red-500'

const getPipColor = (level) =>
  level <= 1 ? 'bg-green-400' : level <= 3 ? 'bg-yellow-400' : 'bg-red-500'

export default function MetricsHUD({ trustScore, escalationLevel, emotion }) {
  const pipColor = getPipColor(escalationLevel)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
      {/* Trust bar */}
      <div>
        <div className="flex justify-between items-center text-xs font-medium text-gray-600 mb-1.5">
          <span>Trust</span>
          <span className="tabular-nums">{trustScore}</span>
        </div>
        <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', getTrustBarColor(trustScore))}
            style={{ width: `${Math.max(0, Math.min(100, trustScore))}%` }}
          />
        </div>
      </div>

      {/* Escalation pips */}
      <div>
        <span className="text-xs font-medium text-gray-600 block mb-1.5">Escalation</span>
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'w-5 h-5 rounded-full transition-colors duration-300',
                i < escalationLevel ? pipColor : 'bg-gray-200'
              )}
            />
          ))}
        </div>
      </div>

      {/* Emotion badge */}
      <div>
        <span className="text-xs font-medium text-gray-600 block mb-1.5">Emotion</span>
        <span className={cn(
          'inline-block rounded-full px-3 py-1 text-sm font-medium transition-colors duration-300',
          EMOTION_COLORS[emotion] ?? EMOTION_COLORS.confused
        )}>
          {emotion || 'calm'}
        </span>
      </div>
    </div>
  )
}
