// REDESIGN: bg-white/bg-gray/green/yellow/red/blue → semantic tokens (dark-mode safe)
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

const getTrustColor = (v) =>
  v >= 70 ? 'text-success' : v >= 40 ? 'text-warning' : 'text-danger'

const getTrustBarColor = (v) =>
  v >= 70 ? 'bg-success' : v >= 40 ? 'bg-warning' : 'bg-danger'

const EMOTION_COLORS = {
  calm:       'bg-success/10 text-success',
  assertive:  'bg-info/10 text-info',
  anxious:    'bg-warning/10 text-warning',
  frustrated: 'bg-danger/10 text-danger',
  confused:   'bg-muted text-muted-foreground',
}

const EMOTION_BAR_COLORS = {
  calm:       'bg-success',
  assertive:  'bg-info',
  anxious:    'bg-warning',
  frustrated: 'bg-danger',
  confused:   'bg-muted-foreground',
}

const TREND_CONFIG = {
  improving: { icon: TrendingUp,   cls: 'text-success', label: '↑ Improving' },
  declining: { icon: TrendingDown, cls: 'text-danger',  label: '↓ Declining' },
  stable:    { icon: Minus,        cls: 'text-warning', label: '→ Stable'    },
}

function StarRating({ value, max = 10 }) {
  const filled = Math.floor((value / max) * 5)
  return (
    <div className="flex gap-0.5 mt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < filled ? 'text-warning' : 'text-muted-foreground/30'}>★</span>
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
              ? value <= 1 ? 'bg-success' : value <= 3 ? 'bg-warning' : 'bg-danger'
              : 'bg-muted'
          )}
        />
      ))}
    </div>
  )
}

export default function RadarSummaryCard({ summaryScores, emotionDistribution = {} }) {
  if (!summaryScores) return null

  const {
    avg_trust        = 0,
    avg_escalation   = 0,
    avg_quality      = 0,
    trust_trend      = 'stable',
    dominant_emotion = 'calm',
  } = summaryScores

  const trend = TREND_CONFIG[trust_trend] ?? TREND_CONFIG.stable
  const TrendIcon = trend.icon

  const totalEmotions = Object.values(emotionDistribution).reduce((s, c) => s + c, 0)
  const emotionEntries = Object.entries(emotionDistribution).sort((a, b) => b[1] - a[1])

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="font-semibold text-foreground mb-4">Performance Summary</h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

        <div className="bg-muted/30 rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Avg Trust</p>
          <p className={cn('text-lg font-bold', getTrustColor(avg_trust))}>
            {avg_trust}<span className="text-xs text-muted-foreground font-normal">/100</span>
          </p>
          <div className="w-full bg-muted rounded-full h-1.5 mt-1.5">
            <div
              className={cn('h-1.5 rounded-full transition-all', getTrustBarColor(avg_trust))}
              style={{ width: `${Math.min(100, avg_trust)}%` }}
            />
          </div>
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Response Quality</p>
          <p className="text-lg font-bold text-foreground">
            {avg_quality}<span className="text-xs text-muted-foreground font-normal">/10</span>
          </p>
          <StarRating value={avg_quality} max={10} />
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Avg Escalation</p>
          <p className="text-lg font-bold text-foreground">
            {avg_escalation}<span className="text-xs text-muted-foreground font-normal">/5</span>
          </p>
          <PipDots value={Math.round(avg_escalation)} max={5} />
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Trust Trend</p>
          <div className={cn('flex items-center gap-1.5 text-lg font-bold', trend.cls)}>
            <TrendIcon size={18} />
            <span className="text-sm">{trend.label}</span>
          </div>
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Dominant Emotion</p>
          <span className={cn(
            'inline-block text-sm font-semibold rounded-full px-2.5 py-0.5 capitalize mt-1',
            EMOTION_COLORS[dominant_emotion] ?? EMOTION_COLORS.confused
          )}>
            {dominant_emotion}
          </span>
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Emotion Breakdown</p>
          {emotionEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No data</p>
          ) : (
            <div className="space-y-1">
              {emotionEntries.map(([emotion, count]) => {
                const pct = totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
                return (
                  <div key={emotion} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground w-16 truncate capitalize">{emotion}</span>
                    <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className={cn('h-1.5 rounded-full transition-all', EMOTION_BAR_COLORS[emotion] ?? 'bg-muted-foreground')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
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
