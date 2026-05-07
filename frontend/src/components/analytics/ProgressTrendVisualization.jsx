import React, { useMemo } from 'react'
import { Activity, TrendingDown, TrendingUp } from 'lucide-react'

const TREND_COLORS = {
  improving: 'rgb(5 150 105)',
  stable: 'rgb(14 116 144)',
  declining: 'rgb(157 23 77)',
  insufficient_data: 'rgb(161 161 170)',
}

export default function ProgressTrendVisualization({ trends, labelFor }) {
  const visibleTrends = useMemo(
    () => trends.filter((item) => item.points?.length > 1).slice(0, 5),
    [trends]
  )
  const singleSessionTrends = useMemo(
    () => trends.filter((item) => item.points?.length === 1).slice(0, 4),
    [trends]
  )

  if (!visibleTrends.length) {
    if (!singleSessionTrends.length) {
      return <EmptyState text="No trend history yet" />
    }

    return (
      <div className="space-y-3">
        <EmptyState text="One real session is available. Add another session to calculate progress trends." />
        <div className="grid gap-2 sm:grid-cols-2">
          {singleSessionTrends.map((item) => (
            <SingleSessionTrendRow key={item.skill_area} item={item} labelFor={labelFor} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <TrendSummary trends={visibleTrends} />
      <MultiTrendChart trends={visibleTrends} labelFor={labelFor} />
      <div className="grid gap-2 sm:grid-cols-2">
        {visibleTrends.map((item) => (
          <TrendRow key={item.skill_area} item={item} labelFor={labelFor} />
        ))}
      </div>
    </div>
  )
}

function TrendSummary({ trends }) {
  const counts = trends.reduce(
    (acc, item) => ({ ...acc, [item.trend_label]: (acc[item.trend_label] || 0) + 1 }),
    {}
  )

  return (
    <div className="grid grid-cols-3 gap-2">
      <TrendStat label="Improving" value={counts.improving || 0} tone="improving" />
      <TrendStat label="Stable" value={counts.stable || 0} tone="stable" />
      <TrendStat label="Declining" value={counts.declining || 0} tone="declining" />
    </div>
  )
}

function TrendStat({ label, value, tone }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color: TREND_COLORS[tone] }}>{value}</p>
    </div>
  )
}

function MultiTrendChart({ trends, labelFor }) {
  const width = 620
  const height = 240
  const padding = { top: 18, right: 20, bottom: 34, left: 34 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const maxPoints = Math.max(...trends.map((item) => item.points.length))

  const toX = (index) => padding.left + (maxPoints <= 1 ? 0 : (index / (maxPoints - 1)) * plotWidth)
  const toY = (score) => padding.top + (1 - Number(score || 0) / 100) * plotHeight

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background/40">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[240px] w-full" role="img" aria-label="Progress trend line chart">
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              y1={toY(tick)}
              x2={width - padding.right}
              y2={toY(tick)}
              stroke="currentColor"
              className="text-border"
            />
            <text x={8} y={toY(tick) + 4} className="fill-muted-foreground text-[10px]">
              {tick}
            </text>
          </g>
        ))}
        {trends.map((trend) => {
          const path = trend.points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index)} ${toY(point.score)}`)
            .join(' ')
          const color = TREND_COLORS[trend.trend_label] || TREND_COLORS.stable
          return (
            <g key={trend.skill_area}>
              <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
              {trend.points.map((point, index) => (
                <circle key={`${trend.skill_area}-${point.session_id || index}`} cx={toX(index)} cy={toY(point.score)} r="4" fill={color}>
                  <title>{`${labelFor(trend.skill_area)} ${point.session_id}: ${point.score}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
        {Array.from({ length: maxPoints }).map((_, index) => (
          <text
            key={index}
            x={toX(index)}
            y={height - 10}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            S{index + 1}
          </text>
        ))}
      </svg>
    </div>
  )
}

function TrendRow({ item, labelFor }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{labelFor(item.skill_area)}</span>
        <TrendBadge label={item.trend_label} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Latest {formatScore(item.latest_score)}</span>
        <span>Delta {formatDelta(item.delta)}</span>
      </div>
    </div>
  )
}

function SingleSessionTrendRow({ item, labelFor }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{labelFor(item.skill_area)}</span>
        <TrendBadge label="insufficient_data" />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Latest {formatScore(item.latest_score)}</span>
        <span>Sessions {item.session_count || 1}</span>
      </div>
    </div>
  )
}

function TrendBadge({ label }) {
  const Icon = label === 'improving' ? TrendingUp : label === 'declining' ? TrendingDown : Activity
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{text}</div>
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}

function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return `${Number(value) > 0 ? '+' : ''}${Math.round(Number(value))}`
}
