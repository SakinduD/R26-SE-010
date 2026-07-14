import { Loader2, ChevronRight, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_TONE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

const getDifficultyStars = (weight) => {
  if (weight <= 1.0) return { label: 'Easy start',  tone: 'success' }
  if (weight <= 1.5) return { label: 'Moderate',    tone: 'warning' }
  if (weight <= 2.0) return { label: 'Challenging', tone: 'warning' }
  return              { label: 'Expert',        tone: 'danger'  }
}

export default function ScenarioCard({ scenario, onStart, onViewDetail, isStarting }) {
  const skills        = scenario.target_skills ?? scenario.apa_metadata?.target_skills ?? []
  const weight        = scenario.difficulty_weight ?? scenario.apa_metadata?.difficulty_weight ?? 1.0
  const stars         = getDifficultyStars(weight)
  const diffTone      = DIFFICULTY_TONE[scenario.difficulty] ?? 'neutral'
  const visibleSkills = skills.slice(0, 3)
  const extraSkills   = skills.length - 3

  return (
    <div className="rpe-card" onClick={() => onViewDetail(scenario)}>
      <div className={cn('accent-bar', diffTone)} />

      <div className="card-body">
        <div className="card-head">
          <h3 className="card-title">{scenario.title}</h3>
          <span className={cn('pill', diffTone)}>{scenario.difficulty}</span>
        </div>

        <div className="card-meta">
          <span className="pill neutral">{scenario.conflict_type}</span>
          <div className="turns-info">
            <span className="turns-main">~{scenario.recommended_turns ?? scenario.turns} turns</span>
            {scenario.max_turns && <span className="turns-sub">up to {scenario.max_turns} max</span>}
          </div>
        </div>

        <div className="end-hints">
          {scenario.end_conditions?.success_trust_threshold != null && (
            <span className="hint">Resolves at trust ≥ {scenario.end_conditions.success_trust_threshold}</span>
          )}
          {scenario.end_conditions?.failure_escalation_threshold != null && (
            <span className="hint danger">NPC exits at escalation ≥ {scenario.end_conditions.failure_escalation_threshold}/5</span>
          )}
        </div>

        {visibleSkills.length > 0 && (
          <div>
            <p className="section-label">Skills</p>
            <div className="skill-row">
              {visibleSkills.map((skill) => (
                <span key={skill} className="pill accent">{skill.replace(/_/g, ' ')}</span>
              ))}
              {extraSkills > 0 && <span className="extra-skills">+{extraSkills} more</span>}
            </div>
          </div>
        )}

        <p className={cn('weight-label', stars.tone)}>
          <Zap size={11} strokeWidth={1.8} />
          {stars.label}
        </p>

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
          --primary:      #4493F8;
          --primary-glow: rgba(68,147,248,0.15);
          --accent:       #7C3AED;
          --accent-glow:  rgba(124,58,237,0.15);
          --success:      #3FB950;
          --success-glow: rgba(63,185,80,0.15);
          --warning:      #D29922;
          --warning-glow: rgba(210,153,34,0.15);
          --danger:       #F85149;
          --danger-glow:  rgba(248,81,73,0.15);
          --text-hi:      #F0F6FC;
          --text-med:     #8B949E;
          --text-low:     #484F58;

          background:var(--bg-card); border:1px solid var(--border); border-radius:14px;
          overflow:hidden; cursor:pointer; display:flex; flex-direction:column;
          transition:border-color .2s ease, transform .2s ease, box-shadow .2s ease;
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
        }
        .rpe-card:hover{ border-color:rgba(68,147,248,0.4); transform:translateY(-2px); box-shadow:0 14px 30px rgba(0,0,0,0.35); }

        .rpe-card .accent-bar{ height:3px; width:100%; }
        .rpe-card .accent-bar.success{ background:var(--success); }
        .rpe-card .accent-bar.warning{ background:var(--warning); }
        .rpe-card .accent-bar.danger{  background:var(--danger); }
        .rpe-card .accent-bar.neutral{ background:var(--border); }

        .rpe-card .card-body{ padding:18px; display:flex; flex-direction:column; gap:11px; flex:1; }

        .rpe-card .card-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
        .rpe-card .card-title{ font-size:15px; font-weight:700; color:var(--text-hi); line-height:1.35; margin:0; }
        .rpe-card:hover .card-title{ color:var(--primary); }

        .rpe-card .pill{
          display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:650;
          padding:3px 10px; border-radius:100px; text-transform:capitalize; flex-shrink:0; white-space:nowrap;
        }
        .rpe-card .pill.success{ color:var(--success); background:var(--success-glow); }
        .rpe-card .pill.warning{ color:var(--warning); background:var(--warning-glow); }
        .rpe-card .pill.danger{  color:var(--danger);  background:var(--danger-glow); }
        .rpe-card .pill.accent{  color:var(--accent);  background:var(--accent-glow); text-transform:none; }
        .rpe-card .pill.neutral{ color:var(--text-med); background:var(--bg-card-hi); text-transform:none; }

        .rpe-card .card-meta{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .rpe-card .turns-info{ display:flex; flex-direction:column; line-height:1.3; }
        .rpe-card .turns-main{ font-size:11.5px; color:var(--text-med); }
        .rpe-card .turns-sub{ font-size:10px; color:var(--text-low); }

        .rpe-card .end-hints{ display:flex; flex-wrap:wrap; gap:4px 12px; }
        .rpe-card .hint{ font-size:10.5px; color:var(--text-low); font-style:italic; }
        .rpe-card .hint.danger{ color:rgba(248,81,73,0.75); }

        .rpe-card .section-label{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:var(--text-low); margin:0 0 6px; }
        .rpe-card .skill-row{ display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
        .rpe-card .extra-skills{ font-size:11px; color:var(--text-med); }

        .rpe-card .weight-label{ display:flex; align-items:center; gap:5px; font-size:11px; font-weight:650; margin:0; }
        .rpe-card .weight-label.success{ color:var(--success); }
        .rpe-card .weight-label.warning{ color:var(--warning); }
        .rpe-card .weight-label.danger{  color:var(--danger); }

        .rpe-card .card-actions{ margin-top:auto; padding-top:6px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .rpe-card .link-btn{
          background:none; border:none; padding:0; cursor:pointer;
          color:var(--primary); font-size:12.5px; font-weight:600;
        }
        .rpe-card .link-btn:hover{ text-decoration:underline; }
        .rpe-card .start-btn{
          display:inline-flex; align-items:center; gap:6px; border:none; cursor:pointer;
          background:linear-gradient(135deg, var(--primary), #6BB2FF); color:#fff;
          font-size:12.5px; font-weight:650; padding:8px 14px; border-radius:9px;
          transition:filter .2s ease;
        }
        .rpe-card .start-btn:hover:not(:disabled){ filter:brightness(1.08); }
        .rpe-card .start-btn:disabled{ opacity:.55; cursor:default; }
        .rpe-card .spin{ animation:rpeCardSpin .75s linear infinite; }
        @keyframes rpeCardSpin{ to{ transform:rotate(360deg); } }
      `}</style>
    </div>
  )
}
