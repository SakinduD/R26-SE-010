import React, { useState } from 'react'

const hasScore = (value) => Number.isFinite(Number(value))
const clampScore = (value) => Math.max(0, Math.min(100, Number(value)))

export default function SkillTwinRadar({ scores, selfScores, overallScore }) {
  const normalizedScores = scores.map((item) => ({
    ...item,
    hasEvidence: hasScore(item.value),
    value: hasScore(item.value) ? clampScore(item.value) : 0,
  }))

  const selfMap = {}
  if (Array.isArray(selfScores)) {
    selfScores.forEach((s) => { if (s.key && hasScore(s.value)) selfMap[s.key] = clampScore(s.value) })
  }
  const hasSelfData = Object.keys(selfMap).length > 0

  const measuredScores = normalizedScores.filter((item) => item.hasEvidence)
  const averageScore = measuredScores.length
    ? Math.round(measuredScores.reduce((total, item) => total + item.value, 0) / measuredScores.length)
    : null

  return (
    <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col items-center justify-center">
        <RadarSvg scores={normalizedScores} selfMap={selfMap} hasSelfData={hasSelfData} />
        {/* Legend */}
        <div className="mt-4 flex items-center gap-5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{background:'rgba(14,116,144,0.4)', border:'2px solid rgb(14,116,144)'}} />
            <span className="text-muted-foreground font-medium">Observed</span>
          </div>
          {hasSelfData && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{background:'rgba(245,158,11,0.3)', border:'2px solid rgb(245,158,11)'}} />
              <span className="text-muted-foreground font-medium">Self Rating</span>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex flex-col justify-center space-y-4">
        {/* Skill Bars Section */}
        <div className="space-y-3">
          {normalizedScores.map((item) => (
            <ScoreBar
              key={item.key}
              label={item.label}
              value={item.value}
              selfValue={selfMap[item.key]}
              hasEvidence={item.hasEvidence}
              hasSelfData={hasSelfData}
            />
          ))}
        </div>

        {/* Separator for Overall Result */}
        <div className="pt-2">
          <div className="border-t border-border pt-4">
            <ScoreBar
              label="OVERALL SKILLS SCORE"
              value={overallScore}
              hasEvidence={true}
              isOverall={true}
            />
            <p className="text-[10px] text-muted-foreground mt-1.5 italic">
              This score represents your combined performance across all analyzed skills.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function RadarSvg({ scores, selfMap, hasSelfData }) {
  const [hovered, setHovered] = useState(null)
  const size = 360
  const center = size / 2
  const radius = 90
  const levels = [25, 50, 75, 100]

  const points = scores.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / scores.length
    const valueRadius = radius * (item.value / 100)
    const selfVal = selfMap[item.key] || 0
    const selfRadius = radius * (selfVal / 100)
    return {
      ...item,
      x: center + Math.cos(angle) * valueRadius,
      y: center + Math.sin(angle) * valueRadius,
      selfX: center + Math.cos(angle) * selfRadius,
      selfY: center + Math.sin(angle) * selfRadius,
      selfVal,
      hasSelf: selfVal > 0,
      labelX: center + Math.cos(angle) * (radius + 32),
      labelY: center + Math.sin(angle) * (radius + 32),
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
    }
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[340px] overflow-visible" role="img" aria-label="Skill twin radar chart">
      {levels.map((level) => (
        <circle key={level} cx={center} cy={center} r={radius * (level / 100)} fill="none" stroke="currentColor" strokeOpacity="0.1" />
      ))}
      {levels.slice(1).map((level) => (
        <text key={level} x={center + 4} y={center - radius * (level / 100)} className="fill-muted-foreground text-[8px] opacity-50">{level}</text>
      ))}
      {points.map((point) => (
        <line key={point.key} x1={center} y1={center} x2={point.axisX} y2={point.axisY} stroke="currentColor" strokeOpacity="0.1" />
      ))}

      {hasSelfData && (
        <>
          <polygon
            points={points.map((p) => `${p.selfX},${p.selfY}`).join(' ')}
            fill="rgba(245, 158, 11, 0.15)"
            stroke="rgb(245, 158, 11)"
            strokeWidth="2"
            strokeDasharray="4 2"
          />
          {points.map((p) => (
            p.hasSelf && <circle key={'s-'+p.key} cx={p.selfX} cy={p.selfY} r="3" fill="rgb(245, 158, 11)" />
          ))}
        </>
      )}

      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="rgba(14, 116, 144, 0.2)"
        stroke="rgb(14, 116, 144)"
        strokeWidth="2"
      />
      {points.map((p) => (
        <circle key={'o-'+p.key} cx={p.x} cy={p.y} r="3.5" fill="rgb(14, 116, 144)" />
      ))}

      {points.map((point) => (
        <g key={'lbl-'+point.key}
          onMouseEnter={() => setHovered(point.key)}
          onMouseLeave={() => setHovered(null)}
          style={{cursor:'pointer'}}
        >
          <circle cx={point.labelX} cy={point.labelY} r="15" fill="transparent" />
          <text x={point.labelX} y={point.labelY} textAnchor="middle" dominantBaseline="middle"
            className="fill-muted-foreground text-[10px]" fontWeight={hovered === point.key ? 'bold' : 'normal'}>
            {point.hasEvidence ? Math.round(point.value) : '0'}
          </text>

          {hovered === point.key && (
            <g transform={`translate(${point.labelX > center ? -125 : 5}, 15)`}>
              <rect x="0" y="0" width="120"
                height={hasSelfData && point.hasSelf ? 48 : 34} rx="6"
                fill="rgba(15,23,42,0.95)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <text x="60" y="16" textAnchor="middle" className="text-[10px]" fill="white" fontWeight="bold">
                {point.label}
              </text>
              <text x="35" y="32" textAnchor="middle" className="text-[9px]" fill="rgb(14,186,197)">
                Obs: {point.hasEvidence ? Math.round(point.value) : '--'}
              </text>
              {hasSelfData && point.hasSelf && (
                <text x="85" y="32" textAnchor="middle" className="text-[9px]" fill="rgb(245,158,11)">
                  Self: {Math.round(point.selfVal)}
                </text>
              )}
              {hasSelfData && point.hasSelf && (
                <text x="60" y="42" textAnchor="middle" className="text-[8px]"
                  fill={point.selfVal > point.value ? '#fca5a5' : '#86efac'}>
                  Gap: {Math.abs(Math.round(point.selfVal - point.value))} pts
                </text>
              )}
            </g>
          )}
        </g>
      ))}
    </svg>
  )
}

function ScoreBar({ label, value, selfValue, hasEvidence, hasSelfData, isOverall }) {
  const hasSelf = Number.isFinite(selfValue)
  const barColor = isOverall ? 'rgb(139, 92, 246)' : 'rgb(14, 116, 144)'
  
  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 items-end">
        <span className={`min-w-0 truncate ${isOverall ? 'text-xs font-bold tracking-wider' : 'text-sm'}`}>
          {label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {hasSelfData && hasSelf && (
            <span style={{color:'rgb(245,158,11)'}} className="text-xs font-medium">{Math.round(selfValue)}</span>
          )}
          <span className={`${isOverall ? 'text-sm' : 'text-xs text-muted-foreground'} font-bold`}>
            {hasEvidence ? Math.round(value) : 'N/A'}
          </span>
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        {hasSelfData && hasSelf && (
          <div className="absolute top-0 left-0 h-2 rounded-full" style={{ width: `${selfValue}%`, backgroundColor: 'rgba(245,158,11,0.4)' }} />
        )}
        <div className="relative h-2 rounded-full" style={{ width: `${hasEvidence ? value : 0}%`, backgroundColor: barColor }} />
      </div>
    </div>
  )
}
