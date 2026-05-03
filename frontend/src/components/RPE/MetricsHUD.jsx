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

const NPC_TONE_STYLES = {
  cooperative: { pill: 'bg-green-100 text-green-700',   label: 'Warming Up' },
  neutral:     { pill: 'bg-yellow-100 text-yellow-700', label: 'Under Pressure' },
  hostile:     { pill: 'bg-red-100 text-red-700',       label: 'Hostile' },
}

const ESC_TONE_STYLES = {
  controlled: { text: 'text-gray-400',   label: 'Controlled' },
  irritated:  { text: 'text-yellow-500', label: 'Irritated' },
  furious:    { text: 'text-red-600',    label: 'Furious ⚠' },
}

export default function MetricsHUD({
  trustScore, escalationLevel, emotion,
  trustDelta, npcTone, escalationTone,
}) {
  const pipColor = getPipColor(escalationLevel)
  const toneStyle = NPC_TONE_STYLES[npcTone] ?? NPC_TONE_STYLES.hostile
  const escStyle  = ESC_TONE_STYLES[escalationTone] ?? ESC_TONE_STYLES.controlled

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">

      {/* Trust bar */}
      <div>
        <div className="flex justify-between items-center text-xs font-medium text-gray-600 mb-1.5">
          <span>Trust</span>
          <div className="flex items-center gap-1.5">
            {trustDelta > 0 && (
              <span className="text-green-600 font-bold text-xs">+{trustDelta}</span>
            )}
            {trustDelta < 0 && (
              <span className="text-red-500 font-bold text-xs">{trustDelta}</span>
            )}
            <span className="tabular-nums">{trustScore}</span>
          </div>
        </div>
        <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-700 ease-in-out', getTrustBarColor(trustScore))}
            style={{ width: `${Math.max(0, Math.min(100, trustScore))}%` }}
          />
        </div>
      </div>

      {/* NPC Attitude */}
      <div>
        <span className="text-xs font-medium text-gray-600 block mb-1.5">NPC Attitude</span>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', toneStyle.pill)}>
            {toneStyle.label}
          </span>
          <span className={cn('text-xs font-medium', escStyle.text)}>
            {escStyle.label}
          </span>
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
                i < escalationLevel
                  ? cn(pipColor, escalationLevel >= 3 && 'animate-pulse')
                  : 'bg-gray-200'
              )}
            />
          ))}
        </div>
      </div>

      {/* Emotion badge */}
      <div>
        <span className="text-xs font-medium text-gray-600 block mb-1.5">Emotion</span>
        <div className="transition-all duration-300">
          <span className={cn(
            'inline-block rounded-full px-3 py-1 text-sm font-medium transition-colors duration-300',
            EMOTION_COLORS[emotion] ?? EMOTION_COLORS.confused
          )}>
            {emotion || 'calm'}
          </span>
        </div>
      </div>

    </div>
  )
}
