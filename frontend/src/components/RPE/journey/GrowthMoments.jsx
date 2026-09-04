import { TrendingUp, TrendingDown, Target } from 'lucide-react'

const ICONS = { up: TrendingUp, down: TrendingDown, focus: Target }

// Only ever rendered by MySessions.jsx when there's enough real signal to
// say something honest — a trust trend comparing recent vs earlier
// sessions, and/or which skill has been showing up most in recent practice.
// No per-turn behavioral claims ("clearer ownership", etc.) are made here —
// that would need NLP/behavior data this list view doesn't have; inventing
// it would violate the whole point of this section.
export default function GrowthMoments({ moments }) {
  if (!moments || moments.length === 0) return null

  return (
    <div className="gm-wrap">
      {moments.map((m, i) => {
        const Icon = ICONS[m.type] || Target
        return (
          <div key={i} className={`gm-item ${m.type}`}>
            <Icon size={15} strokeWidth={2} className="gm-icon" />
            <div>
              <p className="gm-title">{m.title}</p>
              <p className="gm-text">{m.text}</p>
            </div>
          </div>
        )
      })}

      <style>{`
        .gm-wrap{ display:flex; flex-direction:column; gap:12px; }
        .gm-item{ display:flex; gap:12px; align-items:flex-start; }
        .gm-icon{ flex-shrink:0; margin-top:2px; }
        .gm-item.up .gm-icon{ color:var(--success); }
        .gm-item.down .gm-icon{ color:var(--warning); }
        .gm-item.focus .gm-icon{ color:var(--accent); }
        .gm-title{ font-size:13.5px; font-weight:700; color:var(--text-hi); margin:0; }
        .gm-text{ font-size:12.5px; color:var(--text-med); margin:2px 0 0; line-height:1.5; }
      `}</style>
    </div>
  )
}
