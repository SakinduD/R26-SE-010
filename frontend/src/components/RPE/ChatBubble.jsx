import { cn } from '@/lib/utils'

const EMOTION_STYLES = {
  calm:       'bg-emerald-100 text-emerald-700',
  assertive:  'bg-violet-100 text-violet-700',
  anxious:    'bg-amber-100 text-amber-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-slate-100 text-slate-600',
}

const NPC_TONE_GLOW = {
  cooperative: 'from-emerald-500 to-teal-400',
  neutral:     'from-amber-400 to-yellow-300',
  hostile:     'from-red-500 to-rose-400',
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
            ? 'bg-slate-900 text-slate-100 border border-slate-700/60 shadow-md overflow-hidden'
            : 'bg-gradient-to-br from-primary to-violet-600 text-white shadow-lg shadow-primary/25'
        )}>
          {/* NPC tone accent bar */}
          {isNpc && (
            <div className={cn(
              'absolute left-0 inset-y-0 w-[3px] rounded-l-2xl bg-gradient-to-b',
              NPC_TONE_GLOW[npcTone] ?? 'from-slate-500 to-slate-600'
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
            trustDelta > 0 ? 'text-emerald-600' : trustDelta < 0 ? 'text-red-500' : 'text-muted-foreground'
          )}>
            {trustDelta > 0 ? `↑ Trust +${trustDelta}` : trustDelta < 0 ? `↓ Trust ${trustDelta}` : '→ Trust ±0'}
          </span>
        )}

      </div>
    </div>
  )
}
