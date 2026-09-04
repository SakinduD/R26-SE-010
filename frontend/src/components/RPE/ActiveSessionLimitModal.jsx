import { X, Clock3, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// Shown when start-session comes back 409 active_session_limit — the
// learner already has MAX_ACTIVE_SESSIONS (3) unfinished sessions, so
// starting a new one is blocked until one of these is finished or resumed.
// scenarioTitle(session) resolves a display title from whatever scenario
// list the caller already has in memory (ScenarioSelect's allScenarios) —
// this modal never fetches on its own, it just renders what start-session's
// error payload handed back.

// Relative-to-now read of how long a session has been sitting unfinished —
// far more useful here than an absolute timestamp: "3 days ago" tells you
// at a glance which of these is actually worth abandoning, a raw date/time
// makes you do that math yourself. Exact timestamp still lives in the
// title attribute for anyone who wants it.
function timeAgo(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { label: '', stale: false }
  const minutes = Math.floor((Date.now() - d.getTime()) / 60000)
  if (minutes < 1) return { label: 'Just now', stale: false }
  if (minutes < 60) return { label: `${minutes}m ago`, stale: false }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { label: `${hours}h ago`, stale: hours >= 6 }
  const days = Math.floor(hours / 24)
  if (days === 1) return { label: 'Yesterday', stale: true }
  if (days < 30) return { label: `${days} days ago`, stale: true }
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), stale: true }
}

export default function ActiveSessionLimitModal({ sessions, scenarioTitle, onClose }) {
  const navigate = useNavigate()
  if (!sessions) return null

  const exactTime = (iso) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="asl-backdrop" onClick={onClose}>
      <div className="asl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="asl-header">
          <div>
            <h2 className="asl-title">You've got {sessions.length} sessions in progress</h2>
            <p className="asl-sub">
              Finish or resume one of these before starting another.
              {sessions.length > 6 && ` Showing the 6 most recent.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="asl-close" aria-label="Close">
            <X size={17} strokeWidth={1.8} />
          </button>
        </div>

        <div className="asl-list">
          {sessions.slice(0, 6).map((s) => {
            const age = timeAgo(s.started_at)
            return (
              <button
                key={s.session_id}
                type="button"
                className="asl-item"
                onClick={() => navigate(`/roleplay/session/${s.session_id}`)}
              >
                <div className="asl-item-icon"><Clock3 size={16} strokeWidth={1.8} /></div>
                <div className="asl-item-text">
                  <span className="asl-item-title">{scenarioTitle(s.scenario_id)}</span>
                  <span className="asl-item-date">Started</span>
                </div>
                <span className={age.stale ? 'asl-age stale' : 'asl-age'} title={exactTime(s.started_at)}>
                  {age.label}
                </span>
                <ArrowRight size={15} strokeWidth={1.8} className="asl-item-arrow" />
              </button>
            )
          })}
        </div>

        <button
          type="button"
          className="asl-viewall"
          onClick={() => navigate('/roleplay/my-sessions')}
        >
          View all in My Journey
        </button>

        <style>{`
          .asl-backdrop{
            position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:24px;
            background:rgba(6,8,12,0.72); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
          }
          :root[data-theme="light"] .asl-backdrop{ background:rgba(36,30,56,0.35); }

          .asl-modal{
            --bg-card:      #161B22;
            --bg-card-hi:   #21262D;
            --border:       #30363D;
            --accent:       #7C3AED;
            --accent-glow:  rgba(124,58,237,0.15);
            --warning:      #D29922;
            --warning-glow: rgba(210,153,34,0.14);
            --text-hi:      #F0F6FC;
            --text-med:     #8B949E;

            background:var(--bg-card); border:1px solid var(--border); border-radius:20px;
            max-width:600px; width:100%; padding:32px;
            box-shadow:0 30px 70px rgba(0,0,0,0.5);
            font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
            color:var(--text-hi);
            opacity:0; transform:translateY(16px) scale(0.98);
            animation: aslModalIn .3s cubic-bezier(0.22,1,0.36,1) forwards;
          }
          @keyframes aslModalIn{ to{ opacity:1; transform:none; } }

          :root[data-theme="light"] .asl-modal{
            --bg-card:      #FFFFFF;
            --bg-card-hi:   #EFEAFB;
            --border:       #D9CFF5;
            --accent:       #6B3FD6;
            --accent-glow:  rgba(107,63,214,0.10);
            --warning:      #B4790E;
            --warning-glow: rgba(180,121,14,0.12);
            --text-hi:      #241E38;
            --text-med:     #5E5678;
          }

          .asl-header{ display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
          .asl-title{ font-size:20px; font-weight:750; margin:0; letter-spacing:-0.01em; }
          .asl-sub{ font-size:13.5px; color:var(--text-med); margin:8px 0 0; }
          .asl-close{
            background:var(--bg-card-hi); border:1px solid var(--border); border-radius:9px; color:var(--text-med);
            width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;
          }
          .asl-close:hover{ color:var(--text-hi); }

          .asl-list{
            display:flex; flex-direction:column; gap:10px; margin-top:24px;
            max-height:360px; overflow-y:auto;
            scrollbar-width:none; -ms-overflow-style:none;
          }
          .asl-list::-webkit-scrollbar{ display:none; }

          .asl-item{
            display:flex; align-items:center; gap:14px; width:100%; text-align:left;
            background:var(--bg-card-hi); border:1px solid var(--border); border-radius:14px; padding:14px 16px;
            cursor:pointer; font-family:inherit; transition:border-color .15s ease, background .15s ease;
          }
          .asl-item:hover{ border-color:var(--accent); background:var(--accent-glow); }
          .asl-item-icon{
            width:36px; height:36px; border-radius:10px; background:var(--accent-glow); color:var(--accent);
            display:flex; align-items:center; justify-content:center; flex-shrink:0;
          }
          .asl-item-text{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
          .asl-item-title{ font-size:14px; font-weight:650; color:var(--text-hi); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .asl-item-date{ font-size:11px; color:var(--text-med); text-transform:uppercase; letter-spacing:.04em; }
          .asl-age{
            font-size:12px; font-weight:650; color:var(--text-med); flex-shrink:0; white-space:nowrap;
            padding:4px 10px; border-radius:100px; background:var(--bg-card);
          }
          .asl-age.stale{ color:var(--warning); background:var(--warning-glow); }
          .asl-item-arrow{ color:var(--text-med); flex-shrink:0; }

          .asl-viewall{
            width:100%; margin-top:18px; background:none; border:1px solid var(--border); border-radius:11px;
            color:var(--text-med); font-size:13.5px; font-weight:650; padding:12px; cursor:pointer; font-family:inherit;
          }
          .asl-viewall:hover{ color:var(--text-hi); border-color:var(--accent); }
        `}</style>
      </div>
    </div>
  )
}
