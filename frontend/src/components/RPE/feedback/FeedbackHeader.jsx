import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// Sticky top band — back button, page title, scenario context, outcome
// badge. Same content the old inline header had, just its own component so
// FeedbackDashboard isn't one 600-line file.
export default function FeedbackHeader({ onBack, title, scenarioTitle, difficulty, difficultyTone, badge }) {
  return (
    <div className="fh-wrap">
      <div className="fh-inner">
        <div className="fh-left">
          <button type="button" onClick={onBack} className="fh-back" aria-label="Back">
            <ChevronLeft size={18} strokeWidth={1.6} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 className="fh-title">{title}</h1>
            <div className="fh-subrow">
              <span className="fh-scenario">{scenarioTitle}</span>
              {difficulty && <span className={cn('pill', difficultyTone ?? 'neutral')}>{difficulty}</span>}
            </div>
          </div>
        </div>
        {badge && <span className={cn('pill', badge.tone)}>{badge.label}</span>}
      </div>

      <style>{`
        .fh-wrap{
          position:sticky; top:0; z-index:20; background:var(--header-backdrop); backdrop-filter:blur(10px);
          border-bottom:1px solid var(--border); box-shadow:0 6px 20px rgba(17,12,34,0.05);
        }
        .fh-inner{ max-width:1200px; margin:0 auto; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .fh-left{ display:flex; align-items:center; gap:14px; min-width:0; }
        .fh-back{
          background:var(--surface); border:1px solid var(--border); cursor:pointer; color:var(--text-med);
          width:36px; height:36px; border-radius:10px;
          display:flex; align-items:center; justify-content:center; transition:background .2s ease, color .2s ease, border-color .2s ease; flex-shrink:0;
        }
        .fh-back:hover{ background:var(--accent-glow); color:var(--accent); border-color:rgba(124,58,237,0.25); }
        .fh-title{ font-size:17.5px; font-weight:800; letter-spacing:-0.01em; margin:0; line-height:1.2; }
        .fh-subrow{ display:flex; align-items:center; gap:8px; margin-top:5px; }
        .fh-scenario{ font-size:12px; color:var(--text-med); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      `}</style>
    </div>
  )
}
