import { cn } from '@/lib/utils'

const EMOTION_STYLES = {
  calm:       'bg-emerald-100 text-emerald-700',
  assertive:  'bg-violet-100 text-violet-700',
  anxious:    'bg-amber-100 text-amber-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-slate-100 text-slate-600',
}

const getTrustGradient = (score) =>
  score >= 70 ? 'from-emerald-500 to-teal-400'
  : score >= 40 ? 'from-amber-400 to-yellow-300'
  : 'from-red-500 to-rose-400'

const getPipStyle = (level) =>
  level <= 1 ? 'bg-emerald-400 shadow-sm shadow-emerald-400/60'
  : level <= 3 ? 'bg-amber-400 shadow-sm shadow-amber-400/60'
  : 'bg-red-500 shadow-sm shadow-red-500/60'

const NPC_TONE_STYLES = {
  cooperative: { pill: 'bg-emerald-100 text-emerald-700',  label: 'Warming Up' },
  neutral:     { pill: 'bg-amber-100 text-amber-700',      label: 'Neutral'    },
  hostile:     { pill: 'bg-red-100 text-red-700',          label: 'Hostile'    },
}

const ESC_TONE_STYLES = {
  controlled: { text: 'text-muted-foreground', label: 'Controlled' },
  irritated:  { text: 'text-amber-500',        label: 'Irritated'  },
  furious:    { text: 'text-red-500 font-semibold', label: 'Furious ⚠' },
}

export default function MetricsHUD({
  trustScore, escalationLevel, emotion,
  trustDelta, npcTone, escalationTone,
  failureEscalationThreshold,
}) {
  const pipStyle  = getPipStyle(escalationLevel)
  const toneStyle = NPC_TONE_STYLES[npcTone] ?? NPC_TONE_STYLES.hostile
  const escStyle  = ESC_TONE_STYLES[escalationTone] ?? ESC_TONE_STYLES.controlled

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">

      {/* Header strip */}
      <div className="px-4 pt-4 pb-3 bg-gradient-to-r from-primary/8 to-transparent border-b border-border/60">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest">Live Metrics</p>
      </div>

      <div className="p-4 space-y-4">

        {/* Trust bar */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs font-semibold text-foreground">Trust</span>
            <div className="flex items-center gap-1.5">
              {trustDelta != null && trustDelta !== 0 && (
                <span className={cn(
                  'text-xs font-bold tabular-nums',
                  trustDelta > 0 ? 'text-emerald-600' : 'text-red-500'
                )}>
                  {trustDelta > 0 ? `+${trustDelta}` : trustDelta}
                </span>
              )}
              <span className="text-sm font-bold tabular-nums text-foreground">{trustScore}</span>
            </div>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r', getTrustGradient(trustScore))}
              style={{ width: `${Math.max(0, Math.min(100, trustScore))}%` }}
            />
          </div>
        </div>

        <div className="border-t border-border/60" />

        {/* NPC Attitude */}
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest block mb-2">
            NPC Attitude
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', toneStyle.pill)}>
              {toneStyle.label}
            </span>
            <span className={cn('text-xs', escStyle.text)}>
              {escStyle.label}
            </span>
          </div>
        </div>

        <div className="border-t border-border/60" />

        {/* Escalation pips */}
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest block mb-2">
            Escalation
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-5 h-5 rounded-full transition-all duration-300',
                  i < escalationLevel
                    ? cn(pipStyle, escalationLevel >= (failureEscalationThreshold ?? 3) - 1 && 'animate-pulse')
                    : 'bg-muted border border-border'
                )}
              />
            ))}
          </div>
          {failureEscalationThreshold != null && (
            <p className={cn(
              'text-[10px] mt-1.5 tabular-nums',
              escalationLevel >= failureEscalationThreshold - 1
                ? 'text-red-500 font-semibold'
                : 'text-muted-foreground/50'
            )}>
              NPC exits at {failureEscalationThreshold}/5
            </p>
          )}
        </div>

        <div className="border-t border-border/60" />

        {/* Emotion */}
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest block mb-2">
            Emotion
          </span>
          <span className={cn(
            'inline-block rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors duration-300',
            EMOTION_STYLES[emotion] ?? EMOTION_STYLES.confused
          )}>
            {emotion || 'calm'}
          </span>
        </div>

      </div>
    </div>
  )
}
