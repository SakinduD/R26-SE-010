import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// One risk_flag or blind_spot as an expandable card. Only blind_spots carry
// a real `recommendation` field (risk_flags don't — see rpe/schemas.py) —
// this only ever shows a "Try this" section when one genuinely exists,
// rather than fabricating advice for flag types that don't have any.
export default function WatchForCard({ index, Icon, tone, label, description, affectedTurns = [], recommendation }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('wf-card', tone)}>
      <button
        type="button"
        className="wf-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wf-index">{String(index + 1).padStart(2, '0')}</span>
        <Icon size={16} strokeWidth={1.8} className="wf-icon" />
        <span className="wf-label">{label}</span>
        <ChevronDown size={15} strokeWidth={2} className={cn('wf-chevron', open && 'open')} />
      </button>

      <div className={cn('wf-body', open && 'open')}>
        <div className="wf-body-inner">
          <div className="wf-section">
            <p className="wf-section-label">What happened</p>
            <p className="wf-section-text">{description}</p>
          </div>
          {affectedTurns.length > 0 && (
            <div className="wf-section">
              <p className="wf-section-label">Turns</p>
              <div className="wf-turns">
                {affectedTurns.map((t) => <span key={t} className="wf-turn-chip">T{t}</span>)}
              </div>
            </div>
          )}
          {recommendation && (
            <div className="wf-section">
              <p className="wf-section-label">Try this</p>
              <p className="wf-section-text">{recommendation}</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .wf-card{
          border-radius:16px; border:1px solid transparent; overflow:hidden;
          box-shadow:0 6px 18px rgba(17,12,34,0.05);
          transition:border-color .15s var(--ease), box-shadow .15s var(--ease), transform .15s var(--ease);
        }
        .wf-card.danger{  background:var(--danger-glow);  border-color:rgba(248,81,73,0.25); }
        .wf-card.warning{ background:var(--warning-glow); border-color:rgba(210,153,34,0.25); }
        .wf-card:hover{ border-color:currentColor; transform:translateY(-1px); box-shadow:0 10px 24px rgba(17,12,34,0.08); }

        .wf-head{
          width:100%; display:flex; align-items:center; gap:12px; padding:14px 16px;
          background:none; border:none; cursor:pointer; text-align:left; font-family:inherit;
        }
        .wf-index{ font-size:11px; font-weight:800; font-variant-numeric:tabular-nums; opacity:.6; flex-shrink:0; }
        .wf-icon{ flex-shrink:0; }
        .wf-label{ flex:1; font-size:13.5px; font-weight:700; color:var(--text-hi); }
        .wf-chevron{ flex-shrink:0; transition:transform .2s var(--ease); color:var(--text-med); }
        .wf-chevron.open{ transform:rotate(180deg); }

        .wf-body{ display:grid; grid-template-rows:0fr; transition:grid-template-rows .25s var(--ease); }
        .wf-body.open{ grid-template-rows:1fr; }
        .wf-body-inner{ overflow:hidden; display:flex; flex-direction:column; gap:12px; padding:0 16px; }
        .wf-body.open .wf-body-inner{ padding:0 16px 16px 42px; }

        .wf-section-label{ font-size:10px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--text-low); margin:0 0 4px; }
        .wf-section-text{ font-size:12.5px; line-height:1.55; color:var(--text-hi); margin:0; }
        .wf-turns{ display:flex; flex-wrap:wrap; gap:6px; }
        .wf-turn-chip{ font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:100px; background:var(--surface); color:var(--text-med); }
      `}</style>
    </div>
  )
}
