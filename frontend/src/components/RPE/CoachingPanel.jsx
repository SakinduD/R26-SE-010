import { CheckCircle, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

const RATING_TONE = {
  excellent:  { tone: 'success', label: 'Excellent'  },
  good:       { tone: 'primary', label: 'Good'        },
  needs_work: { tone: 'warning', label: 'Needs Work'  },
}

export default function CoachingPanel({ coachingAdvice, truncated = false, onExpand }) {
  if (!coachingAdvice) return null

  const { overall_rating, summary, advice = [], strengths = [], focus_areas = [] } = coachingAdvice
  const rating = RATING_TONE[overall_rating] ?? RATING_TONE.needs_work

  return (
    <div className="coach-card">
      <div className="coach-head">
        <h3 className="coach-title">Coaching Advice</h3>
        <span className={cn('coach-badge', rating.tone)}>{rating.label}</span>
      </div>

      <div className="coach-summary">
        <p>{summary}</p>
      </div>

      {!truncated && advice.length > 0 && (
        <div>
          <p className="coach-section-label">Your 3 Action Points</p>
          <ol className="coach-advice-list">
            {advice.map((point, i) => (
              <li key={i}>
                <span className="coach-num">{i + 1}</span>
                <p>{point}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {truncated && (
        <button type="button" onClick={onExpand} className="coach-expand">
          See full coaching →
        </button>
      )}

      {!truncated && (strengths.length > 0 || focus_areas.length > 0) && (
        <div className="coach-columns">
          <div>
            <p className="coach-col-label success">
              <CheckCircle size={13} strokeWidth={2} /> Strengths
            </p>
            <ul className="coach-list">
              {strengths.map((s, i) => (
                <li key={i}><span className="dot success" />{s}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="coach-col-label warning">
              <Target size={13} strokeWidth={2} /> Focus Areas
            </p>
            <ul className="coach-list">
              {focus_areas.map((f, i) => (
                <li key={i}><span className="dot warning" />{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <style>{`
        .coach-card{
          --bg-card:      #161B22;
          --border:       #30363D;
          --primary:      #4493F8;
          --primary-glow: rgba(68,147,248,0.15);
          --success:      #3FB950;
          --success-glow: rgba(63,185,80,0.15);
          --warning:      #D29922;
          --warning-glow: rgba(210,153,34,0.15);
          --text-hi:      #F0F6FC;
          --text-med:     #8B949E;

          background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:20px;
          display:flex; flex-direction:column; gap:18px;
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          color:var(--text-hi);
        }
        .coach-head{ display:flex; align-items:center; justify-content:space-between; }
        .coach-title{ font-size:14px; font-weight:700; margin:0; }
        .coach-badge{ font-size:11px; font-weight:700; padding:4px 11px; border-radius:100px; }
        .coach-badge.success{ color:var(--success); background:var(--success-glow); }
        .coach-badge.primary{ color:var(--primary); background:var(--primary-glow); }
        .coach-badge.warning{ color:var(--warning); background:var(--warning-glow); }

        .coach-summary{
          border-left:3px solid rgba(68,147,248,0.4); background:var(--primary-glow);
          border-radius:0 8px 8px 0; padding:8px 12px;
        }
        .coach-summary p{ margin:0; font-size:13px; font-style:italic; color:#C9D1D9; }

        .coach-section-label{ font-size:12.5px; font-weight:700; margin:0 0 10px; }
        .coach-advice-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
        .coach-advice-list li{ display:flex; gap:10px; align-items:flex-start; }
        .coach-advice-list p{ margin:0; font-size:13px; line-height:1.55; color:#C9D1D9; }
        .coach-num{
          width:22px; height:22px; border-radius:50%; background:var(--primary); color:#fff;
          font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;
        }

        .coach-expand{ background:none; border:none; cursor:pointer; color:var(--primary); font-size:13px; font-weight:650; padding:0; text-align:left; }
        .coach-expand:hover{ text-decoration:underline; }

        .coach-columns{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        @media (max-width:480px){ .coach-columns{ grid-template-columns:1fr; } }
        .coach-col-label{ display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; margin:0 0 6px; }
        .coach-col-label.success{ color:var(--success); }
        .coach-col-label.warning{ color:var(--warning); }
        .coach-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }
        .coach-list li{ display:flex; align-items:flex-start; gap:7px; font-size:12.5px; color:var(--text-med); line-height:1.5; }
        .coach-list .dot{ width:5px; height:5px; border-radius:50%; margin-top:6px; flex-shrink:0; }
        .coach-list .dot.success{ background:var(--success); }
        .coach-list .dot.warning{ background:var(--warning); }
      `}</style>
    </div>
  )
}
