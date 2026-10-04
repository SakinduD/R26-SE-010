import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Horizontal step indicator on desktop, "Step 3 of 5 · Coaching" on small
// screens — replaces the old plain dot row with something that actually
// names where you are in the review instead of just showing progress.
export default function FeedbackProgress({ steps, activeIndex }) {
  const active = steps[activeIndex]

  return (
    <div className="fp-wrap">
      <ol className="fp-steps" aria-label="Feedback review progress">
        {steps.map((step, i) => {
          const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'upcoming'
          return (
            <li key={step.key} className={cn('fp-step', state)}>
              <span className="fp-marker">{state === 'done' ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
              <span className="fp-label">{step.label}</span>
              {i < steps.length - 1 && <span className="fp-connector" aria-hidden />}
            </li>
          )
        })}
      </ol>

      <p className="fp-compact">Step {activeIndex + 1} of {steps.length} · {active?.label}</p>

      <style>{`
        .fp-wrap{
          background:var(--header-backdrop); backdrop-filter:blur(10px); border-bottom:1px solid var(--border);
          padding:14px 24px 16px;
        }
        .fp-steps{ max-width:1200px; margin:0 auto; list-style:none; padding:0; display:flex; align-items:center; }
        .fp-step{ display:flex; align-items:center; flex:1; }
        .fp-step:last-child{ flex:0; }
        .fp-marker{
          width:24px; height:24px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center;
          font-size:10.5px; font-weight:700; background:var(--surface-hi); color:var(--text-low); border:1.5px solid var(--border);
          transition:background .25s var(--ease), color .25s var(--ease), border-color .25s var(--ease), box-shadow .25s var(--ease);
        }
        .fp-step.done .fp-marker{ background:var(--accent); border-color:var(--accent); color:#fff; }
        .fp-step.active .fp-marker{
          background:var(--accent); border-color:var(--accent); color:#fff;
          box-shadow:0 0 0 4px var(--accent-glow);
        }
        .fp-label{
          font-size:11.5px; font-weight:650; color:var(--text-low); margin-left:8px; white-space:nowrap;
          transition:color .25s var(--ease), font-weight .25s var(--ease);
        }
        .fp-step.active .fp-label{ color:var(--text-hi); font-weight:750; }
        .fp-step.done .fp-label{ color:var(--text-med); }
        .fp-connector{ flex:1; height:2px; background:var(--border); margin:0 10px; border-radius:2px; }
        .fp-step.done .fp-connector{ background:var(--accent); }

        .fp-compact{ max-width:1200px; margin:0 auto; display:none; font-size:12px; font-weight:650; color:var(--text-med); }

        @media (max-width:680px){
          .fp-steps{ display:none; }
          .fp-compact{ display:block; }
        }
      `}</style>
    </div>
  )
}
