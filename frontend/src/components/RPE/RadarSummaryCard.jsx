import { useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

const TREND_CONFIG = {
  improving: { icon: TrendingUp,   tone: 'success', label: 'Improving' },
  declining: { icon: TrendingDown, tone: 'danger',  label: 'Declining' },
  stable:    { icon: Minus,        tone: 'warning', label: 'Stable'    },
}

const EMOTION_TONE = {
  calm:       'success',
  assertive:  'accent',
  anxious:    'warning',
  frustrated: 'danger',
  confused:   'neutral',
}

function RadarChart({ axes }) {
  const [hovered, setHovered] = useState(null)
  const size   = 260
  const center = size / 2
  const radius = 84
  const levels = [25, 50, 75, 100]

  const points = axes.map((axis, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / axes.length
    const r = radius * (axis.value / 100)
    return {
      ...axis,
      x: center + Math.cos(angle) * r,
      y: center + Math.sin(angle) * r,
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      labelX: center + Math.cos(angle) * (radius + 30),
      labelY: center + Math.sin(angle) * (radius + 30),
    }
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="radar-svg" role="img" aria-label="Performance radar chart">
      {levels.map((level) => (
        <circle key={level} cx={center} cy={center} r={radius * (level / 100)} className="radar-ring" />
      ))}
      {points.map((p) => (
        <line key={p.key} x1={center} y1={center} x2={p.axisX} y2={p.axisY} className="radar-axis" />
      ))}

      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        className="radar-shape"
      />
      {points.map((p) => (
        <circle
          key={'d-' + p.key}
          cx={p.x} cy={p.y} r="4"
          className="radar-dot"
          onMouseEnter={() => setHovered(p.key)}
          onMouseLeave={() => setHovered(null)}
        />
      ))}

      {points.map((p) => (
        <text
          key={'l-' + p.key}
          x={p.labelX} y={p.labelY}
          textAnchor="middle" dominantBaseline="middle"
          className={cn('radar-label', hovered === p.key && 'active')}
        >
          {p.label}
        </text>
      ))}

      {points.map((p) => hovered === p.key && (
        <g key={'t-' + p.key} transform={`translate(${Math.min(Math.max(p.labelX - 26, 4), size - 56)}, ${p.labelY - 24})`}>
          <rect width="52" height="20" rx="6" className="radar-tooltip-bg" />
          <text x="26" y="14" textAnchor="middle" className="radar-tooltip-text">{Math.round(p.rawLabel ?? p.value)}</text>
        </g>
      ))}
    </svg>
  )
}

export default function RadarSummaryCard({ summaryScores, emotionDistribution = {} }) {
  if (!summaryScores) return null

  const {
    avg_trust        = 0,
    avg_escalation   = 0,
    avg_quality      = 0,
    trust_trend      = 'stable',
    dominant_emotion = 'calm',
  } = summaryScores

  const axes = [
    { key: 'trust',     label: 'Trust',     value: Math.max(0, Math.min(100, avg_trust)), rawLabel: avg_trust },
    { key: 'composure', label: 'Composure', value: Math.max(0, Math.min(100, Math.round((5 - avg_escalation) / 5 * 100))), rawLabel: avg_escalation },
    { key: 'quality',   label: 'Quality',   value: Math.max(0, Math.min(100, Math.round(avg_quality * 10))), rawLabel: avg_quality },
  ]

  const trend = TREND_CONFIG[trust_trend] ?? TREND_CONFIG.stable
  const TrendIcon = trend.icon

  const totalEmotions  = Object.values(emotionDistribution).reduce((s, c) => s + c, 0)
  const emotionEntries = Object.entries(emotionDistribution).sort((a, b) => b[1] - a[1])

  return (
    <div className="radar-card">
      <h3 className="radar-title">Performance Summary</h3>

      <div className="radar-layout">
        <div className="radar-chart-col">
          <RadarChart axes={axes} />
          <div className="radar-stats">
            <div className="radar-stat">
              <span className="radar-stat-label">Trust</span>
              <span className="radar-stat-val">{avg_trust}<span className="unit">/100</span></span>
            </div>
            <div className="radar-stat">
              <span className="radar-stat-label">Escalation</span>
              <span className="radar-stat-val">{avg_escalation}<span className="unit">/5</span></span>
            </div>
            <div className="radar-stat">
              <span className="radar-stat-label">Quality</span>
              <span className="radar-stat-val">{avg_quality}<span className="unit">/10</span></span>
            </div>
          </div>
        </div>

        <div className="radar-side-col">
          <div className="side-row">
            <span className="side-label">Trust Trend</span>
            <span className={cn('side-badge', trend.tone)}>
              <TrendIcon size={13} strokeWidth={2} /> {trend.label}
            </span>
          </div>

          <div className="side-row">
            <span className="side-label">Dominant Emotion</span>
            <span className={cn('side-badge', EMOTION_TONE[dominant_emotion] ?? 'neutral')}>
              <span className="cap">{dominant_emotion}</span>
            </span>
          </div>

          <div>
            <span className="side-label" style={{ marginBottom: 8, display: 'block' }}>Emotion Breakdown</span>
            {emotionEntries.length === 0 ? (
              <p className="no-data">No data</p>
            ) : (
              <div className="emotion-bars">
                {emotionEntries.map(([emotion, count]) => {
                  const pct = totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
                  return (
                    <div key={emotion} className="emotion-row">
                      <span className="emotion-name cap">{emotion}</span>
                      <div className="emotion-track">
                        <div className={cn('emotion-fill', EMOTION_TONE[emotion] ?? 'neutral')} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="emotion-pct">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .radar-card{
          --bg-card:      #161B22;
          --bg-card-hi:   #21262D;
          --border:       #30363D;
          --primary:      #4493F8;
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

          background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:20px;
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          color:var(--text-hi);
        }
        .radar-card .cap{ text-transform:capitalize; }
        .radar-title{ font-size:14px; font-weight:700; margin:0 0 16px; }

        .radar-layout{ display:grid; grid-template-columns:minmax(0,260px) minmax(0,1fr); gap:20px; align-items:center; }
        @media (max-width:520px){ .radar-layout{ grid-template-columns:1fr; } }

        .radar-chart-col{ display:flex; flex-direction:column; align-items:center; gap:14px; }
        .radar-svg{ width:100%; max-width:240px; height:auto; overflow:visible; }
        .radar-ring{ fill:none; stroke:var(--border); stroke-opacity:.6; }
        .radar-axis{ stroke:var(--border); stroke-opacity:.6; }
        .radar-shape{ fill:rgba(68,147,248,0.22); stroke:var(--primary); stroke-width:2; }
        .radar-dot{ fill:var(--primary); cursor:pointer; }
        .radar-label{ font-size:9px; fill:var(--text-med); }
        .radar-label.active{ fill:var(--text-hi); font-weight:700; }
        .radar-tooltip-bg{ fill:#0D1117; stroke:var(--border); }
        .radar-tooltip-text{ font-size:10px; fill:var(--text-hi); font-weight:700; }

        .radar-stats{ display:flex; gap:16px; }
        .radar-stat{ display:flex; flex-direction:column; align-items:center; gap:2px; }
        .radar-stat-label{ font-size:9.5px; color:var(--text-low); text-transform:uppercase; letter-spacing:.08em; }
        .radar-stat-val{ font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; }
        .radar-stat-val .unit{ font-size:10px; font-weight:500; color:var(--text-med); }

        .radar-side-col{ display:flex; flex-direction:column; gap:16px; min-width:0; }
        .side-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .side-label{ font-size:11px; color:var(--text-med); font-weight:600; }
        .side-badge{
          display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:650;
          padding:4px 10px; border-radius:100px;
        }
        .side-badge.success{ color:var(--success); background:var(--success-glow); }
        .side-badge.warning{ color:var(--warning); background:var(--warning-glow); }
        .side-badge.danger{  color:var(--danger);  background:var(--danger-glow); }
        .side-badge.accent{  color:var(--accent);  background:var(--accent-glow); }
        .side-badge.neutral{ color:var(--text-med); background:var(--bg-card-hi); }

        .no-data{ font-size:11.5px; color:var(--text-low); margin:0; }
        .emotion-bars{ display:flex; flex-direction:column; gap:6px; }
        .emotion-row{ display:flex; align-items:center; gap:8px; }
        .emotion-name{ font-size:10.5px; color:var(--text-med); width:64px; flex-shrink:0; }
        .emotion-track{ flex:1; height:6px; background:var(--bg-card-hi); border-radius:100px; overflow:hidden; }
        .emotion-fill{ height:100%; border-radius:100px; transition:width .6s cubic-bezier(0.22,1,0.36,1); }
        .emotion-fill.success{ background:var(--success); }
        .emotion-fill.warning{ background:var(--warning); }
        .emotion-fill.danger{  background:var(--danger); }
        .emotion-fill.accent{  background:var(--accent); }
        .emotion-fill.neutral{ background:var(--text-low); }
        .emotion-pct{ font-size:10px; color:var(--text-low); width:30px; text-align:right; flex-shrink:0; }
      `}</style>
    </div>
  )
}
