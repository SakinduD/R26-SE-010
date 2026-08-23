import { AlertTriangle, CheckCircle } from 'lucide-react'

function toReadableLabel(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function BlindSpotsPanel({ blindSpots = [], limit }) {
  const displayed = limit ? blindSpots.slice(0, limit) : blindSpots
  const hiddenCount = blindSpots.length - displayed.length

  if (blindSpots.length === 0) {
    return (
      <div className="bs-panel">
        <div className="bs-clear">
          <CheckCircle size={16} strokeWidth={1.8} />
          No blind spots here — nice work!
        </div>
        <style>{BS_STYLES}</style>
      </div>
    )
  }

  return (
    <div className="bs-panel">
      <div>
        <h3 className="bs-title">Your Blind Spots</h3>
        <p className="bs-sub">Patterns where you kept falling short</p>
      </div>

      <div className="bs-list">
        {displayed.map((spot, i) => (
          <div key={i} className="bs-item">
            <div className="bs-item-head">
              <AlertTriangle size={15} strokeWidth={1.8} />
              <span>{toReadableLabel(spot.blind_spot_type)}</span>
            </div>
            <p className="bs-desc">{spot.description}</p>
            {spot.affected_turns?.length > 0 && (
              <div className="bs-turns">
                <span className="bs-turns-label">Affected turns:</span>
                {spot.affected_turns.map((t) => <span key={t} className="bs-turn-chip">T{t}</span>)}
              </div>
            )}
            {spot.recommendation && (
              <div className="bs-rec">
                <p className="bs-rec-label">Recommendation</p>
                <p className="bs-rec-text">{spot.recommendation}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {hiddenCount > 0 && <p className="bs-more">+{hiddenCount} more — see the Heads-Up &amp; Blind Spots tab</p>}

      <style>{BS_STYLES}</style>
    </div>
  )
}

const BS_STYLES = `
  .bs-panel{
    --bg-card:      #161B22;
    --border:       #30363D;
    --success:      #3FB950;
    --success-glow: rgba(63,185,80,0.1);
    --warning:      #D29922;
    --warning-glow: rgba(210,153,34,0.1);
    --text-hi:      #F0F6FC;
    --text-med:     #8B949E;
    --text-low:     #484F58;

    background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:20px;
    display:flex; flex-direction:column; gap:16px;
    font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
    color:var(--text-hi);
  }
  .bs-clear{ display:flex; align-items:center; gap:8px; font-size:13px; color:var(--success); background:var(--success-glow); border:1px solid rgba(63,185,80,0.25); border-radius:12px; padding:14px 16px; }

  .bs-title{ font-size:14px; font-weight:700; margin:0; }
  .bs-sub{ font-size:11.5px; color:var(--text-med); margin:3px 0 0; }

  .bs-list{ display:flex; flex-direction:column; gap:12px; }
  .bs-item{ border-radius:10px; padding:14px; background:var(--warning-glow); border:1px solid rgba(210,153,34,0.25); }
  .bs-item-head{ display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:650; color:var(--warning); }
  .bs-desc{ font-size:12.5px; color:var(--text-med); margin:8px 0 0; line-height:1.5; }

  .bs-turns{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .bs-turns-label{ font-size:10.5px; color:var(--text-low); }
  .bs-turn-chip{ font-size:10px; color:var(--text-med); background:rgba(0,0,0,0.25); border-radius:5px; padding:1px 6px; font-variant-numeric:tabular-nums; }

  .bs-rec{ background:rgba(0,0,0,0.2); border:1px solid rgba(210,153,34,0.25); border-radius:8px; padding:8px 10px; margin-top:10px; }
  .bs-rec-label{ font-size:10px; font-weight:700; color:var(--warning); margin:0 0 3px; }
  .bs-rec-text{ font-size:12px; color:var(--text-hi); margin:0; line-height:1.5; }

  .bs-more{ font-size:11px; color:var(--text-low); text-align:right; margin:0; }
`
