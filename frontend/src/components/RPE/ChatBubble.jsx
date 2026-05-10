// REDESIGN: bg-slate/bg-emerald/bg-amber/bg-red → semantic tokens; shadow-md/lg removed
import { cn } from '@/lib/utils'

const EMOTION_STYLES = {
  calm:       'bg-success/10 text-success',
  assertive:  'bg-accent-soft text-accent',
  anxious:    'bg-warning/10 text-warning',
  frustrated: 'bg-danger/10 text-danger',
  confused:   'bg-muted text-muted-foreground',
}

const NPC_TONE_GLOW = {
  cooperative: 'from-success to-success/70',
  neutral:     'from-warning to-warning/70',
  hostile:     'from-danger to-danger/70',
}

export default function ChatBubble({ role, message, emotion, trustDelta, npcTone, npcRole }) {
  const isNpc = role === 'npc'

  return (
    <div className={cn('flex', isNpc ? 'justify-start' : 'justify-end')}>
      <div className={cn('flex flex-col max-w-[78%]', isNpc ? 'items-start' : 'items-end')}>

        {isNpc && npcRole && (
          <span className="text-[10px] text-muted-foreground mb-1.5 ml-1 font-semibold uppercase tracking-widest">
            {npcRole}
          </span>
        )}

        <div className={cn(
          'relative rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isNpc
            ? 'bg-elevated text-foreground border border-border-subtle overflow-hidden'
            : 'bg-primary text-primary-foreground'
        )}>
          {isNpc && (
            <div className={cn(
              'absolute left-0 inset-y-0 w-[3px] rounded-l-2xl bg-gradient-to-b',
              NPC_TONE_GLOW[npcTone] ?? 'from-border-strong to-border-default'
            )} />
          )}
          <span className={isNpc ? 'pl-1' : ''}>{message}</span>
        </div>

        {!isNpc && emotion && (
          <span className={cn(
            'mt-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
            EMOTION_STYLES[emotion] ?? EMOTION_STYLES.confused
          )}>
            {emotion}
          </span>
        )}

        {!isNpc && trustDelta != null && (
          <span className={cn(
            'text-xs mt-0.5 font-medium tabular-nums',
            trustDelta > 0 ? 'text-success' : trustDelta < 0 ? 'text-danger' : 'text-muted-foreground'
          )}>
            {trustDelta > 0 ? `↑ Trust +${trustDelta}` : trustDelta < 0 ? `↓ Trust ${trustDelta}` : '→ Trust ±0'}
          </span>
        )}

      </div>
    </div>
  )
}
