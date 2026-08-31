import gsap from 'gsap'
import { Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGsapScope } from './useGsapScope'

const NEGATIVE_FLAGS = new Set(['passive', 'aggressive', 'too_short', 'too_long'])

function behaviorLabel(flags) {
  const negative = flags.find((f) => NEGATIVE_FLAGS.has(f))
  if (negative) return negative.replace(/_/g, ' ')
  const behavior = flags.find((f) => f.startsWith('behavior:'))
  return behavior ? behavior.slice('behavior:'.length).replace(/_/g, ' ') : null
}

// A per-turn signal strip — every marker traces back to a real value:
// turn_metrics[].flags (the rule-based passive/aggressive/too_short/
// too_long/behavior:X tags) unioned with whichever turns risk_flags or
// blind_spots actually named in their affected_turns. No behavior type is
// invented — a turn with no flags and no mention in either list just shows
// a plain neutral marker.
export default function BehaviorTimeline({ turnMetrics = [], riskFlags = [], blindSpots = [] }) {
  const flaggedTurns = new Set([
    ...riskFlags.flatMap((f) => f.affected_turns ?? []),
    ...blindSpots.flatMap((b) => b.affected_turns ?? []),
  ])

  const scopeRef = useGsapScope(({ instant }) => {
    const els = gsap.utils.toArray('.bt-node')
    if (instant) { gsap.set(els, { opacity: 1, y: 0 }); return }
    gsap.fromTo(els, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', stagger: 0.06 })
  }, [turnMetrics.length])

  if (turnMetrics.length === 0) return null

  return (
    <div className="bt-wrap" ref={(el) => { scopeRef.current = el }}>
      <p className="bt-title">Conversation signals</p>
      <div className="bt-track">
        {turnMetrics.map((tm) => {
          const negative = tm.flags?.some((f) => NEGATIVE_FLAGS.has(f)) || flaggedTurns.has(tm.turn)
          const label = behaviorLabel(tm.flags ?? [])
          return (
            <div key={tm.turn} className="bt-node">
              <span className="bt-turn">T{tm.turn}</span>
              <span className={cn('bt-dot', negative ? 'warning' : 'success')}>
                {negative ? <AlertTriangle size={11} strokeWidth={2.5} /> : <Check size={11} strokeWidth={2.5} />}
              </span>
              {label && <span className="bt-label">{label}</span>}
            </div>
          )
        })}
      </div>

      <style>{`
        .bt-wrap{ display:flex; flex-direction:column; gap:10px; }
        .bt-title{ font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); margin:0; }
        .bt-track{ display:flex; gap:4px; overflow-x:auto; padding:4px 2px 8px; position:relative; }
        .bt-track::before{
          content:""; position:absolute; left:24px; right:24px; top:32px; height:1px; background:var(--border); z-index:0;
        }
        .bt-node{ display:flex; flex-direction:column; align-items:center; gap:6px; flex-shrink:0; width:64px; position:relative; z-index:1; }
        .bt-turn{ font-size:9.5px; font-weight:700; color:var(--text-low); }
        .bt-dot{
          width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center;
          border:2px solid var(--surface);
        }
        .bt-dot.success{ background:var(--success-glow); color:var(--success); }
        .bt-dot.warning{ background:var(--warning-glow); color:var(--warning); }
        .bt-label{ font-size:9.5px; color:var(--text-med); text-align:center; text-transform:capitalize; line-height:1.3; max-width:64px; }
      `}</style>
    </div>
  )
}
