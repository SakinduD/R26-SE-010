import { CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const SEVERITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' }

function toReadableLabel(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function RiskFlagsPanel({ riskFlags = [], limit }) {
  const displayed = limit ? riskFlags.slice(0, limit) : riskFlags
  const hiddenCount = riskFlags.length - displayed.length

  if (riskFlags.length === 0) {
    return (
      <div className="rp-panel">
        <div className="rp-clear">
          <CheckCircle size={16} strokeWidth={1.8} />
          No risk patterns detected. Great session!
        </div>
        <style>{RP_STYLES}</style>
      </div>
    )
  }

  return (
    <div className="rp-panel">
      <div className="rp-head">
        <h3 className="rp-title">Risk Patterns Detected</h3>
        <span className="rp-count">{riskFlags.length}</span>
      </div>

      <div className="rp-list">
        {displayed.map((flag, i) => (
          <div key={i} className={cn('rp-item', SEVERITY_TONE[flag.severity] ?? 'neutral')}>
            <div className="rp-item-head">
              <span className="rp-item-title">{toReadableLabel(flag.flag_type)}</span>
              <span className={cn('rp-pill', SEVERITY_TONE[flag.severity] ?? 'neutral')}>{flag.severity}</span>
            </div>
            <p className="rp-desc">{flag.description}</p>
            {flag.affected_turns?.length > 0 && (
              <div className="rp-turns">
                <span className="rp-turns-label">Affected turns:</span>
                {flag.affected_turns.map((t) => <span key={t} className="rp-turn-chip">T{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>

      {hiddenCount > 0 && <p className="rp-more">+{hiddenCount} more — see Risk &amp; Blind Spots tab</p>}

      <style>{RP_STYLES}</style>
    </div>
  )
}

const RP_STYLES = `
  .rp-panel{
    --bg-card:      #161B22;
    --bg-card-hi:   #21262D;
    --border:       #30363D;
    --success:      #3FB950;
    --success-glow: rgba(63,185,80,0.1);
    --warning:      #D29922;
    --warning-glow: rgba(210,153,34,0.1);
    --danger:       #F85149;
    --danger-glow:  rgba(248,81,73,0.1);
    --text-hi:      #F0F6FC;
    --text-med:     #8B949E;
    --text-low:     #484F58;

    background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:20px;
    display:flex; flex-direction:column; gap:14px;
    font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
    color:var(--text-hi);
  }
  .rp-clear{ display:flex; align-items:center; gap:8px; font-size:13px; color:var(--success); background:var(--success-glow); border:1px solid rgba(63,185,80,0.25); border-radius:12px; padding:14px 16px; }

  .rp-head{ display:flex; align-items:center; gap:8px; }
  .rp-title{ font-size:14px; font-weight:700; margin:0; }
  .rp-count{ background:var(--danger-glow); color:var(--danger); font-size:11px; font-weight:700; border-radius:100px; padding:1px 8px; }

  .rp-list{ display:flex; flex-direction:column; gap:10px; }
  .rp-item{ border-radius:10px; padding:12px 14px; border:1px solid transparent; }
  .rp-item.danger{ background:var(--danger-glow); border-color:rgba(248,81,73,0.25); }
  .rp-item.warning{ background:var(--warning-glow); border-color:rgba(210,153,34,0.25); }
  .rp-item.neutral{ background:var(--bg-card-hi); border-color:var(--border); }

  .rp-item-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .rp-item-title{ font-size:12.5px; font-weight:650; }
  .rp-pill{ font-size:10px; font-weight:700; text-transform:capitalize; padding:2px 9px; border-radius:100px; }
  .rp-pill.danger{ color:var(--danger); background:rgba(248,81,73,0.15); }
  .rp-pill.warning{ color:var(--warning); background:rgba(210,153,34,0.15); }
  .rp-pill.neutral{ color:var(--text-med); background:var(--bg-card-hi); }

  .rp-desc{ font-size:12.5px; color:var(--text-med); margin:6px 0 0; line-height:1.5; }
  .rp-turns{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .rp-turns-label{ font-size:10.5px; color:var(--text-low); }
  .rp-turn-chip{ font-size:10px; color:var(--text-med); background:var(--bg-card-hi); border-radius:5px; padding:1px 6px; font-variant-numeric:tabular-nums; }

  .rp-more{ font-size:11px; color:var(--text-low); text-align:right; margin:0; }
`
