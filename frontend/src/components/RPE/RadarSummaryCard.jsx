import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── helpers ────────────────────────────────────────────────── */
const getTrustColor = (v) =>
  v >= 70 ? 'text-green-600' : v >= 40 ? 'text-yellow-500' : 'text-red-500'

const getTrustBarColor = (v) =>
  v >= 70 ? 'bg-green-500' : v >= 40 ? 'bg-yellow-400' : 'bg-red-500'

const EMOTION_COLORS = {
  calm:       'bg-green-100 text-green-700',
  assertive:  'bg-blue-100 text-blue-700',
  anxious:    'bg-yellow-100 text-yellow-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-gray-100 text-gray-700',
}

const EMOTION_BAR_COLORS = {
  calm:       'bg-green-400',
  assertive:  'bg-blue-400',
  anxious:    'bg-yellow-400',
  frustrated: 'bg-red-400',
  confused:   'bg-gray-400',
}

const TREND_CONFIG = {
  improving: { icon: TrendingUp,   cls: 'text-green-600',  label: '↑ Improving'  },
  declining: { icon: TrendingDown, cls: 'text-red-500',    label: '↓ Declining'  },
  stable:    { icon: Minus,        cls: 'text-yellow-500', label: '→ Stable'     },
}

function StarRating({ value, max = 10 }) {
  const filled = Math.floor((value / max) * 5)
  return (
    <div className="flex gap-0.5 mt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < filled ? 'text-yellow-400' : 'text-gray-200'}>★</span>
      ))}
    </div>
  )
}

function PipDots({ value, max = 5 }) {
  return (
    <div className="flex gap-1 mt-1">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'w-2 h-2 rounded-full',
            i < value
              ? value <= 1 ? 'bg-green-400' : value <= 3 ? 'bg-yellow-400' : 'bg-red-500'
              : 'bg-gray-200'
          )}
        />
      ))}
    </div>
  )
}

/**
 * RadarSummaryCard
 * Props:
 *   summaryScores: { avg_trust, avg_escalation, avg_quality, trust_trend, dominant_emotion }
 *   emotionDistribution: { [emotion]: count }
 */
export default function RadarSummaryCard({ summaryScores, emotionDistribution = {} }) {
  if (!summaryScores) return null

  const {
    avg_trust       = 0,
    avg_escalation  = 0,
    avg_quality     = 0,
    trust_trend     = 'stable',
    dominant_emotion = 'calm',
  } = summaryScores

  const trend = TREND_CONFIG[trust_trend] ?? TREND_CONFIG.stable
  const TrendIcon = trend.icon

  const totalEmotions = Object.values(emotionDistribution).reduce((s, c) => s + c, 0)
  const emotionEntries = Object.entries(emotionDistribution).sort((a, b) => b[1] - a[1])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-900 mb-4">Performance Summary</h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

        {/* Tile 1 — Avg Trust */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Avg Trust</p>
          <p className={cn('text-lg font-bold', getTrustColor(avg_trust))}>
            {avg_trust}<span className="text-xs text-gray-400 font-normal">/100</span>
          </p>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1.5">
            <div
              className={cn('h-1.5 rounded-full transition-all', getTrustBarColor(avg_trust))}
              style={{ width: `${Math.min(100, avg_trust)}%` }}
            />
          </div>
        </div>

        {/* Tile 2 — Avg Quality */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Response Quality</p>
          <p className="text-lg font-bold text-gray-900">
            {avg_quality}<span className="text-xs text-gray-400 font-normal">/10</span>
          </p>
          <StarRating value={avg_quality} max={10} />
        </div>

        {/* Tile 3 — Avg Escalation */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Avg Escalation</p>
          <p className="text-lg font-bold text-gray-900">
            {avg_escalation}<span className="text-xs text-gray-400 font-normal">/5</span>
          </p>
          <PipDots value={Math.round(avg_escalation)} max={5} />
        </div>

        {/* Tile 4 — Trust Trend */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Trust Trend</p>
          <div className={cn('flex items-center gap-1.5 text-lg font-bold', trend.cls)}>
            <TrendIcon size={18} />
            <span className="text-sm">{trend.label}</span>
          </div>
        </div>

        {/* Tile 5 — Dominant Emotion */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Dominant Emotion</p>
          <span className={cn(
            'inline-block text-sm font-semibold rounded-full px-2.5 py-0.5 capitalize mt-1',
            EMOTION_COLORS[dominant_emotion] ?? EMOTION_COLORS.confused
          )}>
            {dominant_emotion}
          </span>
        </div>

        {/* Tile 6 — Emotion Distribution */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Emotion Breakdown</p>
          {emotionEntries.length === 0 ? (
            <p className="text-xs text-gray-400">No data</p>
          ) : (
            <div className="space-y-1">
              {emotionEntries.map(([emotion, count]) => {
                const pct = totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
                return (
                  <div key={emotion} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 w-16 truncate capitalize">{emotion}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={cn('h-1.5 rounded-full transition-all', EMOTION_BAR_COLORS[emotion] ?? 'bg-gray-400')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-7 text-right">{pct}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
