import React, { useMemo, useState } from 'react'
import { Activity, TrendingDown, TrendingUp } from 'lucide-react'

const TREND_COLORS = {
  improving: 'rgb(5 150 105)',
  stable: 'rgb(14 116 144)',
  declining: 'rgb(157 23 77)',
  insufficient_data: 'rgb(161 161 170)',
}

const SKILL_COLORS = {
  vocal_command: '#f43f5e',      // Rose
  speech_fluency: '#f59e0b',     // Amber
  presence_engagement: '#10b981', // Teal
  emotional_intelligence: '#6366f1', // Indigo
  overall: '#8b5cf6',            // Purple
}

function getSkillColor(skill, trendLabel) {
  if (SKILL_COLORS[skill]) return SKILL_COLORS[skill]
  return TREND_COLORS[trendLabel] || TREND_COLORS.stable
}

export default function ProgressTrendVisualization({ trends, labelFor }) {
  console.log('--- TRENDS DATA DEBUG ---', trends)
  const [hoveredSkill, setHoveredSkill] = useState(null)

  const visibleTrends = useMemo(
    () => trends.filter((item) => item.points?.length > 1).slice(0, 6),
    [trends]
  )
  const singleSessionTrends = useMemo(
    () => trends.filter((item) => item.points?.length === 1).slice(0, 5),
    [trends]
  )

  if (!visibleTrends.length) {
    if (!singleSessionTrends.length) {
      return <EmptyState text="No trend history yet" />
    }

    return (
      <div className="space-y-3">
        <EmptyState text="One real session is available. Add another session to calculate progress trends." />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
      <MultiTrendChart 
        trends={visibleTrends} 
        labelFor={labelFor} 
        hoveredSkill={hoveredSkill}
        onHover={setHoveredSkill}
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTrends.map((item) => (
          <TrendRow 
            key={item.skill_area} 
            item={item} 
            labelFor={labelFor} 
            isHovered={hoveredSkill === item.skill_area}
            onHover={setHoveredSkill}
          />
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

function MultiTrendChart({ trends, labelFor, hoveredSkill, onHover }) {
  const width = 620
  const height = 240
  const padding = { top: 18, right: 20, bottom: 34, left: 34 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const maxPoints = Math.max(...trends.map((item) => item.points.length), 2)

  const toX = (index) => padding.left + (maxPoints <= 1 ? 0 : (index / (maxPoints - 1)) * plotWidth)
  const toY = (score) => padding.top + (1 - Number(score || 0) / 100) * plotHeight

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background/40 relative group">
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
              strokeDasharray="4 4"
            />
            <text x={8} y={toY(tick) + 4} className="fill-muted-foreground text-[10px] font-medium">
              {tick}
            </text>
          </g>
        ))}
        
        {trends.map((trend) => {
          const isHovered = hoveredSkill === trend.skill_area
          const isOtherHovered = hoveredSkill && hoveredSkill !== trend.skill_area
          const path = trend.points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index)} ${toY(point.score)}`)
            .join(' ')
          const color = getSkillColor(trend.skill_area, trend.trend_label)
          
          return (
            <g key={trend.skill_area} 
               onMouseEnter={() => onHover(trend.skill_area)}
               onMouseLeave={() => onHover(null)}
               className="transition-all duration-300"
               style={{ opacity: isOtherHovered ? 0.2 : 1 }}>
              
              <path d={path} fill="none" stroke="transparent" strokeWidth="20" cursor="pointer" />
              
              {isHovered && (
                <path d={path} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" opacity="0.2" className="animate-pulse" />
              )}
              
              <path d={path} fill="none" stroke={color} strokeWidth={isHovered ? "4" : "3"} strokeLinecap="round" />
              
              {trend.points.map((point, index) => (
                <circle 
                  key={`${trend.skill_area}-${point.session_id || index}`} 
                  cx={toX(index)} 
                  cy={toY(point.score)} 
                  r={isHovered ? "6" : "4"} 
                  fill={color}
                  className="transition-all duration-300"
                  stroke="white"
                  strokeWidth={isHovered ? "2" : "0"}
                >
                  <title>{`${labelFor(trend.skill_area)}\nSession ${index + 1}: ${point.score}%`}</title>
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
            className="fill-muted-foreground text-[10px] font-bold"
          >
            S{index + 1}
          </text>
        ))}
      </svg>
      
      {hoveredSkill && (
        <div className="absolute top-2 right-2 bg-background/90 border border-border px-3 py-1.5 rounded-lg backdrop-blur-sm shadow-xl animate-in fade-in zoom-in duration-200 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: getSkillColor(hoveredSkill) }} />
            <span className="text-xs font-bold text-foreground">{labelFor(hoveredSkill)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function TrendRow({ item, labelFor, isHovered, onHover }) {
  return (
    <div 
      className={`rounded-md border p-3 transition-all duration-300 cursor-pointer ${isHovered ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border bg-background/20'}`}
      onMouseEnter={() => onHover(item.skill_area)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: getSkillColor(item.skill_area, item.trend_label) }} />
          <span className="truncate text-sm font-bold">{labelFor(item.skill_area)}</span>
        </div>
        <TrendBadge label={item.trend_label} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground font-medium uppercase tracking-tight">
        <span>Latest {formatScore(item.latest_score)}</span>
        <span className={item.delta > 0 ? 'text-green-400' : item.delta < 0 ? 'text-rose-400' : ''}>Delta {formatDelta(item.delta)}</span>
      </div>
    </div>
  )
}

function SingleSessionTrendRow({ item, labelFor }) {
  return (
    <div className="rounded-md border border-border p-3 bg-background/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: getSkillColor(item.skill_area, item.trend_label) }} />
          <span className="truncate text-sm font-bold">{labelFor(item.skill_area)}</span>
        </div>
        <TrendBadge label="stable" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground font-medium uppercase tracking-tight">
        <span>Baseline {formatScore(item.latest_score)}</span>
        <span>Initial Entry</span>
      </div>
    </div>
  )
}

function TrendBadge({ label }) {
  const Icon = label === 'improving' ? TrendingUp : label === 'declining' ? TrendingDown : Activity
  const color = TREND_COLORS[label] || TREND_COLORS.stable
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground border border-border/50">
      <Icon className="h-2.5 w-2.5" style={{ color }} />
      {label}
    </span>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{text}</div>
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--'
  return Math.round(Number(value))
}

function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--'
  return `${Number(value) > 0 ? '+' : ''}${Math.round(Number(value))}`
}
