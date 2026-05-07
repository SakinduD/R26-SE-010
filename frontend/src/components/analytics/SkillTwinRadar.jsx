import React from 'react'

const hasScore = (value) => Number.isFinite(Number(value))
const clampScore = (value) => Math.max(0, Math.min(100, Number(value)))

export default function SkillTwinRadar({ scores }) {
  const normalizedScores = scores.map((item) => ({
    ...item,
    hasEvidence: hasScore(item.value),
    value: hasScore(item.value) ? clampScore(item.value) : 0,
  }))
  const measuredScores = normalizedScores.filter((item) => item.hasEvidence)
  const averageScore = measuredScores.length
    ? Math.round(measuredScores.reduce((total, item) => total + item.value, 0) / measuredScores.length)
    : null

  return (
    <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col items-center justify-center">
        <RadarSvg scores={normalizedScores} />
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Average</span>
          <span className="font-semibold">{averageScore ?? 'N/A'}</span>
        </div>
      </div>
      <div className="space-y-3">
        {normalizedScores.map((item) => (
          <ScoreBar key={item.key} label={item.label} value={item.value} hasEvidence={item.hasEvidence} />
        ))}
      </div>
    </div>
  )
}

function RadarSvg({ scores }) {
  const size = 280
  const center = size / 2
  const radius = 92
  const levels = [25, 50, 75, 100]
  const points = scores.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / scores.length
    const valueRadius = radius * (item.value / 100)
    return {
      ...item,
      x: center + Math.cos(angle) * valueRadius,
      y: center + Math.sin(angle) * valueRadius,
      labelX: center + Math.cos(angle) * (radius + 34),
      labelY: center + Math.sin(angle) * (radius + 34),
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
    }
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-[280px] w-full max-w-[300px]" role="img" aria-label="Skill twin radar chart">
      {levels.map((level) => (
        <circle
          key={level}
          cx={center}
          cy={center}
          r={radius * (level / 100)}
          fill="none"
          stroke="currentColor"
          className="text-border"
        />
      ))}
      {levels.slice(1).map((level) => (
        <text
          key={level}
          x={center + 4}
          y={center - radius * (level / 100)}
          className="fill-muted-foreground text-[9px]"
        >
          {level}
        </text>
      ))}
      {points.map((point) => (
        <line
          key={point.key}
          x1={center}
          y1={center}
          x2={point.axisX}
          y2={point.axisY}
          stroke="currentColor"
          className="text-border"
        />
      ))}
      <polygon
        points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="rgb(14 116 144 / 0.26)"
        stroke="rgb(14 116 144)"
        strokeWidth="2.5"
      />
      {points.map((point) => (
        <g key={point.key}>
          <circle cx={point.x} cy={point.y} r="4" fill="rgb(14 116 144)" />
          <text
            x={point.labelX}
            y={point.labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {point.hasEvidence ? Math.round(point.value) : 'N/A'}
          </text>
        </g>
      ))}
    </svg>
  )
}

function ScoreBar({ label, value, hasEvidence }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 text-muted-foreground">{hasEvidence ? Math.round(value) : 'N/A'}</span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-secondary"
          style={{ width: `${hasEvidence ? value : 0}%` }}
        />
      </div>
    </div>
  )
}
