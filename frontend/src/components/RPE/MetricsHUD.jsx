// REDESIGN: emerald/amber/red/slate/violet → semantic tokens; shadow-sm removed from card
import { cn } from '@/lib/utils'

const EMOTION_STYLES = {
  calm:       'bg-success/10 text-success',
  assertive:  'bg-accent-soft text-accent',
  anxious:    'bg-warning/10 text-warning',
  frustrated: 'bg-danger/10 text-danger',
  confused:   'bg-muted text-muted-foreground',
}

const getTrustGradient = (score) =>
  score >= 70 ? 'from-success to-success/70'
  : score >= 40 ? 'from-warning to-warning/70'
  : 'from-danger to-danger/70'

const getPipStyle = (level) =>
  level <= 1 ? 'bg-success'
  : level <= 3 ? 'bg-warning'
  : 'bg-danger'

const NPC_TONE_STYLES = {
  cooperative: { pill: 'bg-success/10 text-success', label: 'Warming Up' },
  neutral:     { pill: 'bg-warning/10 text-warning', label: 'Neutral'    },
  hostile:     { pill: 'bg-danger/10 text-danger',   label: 'Hostile'    },
}

const ESC_TONE_STYLES = {
  controlled: { text: 'text-muted-foreground',    label: 'Controlled' },
  irritated:  { text: 'text-warning',              label: 'Irritated'  },
  furious:    { text: 'text-danger font-semibold', label: 'Furious'    },
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
    <div className="rounded-xl border border-border bg-card overflow-hidden">

      <div className="px-4 pt-4 pb-3 bg-gradient-to-r from-primary/8 to-transparent border-b border-border/60">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest">Live Metrics</p>
      </div>

      <div className="p-4 space-y-4">

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs font-semibold text-foreground">Trust</span>
            <div className="flex items-center gap-1.5">
              {trustDelta != null && trustDelta !== 0 && (
                <span className={cn(
                  'text-xs font-bold tabular-nums',
                  trustDelta > 0 ? 'text-success' : 'text-danger'
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
                ? 'text-danger font-semibold'
                : 'text-muted-foreground/50'
            )}>
              NPC exits at {failureEscalationThreshold}/5
            </p>
          )}
        </div>

        <div className="border-t border-border/60" />

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
