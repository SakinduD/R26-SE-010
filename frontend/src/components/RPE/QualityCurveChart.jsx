import { useState } from 'react'
import { cn } from '@/lib/utils'

function qualityTone(v) {
  if (v < 4) return 'danger'
  if (v < 7) return 'warning'
  return 'primary'
}
function trustTone(v) {
  if (v >= 70) return 'success'
  if (v >= 40) return 'warning'
  return 'danger'
}
function escalationTone(v) {
  if (v <= 1) return 'success'
  if (v <= 3) return 'warning'
  return 'danger'
}

const TABS = [
  { id: 'quality',    label: 'Response Quality', dataKey: 'qualityCurve',    maxScale: 10,  refLine: 7,  refLabel: 'Target',    toneFn: qualityTone   },
  { id: 'trust',      label: 'Trust Score',       dataKey: 'trustCurve',      maxScale: 100, refLine: 50, refLabel: 'Baseline',  toneFn: trustTone     },
  { id: 'escalation', label: 'Escalation',        dataKey: 'escalationCurve', maxScale: 5,   refLine: 2,  refLabel: 'Safe zone', toneFn: escalationTone },
]

function calcStats(data) {
  if (!data || data.length === 0) return { min: 0, avg: 0, max: 0 }
  const vals = data.map((d) => d.value)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const avg  = vals.reduce((s, v) => s + v, 0) / vals.length
  return { min, avg: Math.round(avg * 10) / 10, max }
}

export default function QualityCurveChart({ qualityCurve = [], trustCurve = [], escalationCurve = [] }) {
  const [activeTab, setActiveTab] = useState('quality')

  const sourceMap = { qualityCurve, trustCurve, escalationCurve }
  const tab = TABS.find((t) => t.id === activeTab)
  const data = sourceMap[tab.dataKey] ?? []
  const stats = calcStats(data)
  const refPct = (tab.refLine / tab.maxScale) * 100

  return (
    <div className="qc-card">
      <div className="qc-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={cn('qc-tab', activeTab === t.id && 'active')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="qc-plot">
        <div className="qc-refline" style={{ bottom: `${(refPct / 100) * 128}px` }}>
          <span className="qc-refline-label">{tab.refLabel}</span>
        </div>

        {data.length === 0 ? (
          <div className="qc-empty">No data available</div>
        ) : (
          <div className="qc-bars">
            {data.map((point, i) => {
              const heightPct = Math.max(2, (point.value / tab.maxScale) * 100)
              return (
                <div key={i} className="qc-col">
                  <span className="qc-val">{point.value}</span>
                  <div className="qc-bar-track">
                    <div className={cn('qc-bar', tab.toneFn(point.value))} style={{ height: `${(heightPct / 100) * 96}px` }} />
                  </div>
                  <span className="qc-turn">{point.turn}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="qc-stats-row">
        {[
          { label: 'Min', value: stats.min },
          { label: 'Avg', value: stats.avg },
          { label: 'Max', value: stats.max },
        ].map(({ label, value }) => (
          <span key={label} className="qc-stat">
            <b>{label}:</b> {value}
          </span>
        ))}
      </div>

      <style>{`
        .qc-card{
          --bg-card:      #161B22;
          --bg-card-hi:   #21262D;
          --border:       #30363D;
          --primary:      #4493F8;
          --success:      #3FB950;
          --warning:      #D29922;
          --danger:       #F85149;
          --text-hi:      #F0F6FC;
          --text-med:     #8B949E;
          --text-low:     #484F58;

          background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:20px;
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          color:var(--text-hi);
        }
        .qc-tabs{ display:flex; gap:20px; border-bottom:1px solid var(--border); margin-bottom:18px; }
        .qc-tab{
          background:none; border:none; cursor:pointer; padding-bottom:9px; font-size:13px;
          color:var(--text-med); border-bottom:2px solid transparent; margin-bottom:-1px; transition:color .2s ease, border-color .2s ease;
        }
        .qc-tab:hover{ color:var(--text-hi); }
        .qc-tab.active{ color:var(--primary); border-bottom-color:var(--primary); font-weight:650; }

        .qc-plot{ position:relative; height:160px; }
        .qc-refline{ position:absolute; left:0; right:0; border-top:1px dashed var(--border); pointer-events:none; z-index:1; }
        .qc-refline-label{ position:absolute; right:0; top:-16px; font-size:10px; color:var(--text-low); background:var(--bg-card); padding:0 4px; }
        .qc-empty{ display:flex; align-items:center; justify-content:center; height:128px; font-size:13px; color:var(--text-low); }

        .qc-bars{ display:flex; align-items:flex-end; gap:6px; height:128px; overflow-x:auto; padding-bottom:0; }
        .qc-col{ display:flex; flex-direction:column; align-items:center; gap:4px; flex-shrink:0; min-width:32px; }
        .qc-val{ font-size:11px; color:var(--text-med); font-weight:600; font-variant-numeric:tabular-nums; line-height:1; }
        .qc-bar-track{ width:32px; height:96px; display:flex; flex-direction:column; justify-content:flex-end; }
        .qc-bar{ width:100%; border-radius:3px 3px 0 0; transition:height .5s cubic-bezier(0.22,1,0.36,1); }
        .qc-bar.primary{ background:var(--primary); }
        .qc-bar.success{ background:var(--success); }
        .qc-bar.warning{ background:var(--warning); }
        .qc-bar.danger{  background:var(--danger); }
        .qc-turn{ font-size:11px; color:var(--text-low); font-variant-numeric:tabular-nums; line-height:1; }

        .qc-stats-row{ display:flex; gap:20px; justify-content:center; margin-top:14px; }
        .qc-stat{ font-size:11.5px; color:var(--text-med); }
        .qc-stat b{ color:var(--text-hi); font-weight:650; }
      `}</style>
    </div>
  )
}
