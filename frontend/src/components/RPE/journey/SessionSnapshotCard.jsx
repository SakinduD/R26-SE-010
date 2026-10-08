import { BarChart2, Clock3, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_TONE = { beginner: 'success', intermediate: 'warning', advanced: 'danger' }

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null
  const ms = new Date(endedAt) - new Date(startedAt)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.round(ms / 60000)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

function trustTone(v) {
  if (v == null) return 'neutral'
  return v >= 70 ? 'success' : v >= 40 ? 'warning' : 'danger'
}

// Redesign of the old SessionCard — trust is the headline metric now
// (matches the Trust Journey chart above it), escalation/duration are
// secondary. Status is a small icon + word next to the title rather than a
// loud colored block. No sparkline/insight text is rendered — that would
// need per-turn or coaching data this list view doesn't fetch (avoiding an
// extra request per card); showing it only where real data exists, per the
// same rule as everywhere else on this page.
export default function SessionSnapshotCard({ session, status, scenarioInfo, onOpenFeedback, onResumeSession, selectMode, selected, onToggleSelect }) {
  const duration = formatDuration(session.started_at, session.ended_at)

  return (
    <div
      className={cn('ssc-card', status.tone, selectMode && 'selectable', selected && 'selected')}
      onClick={() => selectMode && onToggleSelect(session.session_id)}
    >
      <span className="ssc-accent" aria-hidden />

      {selectMode && (
        <label className="ssc-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(session.session_id)} />
        </label>
      )}

      <div className="ssc-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="ssc-title">{scenarioInfo?.title ?? session.scenario_id}</h3>
          <div className="ssc-meta-row">
            {scenarioInfo?.difficulty && <span className={cn('ssc-pill', DIFFICULTY_TONE[scenarioInfo.difficulty] ?? 'neutral')}>{scenarioInfo.difficulty}</span>}
            <span className="ssc-date">{formatDate(session.started_at)}</span>
          </div>
        </div>
        <span className={cn('ssc-status', status.tone)}>
          <status.Icon size={12} strokeWidth={2.2} /> {status.label}
        </span>
      </div>

      {session.ended_at ? (
        <div className="ssc-stats">
          <div className="ssc-stat primary">
            <span className={cn('ssc-stat-val', trustTone(session.final_trust))}>{session.final_trust ?? '—'}</span>
            <span className="ssc-stat-label">Trust</span>
          </div>
          <div className="ssc-stat">
            <span className="ssc-stat-val">{session.final_escalation ?? '—'}<span className="ssc-unit">/5</span></span>
            <span className="ssc-stat-label">Escalation</span>
          </div>
          <div className="ssc-stat">
            <span className="ssc-stat-val small">
              {duration ? <><Clock3 size={11} strokeWidth={2} /> {duration}</> : '—'}
            </span>
            <span className="ssc-stat-label">Duration</span>
          </div>
        </div>
      ) : (
        <div className="ssc-noresult">
          <Clock3 size={14} strokeWidth={1.8} />
          <span>Left mid-conversation — no results recorded</span>
        </div>
      )}

      {!selectMode && session.ended_at && (
        <div className="ssc-actions">
          <button type="button" onClick={() => onOpenFeedback(session.session_id)} className="btn-c primary">
            <BarChart2 size={13} strokeWidth={1.8} /> View analysis
          </button>
        </div>
      )}

      {!selectMode && !session.ended_at && (
        <div className="ssc-actions">
          <button type="button" onClick={() => onResumeSession(session.session_id)} className="btn-c secondary">
            <RotateCcw size={13} strokeWidth={1.8} /> Resume
          </button>
        </div>
      )}

      <style>{`
        .ssc-card{
          position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--border); border-radius:16px;
          padding:18px 18px 18px 22px; display:flex; flex-direction:column; gap:14px;
          box-shadow:0 8px 22px rgba(17,12,34,0.05);
          transition:border-color .2s var(--ease), transform .2s var(--ease), box-shadow .2s var(--ease);
        }
        .ssc-card:hover{ border-color:rgba(124,58,237,0.35); transform:translateY(-2px); box-shadow:0 14px 30px rgba(17,12,34,0.09); }
        .ssc-card.selectable{ cursor:pointer; padding-left:50px; }
        .ssc-card.selected{ border-color:rgba(124,58,237,0.6); background:var(--accent-glow); }
        .ssc-check{ position:absolute; top:18px; left:20px; display:flex; z-index:1; }
        .ssc-check input{ width:17px; height:17px; accent-color:var(--accent); cursor:pointer; }

        .ssc-accent{ position:absolute; top:0; left:0; bottom:0; width:3px; background:var(--border); }
        .ssc-card.success .ssc-accent{ background:var(--success); }
        .ssc-card.danger  .ssc-accent{ background:var(--danger); }
        .ssc-card.neutral .ssc-accent{ background:var(--text-low); }

        .ssc-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
        .ssc-title{ font-size:14.5px; font-weight:700; margin:0; line-height:1.3; }
        .ssc-meta-row{ display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap; }
        .ssc-date{ font-size:11px; color:var(--text-low); }

        .ssc-pill{ display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:650; padding:3px 10px; border-radius:100px; text-transform:capitalize; flex-shrink:0; white-space:nowrap; }
        .ssc-pill.success{ color:var(--success); background:var(--success-glow); }
        .ssc-pill.warning{ color:var(--warning); background:var(--warning-glow); }
        .ssc-pill.danger{  color:var(--danger);  background:var(--danger-glow); }
        .ssc-pill.neutral{ color:var(--text-med); background:var(--surface-hi); }

        .ssc-status{ display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:650; flex-shrink:0; white-space:nowrap; padding-top:2px; }
        .ssc-status.success{ color:var(--success); }
        .ssc-status.danger{  color:var(--danger); }
        .ssc-status.neutral{ color:var(--text-low); }

        .ssc-stats{ display:flex; align-items:baseline; gap:20px; }
        .ssc-stat{ display:flex; flex-direction:column; gap:1px; }
        .ssc-stat-label{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--text-low); }
        .ssc-stat-val{ font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--text-hi); }
        .ssc-stat.primary .ssc-stat-val{ font-size:26px; font-weight:800; letter-spacing:-0.01em; }
        .ssc-stat-val.small{ font-size:11.5px; display:inline-flex; align-items:center; gap:4px; }
        .ssc-stat-val.success{ color:var(--success); }
        .ssc-stat-val.warning{ color:var(--warning); }
        .ssc-stat-val.danger{  color:var(--danger); }
        .ssc-unit{ font-size:10px; font-weight:500; color:var(--text-med); }

        .ssc-noresult{
          display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-low); font-style:italic;
          background:var(--surface-hi); border-radius:10px; padding:10px 12px;
        }

        .ssc-actions{ display:flex; justify-content:flex-end; margin-top:auto; padding-top:2px; }
      `}</style>
    </div>
  )
}
