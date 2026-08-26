import { useEffect } from 'react'
import { X, Loader2, ChevronRight, CheckCircle, AlertTriangle, Clock, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_TONE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

export default function ScenarioDetailModal({ scenario, onClose, onStart, isStarting }) {
  useEffect(() => {
    if (!scenario) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [scenario, onClose])

  if (!scenario) return null

  const skills           = scenario.target_skills ?? scenario.apa_metadata?.target_skills ?? []
  const recommendedTurns = scenario.recommended_turns ?? scenario.turns
  const maxTurns         = scenario.max_turns ?? recommendedTurns
  const diffTone         = DIFFICULTY_TONE[scenario.difficulty] ?? 'neutral'

  return (
    <div className="rpe-modal-backdrop" onClick={onClose}>
      <div className="rpe-modal" onClick={(e) => e.stopPropagation()}>

        <div className="modal-header">
          <div className="header-text">
            <h2 className="modal-title">{scenario.title}</h2>
            <div className="header-pills">
              <span className={cn('diff-badge', diffTone)}>
                <span className="dot" />{scenario.difficulty}
              </span>
              {scenario.is_generated && (
                <span className="pill accent"><Sparkles size={10} strokeWidth={2} /> Personalized</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="close-btn" aria-label="Close">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-grid">

            <div className="col col-story">
              <section className="info-block">
                <p className="block-label">Situation</p>
                {scenario.context
                  ? <p className="block-text">{scenario.context}</p>
                  : <div className="block-skel" />}
              </section>

              <section className="info-block">
                <p className="block-label">The Roles</p>
                {scenario.npc_role ? (
                  <>
                    <div className="role-row">
                      <span className="role-label">You</span>
                      <span className="role-val">The employee in this conversation</span>
                    </div>
                    <div className="role-row">
                      <span className="role-label">Them</span>
                      <span className="role-val">
                        <b>{scenario.npc_role}</b>{scenario.npc_personality ? `, ${scenario.npc_personality}` : ''}
                      </span>
                    </div>
                  </>
                ) : <div className="block-skel" />}
              </section>

              {scenario.opening_npc_line && (
                <section className="opening-line">
                  <p className="opening-text">"{scenario.opening_npc_line}"</p>
                </section>
              )}
            </div>

            <div className="col col-practice">
              <section className="info-block">
                <p className="block-label">What You'll Practice</p>
                {skills.length > 0 ? (
                  <ul className="chip-list">
                    {skills.map((s) => (
                      <li key={s}><CheckCircle size={13} strokeWidth={2} /> {s.replace(/_/g, ' ')}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="block-text">General workplace conversation practice.</p>
                )}
              </section>

              <section className="info-block">
                <p className="block-label">How It Works</p>
                <ul className="plain-list">
                  <li>
                    <Clock size={14} strokeWidth={2} />
                    Usually about <b>{recommendedTurns}</b> exchanges
                    {maxTurns > recommendedTurns && <> (up to <b>{maxTurns}</b> if you need more time)</>}
                  </li>
                  <li>
                    <CheckCircle size={14} strokeWidth={2} className="tone-success" />
                    Ends well once you've built solid, lasting trust with them
                  </li>
                  <li>
                    <AlertTriangle size={14} strokeWidth={2} className="tone-warning" />
                    Tension may rise along the way, that's expected, and it won't cut the conversation short
                  </li>
                </ul>
                <p className="evaluated-note">What's evaluated: trust, tone, and how the conversation resolves</p>
              </section>
            </div>

          </div>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="cancel-btn">Cancel</button>
          <button type="button" onClick={() => onStart(scenario)} disabled={isStarting} className="start-btn">
            {isStarting
              ? <><Loader2 size={14} strokeWidth={1.8} className="spin" /> Starting…</>
              : <><ChevronRight size={14} strokeWidth={1.8} /> Enter Simulation</>}
          </button>
        </div>
      </div>

      <style>{`
        .rpe-modal-backdrop{
          position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; padding:16px;
          background:rgba(6,8,12,0.72); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        }
        .rpe-modal{
          --bg-card:      #161B22;
          --bg-card-hi:   #21262D;
          --border:       #30363D;
          --accent:       #7C3AED;
          --accent-glow:  rgba(124,58,237,0.15);
          --success:      #3FB950;
          --success-glow: rgba(63,185,80,0.12);
          --warning:      #D29922;
          --warning-glow: rgba(210,153,34,0.12);
          --danger:       #F85149;
          --danger-glow:  rgba(248,81,73,0.12);
          --text-hi:      #F0F6FC;
          --text-med:     #8B949E;
          --text-low:     #484F58;

          background:var(--bg-card); border:1px solid var(--border); border-radius:18px;
          max-width:840px; width:100%; max-height:88vh; overflow-y:auto;
          box-shadow:0 30px 70px rgba(0,0,0,0.5);
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          color:var(--text-hi);
          opacity:0; transform:translateY(16px) scale(0.98);
          animation: rpeModalIn .3s cubic-bezier(0.22,1,0.36,1) forwards;
        }
        @keyframes rpeModalIn{ to{ opacity:1; transform:none; } }
        .rpe-modal::-webkit-scrollbar{ width:8px; }
        .rpe-modal::-webkit-scrollbar-thumb{ background:var(--bg-card-hi); border-radius:100px; }

        .rpe-modal .modal-header{
          position:sticky; top:0; z-index:1;
          background:linear-gradient(90deg, rgba(124,58,237,0.08), var(--bg-card));
          border-bottom:1px solid var(--border);
          padding:20px 30px; display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
          border-radius:18px 18px 0 0;
        }
        .rpe-modal .header-text{ flex:1; min-width:0; }
        .rpe-modal .modal-title{ font-size:18px; font-weight:750; line-height:1.35; margin:0; }
        .rpe-modal .header-pills{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:9px; }
        .rpe-modal .close-btn{
          flex-shrink:0; background:none; border:none; cursor:pointer; color:var(--text-med);
          padding:6px; border-radius:8px; display:flex; transition:background .2s ease, color .2s ease;
        }
        .rpe-modal .close-btn:hover{ background:var(--bg-card-hi); color:var(--text-hi); }

        .rpe-modal .modal-body{ padding:26px 30px; }

        .rpe-modal .diff-badge{
          display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:650;
          padding:3px 10px; border-radius:100px; text-transform:capitalize; flex-shrink:0; white-space:nowrap;
          background:var(--bg-card-hi); border:1px solid var(--border); color:var(--text-med);
        }
        .rpe-modal .diff-badge .dot{ width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .rpe-modal .diff-badge.success .dot{ background:var(--success); }
        .rpe-modal .diff-badge.warning .dot{ background:var(--warning); }
        .rpe-modal .diff-badge.danger  .dot{ background:var(--danger); }
        .rpe-modal .diff-badge.neutral .dot{ background:var(--text-low); }

        .rpe-modal .pill{
          display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:650;
          padding:3px 10px; border-radius:100px; text-transform:capitalize;
        }
        .rpe-modal .pill.accent{ color:var(--accent); background:var(--accent-glow); text-transform:none; }

        .rpe-modal .modal-grid{ display:grid; grid-template-columns:1.15fr 1fr; gap:0 36px; }
        .rpe-modal .col{ display:flex; flex-direction:column; }
        .rpe-modal .col-story{ padding-right:36px; border-right:1px solid var(--border); }

        .rpe-modal .info-block{ margin-bottom:22px; }
        .rpe-modal .info-block:last-child{ margin-bottom:0; }
        .rpe-modal .block-label{
          font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
          color:var(--accent); margin:0 0 9px;
        }
        .rpe-modal .block-text{ font-size:13.5px; line-height:1.65; color:#C9D1D9; margin:0; }

        .rpe-modal .block-skel{
          height:14px; width:82%; border-radius:5px;
          background:linear-gradient(90deg, var(--bg-card-hi) 25%, var(--border) 50%, var(--bg-card-hi) 75%);
          background-size:200% 100%; animation: rpeModalShimmer 1.4s ease-in-out infinite;
        }
        @keyframes rpeModalShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

        .rpe-modal .role-row{ display:flex; align-items:baseline; gap:10px; margin:0 0 7px; }
        .rpe-modal .role-row:last-child{ margin-bottom:0; }
        .rpe-modal .role-label{
          flex-shrink:0; width:44px; font-size:10px; font-weight:700; letter-spacing:.06em;
          text-transform:uppercase; color:var(--text-low);
        }
        .rpe-modal .role-val{ font-size:13.5px; color:#C9D1D9; line-height:1.55; }
        .rpe-modal .role-val b{ color:var(--text-hi); }

        .rpe-modal .opening-line{
          margin-top:auto; background:var(--bg-card-hi); border-radius:10px; padding:12px 14px;
          border-left:3px solid rgba(124,58,237,0.6);
        }
        .rpe-modal .opening-text{ font-size:13px; font-style:italic; color:var(--text-hi); margin:0; }

        .rpe-modal .evaluated-note{ font-size:11.5px; color:var(--text-low); margin:12px 0 0; }

        .rpe-modal .chip-list{ display:flex; flex-wrap:wrap; gap:8px; margin:0; padding:0; list-style:none; }
        .rpe-modal .chip-list li{
          display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600;
          color:var(--text-hi); text-transform:capitalize; background:var(--bg-card-hi);
          border:1px solid var(--border); border-radius:100px; padding:5px 12px 5px 10px;
        }
        .rpe-modal .chip-list li svg{ flex-shrink:0; color:var(--accent); }

        .rpe-modal .plain-list{ display:flex; flex-direction:column; gap:9px; margin:0; padding:0; list-style:none; }
        .rpe-modal .plain-list li{
          display:flex; align-items:flex-start; gap:8px; font-size:13.5px; line-height:1.5; color:var(--text-hi);
        }
        .rpe-modal .plain-list li svg{ flex-shrink:0; margin-top:2px; color:var(--accent); }
        .rpe-modal .plain-list li svg.tone-success{ color:var(--success); }
        .rpe-modal .plain-list li svg.tone-warning{ color:var(--warning); }
        .rpe-modal .plain-list li b{ color:var(--text-hi); }

        .rpe-modal .modal-footer{
          position:sticky; bottom:0; display:flex; gap:10px; justify-content:flex-end;
          padding:18px 30px; background:var(--bg-card); border-top:1px solid var(--border); border-radius:0 0 18px 18px;
        }
        .rpe-modal .cancel-btn{
          background:none; border:none; cursor:pointer; color:var(--text-med); font-size:13px; font-weight:600;
          padding:9px 16px; border-radius:9px; transition:background .2s ease, color .2s ease;
        }
        .rpe-modal .cancel-btn:hover{ background:var(--bg-card-hi); color:var(--text-hi); }
        .rpe-modal .start-btn{
          display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer;
          background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff;
          font-size:13px; font-weight:650; padding:9px 18px; border-radius:10px;
          transition:filter .2s ease;
        }
        .rpe-modal .start-btn:hover:not(:disabled){ filter:brightness(1.08); }
        .rpe-modal .start-btn:disabled{ opacity:.55; cursor:default; }
        .rpe-modal .spin{ animation:rpeModalSpin .75s linear infinite; }
        @keyframes rpeModalSpin{ to{ transform:rotate(360deg); } }

        @media (max-width:640px){
          .rpe-modal .modal-grid{ grid-template-columns:1fr; gap:22px 0; }
          .rpe-modal .col-story{ padding-right:0; padding-bottom:22px; border-right:none; border-bottom:1px solid var(--border); }
        }
      `}</style>
    </div>
  )
}
