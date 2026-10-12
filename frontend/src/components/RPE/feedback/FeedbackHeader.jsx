import { ChevronLeft, CheckCircle2, AlertTriangle, Clock, Flag, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

function renderHeaderBadgeIcon(tone) {
  if (tone === 'success') return <CheckCircle2 size={13} strokeWidth={2.5} className="text-emerald-400" />
  if (tone === 'danger') return <AlertTriangle size={13} strokeWidth={2.5} className="text-rose-400" />
  if (tone === 'warning') return <Clock size={13} strokeWidth={2.5} className="text-amber-400" />
  if (tone === 'accent') return <Sparkles size={13} strokeWidth={2.5} className="text-purple-400" />
  return <Flag size={13} strokeWidth={2.5} className="text-slate-400" />
}

// Sticky top band — back button, page title, scenario context, outcome
// badge with clean glassmorphic aesthetic.
export default function FeedbackHeader({ onBack, title, scenarioTitle, difficulty, difficultyTone, badge }) {
  return (
    <div className="fh-wrap">
      <div className="fh-inner">
        <div className="fh-left">
          <button type="button" onClick={onBack} className="fh-back" aria-label="Back">
            <ChevronLeft size={18} strokeWidth={2.2} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 className="fh-title">{title}</h1>
            <div className="fh-subrow">
              <span className="fh-scenario">{scenarioTitle}</span>
              {difficulty && <span className={cn('pill', difficultyTone ?? 'neutral')}>{difficulty}</span>}
            </div>
          </div>
        </div>
        {badge && (
          <span className={cn('pill', badge.tone, 'fh-badge')}>
            <span className="fh-badge-icon">{renderHeaderBadgeIcon(badge.tone)}</span>
            <span>{badge.label}</span>
          </span>
        )}
      </div>

      <style>{`
        .fh-wrap{
          position:sticky; top:0; z-index:20;
          background: rgba(13, 17, 23, 0.78);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        }
        .fh-inner{ max-width:1200px; margin:0 auto; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .fh-left{ display:flex; align-items:center; gap:14px; min-width:0; }
        .fh-back{
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          cursor:pointer; color: #94A3B8;
          width:38px; height:38px; border-radius:12px;
          display:flex; align-items:center; justify-content:center;
          transition: all .2s ease; flex-shrink:0;
        }
        .fh-back:hover{
          background: rgba(124, 58, 237, 0.16);
          color: #C084FC;
          border-color: rgba(168, 85, 247, 0.4);
          transform: translateX(-1px);
        }
        .fh-title{ font-size:18px; font-weight:800; letter-spacing:-0.02em; margin:0; line-height:1.2; color: #F8FAFC; }
        .fh-subrow{ display:flex; align-items:center; gap:8px; margin-top:5px; }
        .fh-scenario{ font-size:12.5px; color:#94A3B8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:550; }
        .fh-badge{ display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; padding:5px 13px; }
        .fh-badge-icon{ display:inline-flex; align-items:center; }
      `}</style>
    </div>
  )
}
