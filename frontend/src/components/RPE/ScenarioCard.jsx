import { Loader2, ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_TONE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

const toPlainText = (str) => str.replace(/_/g, ' ')

export default function ScenarioCard({ scenario, onStart, onViewDetail, isStarting }) {
  const diffTone    = DIFFICULTY_TONE[scenario.difficulty] ?? 'neutral'
  const isGenerated = !!scenario.is_generated
  const turns       = scenario.recommended_turns ?? scenario.turns

  return (
    <div className="rpe-card" onClick={() => onViewDetail(scenario)}>
      <div className="card-body">
        {isGenerated && (
          <span className="generated-badge">
            <Sparkles size={10} strokeWidth={2} /> Personalized
          </span>
        )}

        <div className="card-head">
          <h3 className="card-title">{scenario.title}</h3>
          <span className={cn('diff-badge', diffTone)}>
            <span className="dot" />{scenario.difficulty}
          </span>
        </div>

        <p className="card-situation">
          {scenario.context || toPlainText(scenario.conflict_type)}
        </p>

        <p className="card-desc">~{turns} exchanges</p>

        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onViewDetail(scenario)} className="link-btn">
            View Details
          </button>
          <button type="button" onClick={() => onStart(scenario)} disabled={isStarting} className="start-btn">
            {isStarting
              ? <><Loader2 size={13} strokeWidth={1.8} className="spin" /> Starting…</>
              : <><ChevronRight size={13} strokeWidth={1.8} /> Start</>}
          </button>
        </div>
      </div>

      <style>{`
        .rpe-card{
          --bg-card:      #161B22;
          --bg-card-hi:   #21262D;
          --border:       #30363D;
          --accent:       #7C3AED;
          --accent-glow:  rgba(124,58,237,0.15);
          --success:      #3FB950;
          --warning:      #D29922;
          --danger:       #F85149;
          --text-hi:      #F0F6FC;
          --text-med:     #8B949E;
          --text-low:     #484F58;

          background:var(--bg-card); border:1px solid var(--border); border-radius:14px;
          cursor:pointer; display:flex; flex-direction:column; height:100%;
          transition:border-color .2s ease, transform .2s ease, box-shadow .2s ease;
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
        }
        .rpe-card:hover{ border-color:rgba(124,58,237,0.4); transform:translateY(-2px); box-shadow:0 14px 30px rgba(0,0,0,0.35); }

        .rpe-card .generated-badge{
          display:inline-flex; align-items:center; gap:4px; align-self:flex-start;
          font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
          color:var(--accent); background:var(--accent-glow); border:1px solid rgba(124,58,237,0.35);
          padding:3px 9px; border-radius:100px; margin-bottom:2px;
        }

        .rpe-card .card-body{ padding:18px; display:flex; flex-direction:column; gap:10px; flex:1; }

        .rpe-card .card-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
        .rpe-card .card-title{ font-size:15px; font-weight:700; color:var(--text-hi); line-height:1.35; margin:0; }
        .rpe-card:hover .card-title{ color:var(--accent); }

        .rpe-card .diff-badge{
          display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:650;
          padding:3px 10px; border-radius:100px; text-transform:capitalize; flex-shrink:0; white-space:nowrap;
          background:var(--bg-card-hi); border:1px solid var(--border); color:var(--text-med);
        }
        .rpe-card .diff-badge .dot{ width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .rpe-card .diff-badge.success .dot{ background:var(--success); }
        .rpe-card .diff-badge.warning .dot{ background:var(--warning); }
        .rpe-card .diff-badge.danger  .dot{ background:var(--danger); }
        .rpe-card .diff-badge.neutral .dot{ background:var(--text-low); }

        .rpe-card .card-situation{
          font-size:13px; color:var(--text-med); line-height:1.5; margin:0;
          display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
        }

        .rpe-card .card-desc{ font-size:12px; color:var(--text-low); margin:0; }

        .rpe-card .card-actions{ margin-top:auto; padding-top:8px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .rpe-card .link-btn{
          background:none; border:none; padding:0; cursor:pointer;
          color:var(--text-med); font-size:12.5px; font-weight:600; transition:color .2s ease;
        }
        .rpe-card .link-btn:hover{ color:var(--text-hi); text-decoration:underline; }
        .rpe-card .start-btn{
          display:inline-flex; align-items:center; gap:6px; border:none; cursor:pointer;
          background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff;
          font-size:12.5px; font-weight:650; padding:8px 14px; border-radius:9px;
          transition:filter .2s ease;
        }
        .rpe-card .start-btn:hover:not(:disabled){ filter:brightness(1.08); }
        .rpe-card .start-btn:disabled{ opacity:.55; cursor:default; }
        .rpe-card .spin{ animation:rpeCardSpin .75s linear infinite; }
        @keyframes rpeCardSpin{ to{ transform:rotate(360deg); } }

        :root[data-theme="light"] .rpe-card{
          --bg-card:      #FFFFFF;
          --bg-card-hi:   #EFEAFB;
          --border:       #D9CFF5;
          --accent:       #6B3FD6;
          --accent-glow:  rgba(107,63,214,0.12);
          --success:      #1E8E4A;
          --warning:      #B4790E;
          --danger:       #D93B32;
          --text-hi:      #241E38;
          --text-med:     #5E5678;
          --text-low:     #8D84A8;
        }
        :root[data-theme="light"] .rpe-card{ box-shadow:0 1px 3px rgba(36,30,56,0.08); }
        :root[data-theme="light"] .rpe-card:hover{ box-shadow:0 14px 30px rgba(36,30,56,0.12); }
      `}</style>
    </div>
  )
}
