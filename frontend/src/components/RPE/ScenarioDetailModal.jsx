import { useState, useEffect } from 'react'
import { X, Loader2, ChevronRight, ChevronDown, ChevronUp, CheckCircle, XCircle, Clock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_TONE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

const getDifficultyLabel = (weight) => {
  if (weight <= 1.0) return 'Easy start'
  if (weight <= 1.5) return 'Moderate'
  if (weight <= 2.0) return 'Challenging'
  return 'Expert'
}

export default function ScenarioDetailModal({ scenario, onClose, onStart, isStarting }) {
  const [showThresholds, setShowThresholds] = useState(false)

  useEffect(() => {
    if (!scenario) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [scenario, onClose])

  if (!scenario) return null

  const skills    = scenario.target_skills ?? scenario.apa_metadata?.target_skills ?? []
  const traits    = scenario.apa_metadata?.big_five_relevance ?? []
  const weight    = scenario.difficulty_weight ?? scenario.apa_metadata?.difficulty_weight ?? 1.0
  const criteria  = scenario.success_criteria ?? {}
  const behaviour = scenario.npc_behaviour ?? {}
  const trustThr  = behaviour.trust_thresholds ?? {}
  const escThr    = behaviour.escalation_thresholds ?? {}

  return (
    <div className="rpe-modal-backdrop" onClick={onClose}>
      <div className="rpe-modal" onClick={(e) => e.stopPropagation()}>

        <div className="modal-header">
          <div className="header-text">
            <h2 className="modal-title">{scenario.title}</h2>
            <div className="header-pills">
              <span className={cn('pill', DIFFICULTY_TONE[scenario.difficulty] ?? 'neutral')}>{scenario.difficulty}</span>
              <span className="pill neutral">{scenario.conflict_type}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="close-btn" aria-label="Close">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="modal-body">

          {scenario.context && (
            <section>
              <p className="section-label">What's the situation?</p>
              <p className="body-text">{scenario.context}</p>
            </section>
          )}

          <section className="npc-panel">
            <p className="section-label">You'll be talking to</p>
            <p className="npc-role">{scenario.npc_role}</p>
            {scenario.npc_personality && <p className="npc-personality">{scenario.npc_personality}</p>}
            {scenario.opening_npc_line && (
              <div className="opening-line">
                <p className="section-label" style={{ marginBottom: 4 }}>Opening line</p>
                <p className="opening-text">"{scenario.opening_npc_line}"</p>
              </div>
            )}
          </section>

          {(skills.length > 0 || traits.length > 0) && (
            <section>
              <p className="section-label">Skills you'll practice</p>
              {skills.length > 0 && (
                <div className="pill-row" style={{ marginBottom: 8 }}>
                  {skills.map((s) => (
                    <span key={s} className="pill accent">{s.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              )}
              {traits.length > 0 && (
                <div>
                  <p className="micro-label">Big Five relevance</p>
                  <div className="pill-row">
                    {traits.map((t) => (
                      <span key={t} className="pill violet cap">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section>
            <p className="section-label">Session Info</p>
            <div className="info-grid">
              <div className="info-tile">
                <p className="micro-label">Recommended</p>
                <p className="info-value">{scenario.recommended_turns ?? scenario.turns} turns</p>
              </div>
              <div className="info-tile">
                <p className="micro-label">Maximum</p>
                <p className="info-value">{scenario.max_turns ?? (scenario.recommended_turns ?? scenario.turns)} turns</p>
              </div>
              {criteria.min_trust_score != null && (
                <div className="info-tile">
                  <p className="micro-label">Min Trust</p>
                  <p className="info-value success">{criteria.min_trust_score}</p>
                </div>
              )}
              {criteria.max_escalation_level != null && (
                <div className="info-tile">
                  <p className="micro-label">Max Tension</p>
                  <p className="info-value warning">{criteria.max_escalation_level}/5</p>
                </div>
              )}
            </div>
            <div className="weight-row">
              <Zap size={11} strokeWidth={1.8} />
              <span>{getDifficultyLabel(weight)}</span>
            </div>
          </section>

          {(() => {
            const ec = scenario.end_conditions ?? {}
            const successThreshold  = ec.success_trust_threshold     ?? 70
            const consecutiveTurns  = ec.success_consecutive_turns    ?? 2
            const failureEscalation = ec.failure_escalation_threshold ?? 5
            const maxT = scenario.max_turns ?? (scenario.recommended_turns ?? scenario.turns)
            return (
              <section>
                <p className="section-label">How does this session end?</p>
                <div className="end-list">
                  <div className="end-row success">
                    <CheckCircle size={16} strokeWidth={1.8} />
                    <p>Build trust above <b>{successThreshold}</b> for <b>{consecutiveTurns}</b> consecutive turns</p>
                  </div>
                  <div className="end-row danger">
                    <XCircle size={16} strokeWidth={1.8} />
                    <p>Escalation reaches <b>{failureEscalation}/5</b> — the NPC walks out</p>
                  </div>
                  <div className="end-row neutral">
                    <Clock size={16} strokeWidth={1.8} />
                    <p>Maximum of <b>{maxT}</b> turns — scored on final trust and escalation</p>
                  </div>
                </div>
              </section>
            )
          })()}

          {(Object.keys(trustThr).length > 0 || Object.keys(escThr).length > 0) && (
            <section>
              <button type="button" onClick={() => setShowThresholds((v) => !v)} className="threshold-toggle">
                {showThresholds ? <ChevronUp size={12} strokeWidth={1.8} /> : <ChevronDown size={12} strokeWidth={1.8} />}
                {showThresholds ? 'Hide NPC thresholds' : 'Show NPC thresholds'}
              </button>
              {showThresholds && (
                <div className="threshold-panel">
                  {Object.keys(trustThr).length > 0 && (
                    <div>
                      <p className="threshold-title">Trust thresholds</p>
                      {Object.entries(trustThr).map(([k, v]) => (
                        <div key={k} className="threshold-row">
                          <span className="cap">{k}</span><span className="threshold-val">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {Object.keys(escThr).length > 0 && (
                    <div>
                      <p className="threshold-title">Escalation thresholds</p>
                      {Object.entries(escThr).map(([k, v]) => (
                        <div key={k} className="threshold-row">
                          <span className="cap">{k}</span><span className="threshold-val">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="cancel-btn">Cancel</button>
          <button type="button" onClick={() => onStart(scenario)} disabled={isStarting} className="start-btn">
            {isStarting
              ? <><Loader2 size={14} strokeWidth={1.8} className="spin" /> Starting…</>
              : <><ChevronRight size={14} strokeWidth={1.8} /> Start Scenario</>}
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
          --primary:      #4493F8;
          --primary-glow: rgba(68,147,248,0.15);
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
          max-width:560px; width:100%; max-height:88vh; overflow-y:auto;
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
          background:linear-gradient(90deg, rgba(68,147,248,0.08), var(--bg-card));
          border-bottom:1px solid var(--border);
          padding:18px 22px; display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
          border-radius:18px 18px 0 0;
        }
        .rpe-modal .header-text{ flex:1; min-width:0; }
        .rpe-modal .modal-title{ font-size:17px; font-weight:750; line-height:1.35; margin:0; }
        .rpe-modal .header-pills{ display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
        .rpe-modal .close-btn{
          flex-shrink:0; background:none; border:none; cursor:pointer; color:var(--text-med);
          padding:6px; border-radius:8px; display:flex; transition:background .2s ease, color .2s ease;
        }
        .rpe-modal .close-btn:hover{ background:var(--bg-card-hi); color:var(--text-hi); }

        .rpe-modal .modal-body{ padding:20px 22px; display:flex; flex-direction:column; gap:20px; }

        .rpe-modal .section-label{ font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:var(--text-low); margin:0 0 8px; }
        .rpe-modal .micro-label{ font-size:10px; color:var(--text-low); text-transform:uppercase; letter-spacing:.08em; margin:0 0 4px; }
        .rpe-modal .body-text{ font-size:13.5px; line-height:1.6; color:#C9D1D9; margin:0; }
        .rpe-modal .cap{ text-transform:capitalize; }

        .rpe-modal .pill{
          display:inline-flex; align-items:center; font-size:11px; font-weight:650;
          padding:3px 10px; border-radius:100px; text-transform:capitalize;
        }
        .rpe-modal .pill.success{ color:var(--success); background:var(--success-glow); }
        .rpe-modal .pill.warning{ color:var(--warning); background:var(--warning-glow); }
        .rpe-modal .pill.danger{  color:var(--danger);  background:var(--danger-glow); }
        .rpe-modal .pill.accent{  color:var(--accent);  background:var(--accent-glow); text-transform:none; }
        .rpe-modal .pill.violet{  color:#A78BFA; background:rgba(167,139,250,0.12); }
        .rpe-modal .pill.neutral{ color:var(--text-med); background:var(--bg-card-hi); text-transform:none; }
        .rpe-modal .pill-row{ display:flex; flex-wrap:wrap; gap:6px; }

        .rpe-modal .npc-panel{ background:var(--bg-card-hi); border:1px solid var(--border); border-radius:12px; padding:14px 16px; }
        .rpe-modal .npc-role{ font-size:14px; font-weight:700; margin:0; }
        .rpe-modal .npc-personality{ font-size:12.5px; color:var(--text-med); font-style:italic; margin:3px 0 0; }
        .rpe-modal .opening-line{
          margin-top:12px; background:var(--bg-card); border-radius:10px; padding:10px 12px;
          border-left:3px solid rgba(68,147,248,0.6);
        }
        .rpe-modal .opening-text{ font-size:13px; font-style:italic; color:var(--text-hi); margin:0; }

        .rpe-modal .info-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .rpe-modal .info-tile{ background:var(--bg-card-hi); border:1px solid var(--border); border-radius:10px; padding:9px 12px; }
        .rpe-modal .info-value{ font-size:13.5px; font-weight:700; margin:0; }
        .rpe-modal .info-value.success{ color:var(--success); }
        .rpe-modal .info-value.warning{ color:var(--warning); }
        .rpe-modal .weight-row{ margin-top:10px; display:flex; align-items:center; gap:6px; font-size:12px; font-weight:650; color:var(--primary); }

        .rpe-modal .end-list{ display:flex; flex-direction:column; gap:8px; }
        .rpe-modal .end-row{ display:flex; align-items:flex-start; gap:10px; border-radius:10px; padding:10px 12px; font-size:13px; border:1px solid transparent; }
        .rpe-modal .end-row p{ margin:0; }
        .rpe-modal .end-row.success{ background:var(--success-glow); border-color:rgba(63,185,80,0.25); color:var(--text-hi); }
        .rpe-modal .end-row.success svg{ color:var(--success); flex-shrink:0; margin-top:1px; }
        .rpe-modal .end-row.danger{ background:var(--danger-glow); border-color:rgba(248,81,73,0.25); color:var(--text-hi); }
        .rpe-modal .end-row.danger svg{ color:var(--danger); flex-shrink:0; margin-top:1px; }
        .rpe-modal .end-row.neutral{ background:var(--bg-card-hi); border-color:var(--border); color:var(--text-med); }
        .rpe-modal .end-row.neutral svg{ color:var(--text-med); flex-shrink:0; margin-top:1px; }
        .rpe-modal .end-row b{ color:var(--text-hi); }

        .rpe-modal .threshold-toggle{
          display:inline-flex; align-items:center; gap:6px; background:none; border:none; cursor:pointer;
          color:var(--text-med); font-size:12px; font-weight:600; transition:color .2s ease;
        }
        .rpe-modal .threshold-toggle:hover{ color:var(--text-hi); }
        .rpe-modal .threshold-panel{ margin-top:10px; background:var(--bg-card-hi); border:1px solid var(--border); border-radius:10px; padding:12px; font-size:12px; color:var(--text-med); display:flex; flex-direction:column; gap:10px; }
        .rpe-modal .threshold-title{ font-weight:700; color:var(--text-hi); margin:0 0 4px; }
        .rpe-modal .threshold-row{ display:flex; justify-content:space-between; padding:2px 0; }
        .rpe-modal .threshold-val{ font-weight:600; color:var(--text-hi); }

        .rpe-modal .modal-footer{
          position:sticky; bottom:0; display:flex; gap:10px; justify-content:flex-end;
          padding:16px 22px; background:var(--bg-card); border-top:1px solid var(--border); border-radius:0 0 18px 18px;
        }
        .rpe-modal .cancel-btn{
          background:none; border:none; cursor:pointer; color:var(--text-med); font-size:13px; font-weight:600;
          padding:9px 16px; border-radius:9px; transition:background .2s ease, color .2s ease;
        }
        .rpe-modal .cancel-btn:hover{ background:var(--bg-card-hi); color:var(--text-hi); }
        .rpe-modal .start-btn{
          display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer;
          background:linear-gradient(135deg, var(--primary), #6BB2FF); color:#fff;
          font-size:13px; font-weight:650; padding:9px 18px; border-radius:10px;
          transition:filter .2s ease;
        }
        .rpe-modal .start-btn:hover:not(:disabled){ filter:brightness(1.08); }
        .rpe-modal .start-btn:disabled{ opacity:.55; cursor:default; }
        .rpe-modal .spin{ animation:rpeModalSpin .75s linear infinite; }
        @keyframes rpeModalSpin{ to{ transform:rotate(360deg); } }
      `}</style>
    </div>
  )
}
