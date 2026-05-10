// REDESIGN: bg-white/gray/blue/green/yellow/red → semantic tokens (dark-mode safe)
import { useState } from 'react'
import { cn } from '@/lib/utils'

function qualityColor(v) {
  if (v < 4) return 'bg-danger'
  if (v < 7) return 'bg-warning'
  return 'bg-info'
}

function trustColor(v) {
  if (v >= 70) return 'bg-success'
  if (v >= 40) return 'bg-warning'
  return 'bg-danger'
}

function escalationColor(v) {
  if (v <= 1) return 'bg-success'
  if (v <= 3) return 'bg-warning'
  return 'bg-danger'
}

const TABS = [
  { id: 'quality',    label: 'Response Quality', dataKey: 'qualityCurve',    maxScale: 10,  refLine: 7,  refLabel: 'Target',    colorFn: qualityColor   },
  { id: 'trust',      label: 'Trust Score',       dataKey: 'trustCurve',      maxScale: 100, refLine: 50, refLabel: 'Baseline',  colorFn: trustColor     },
  { id: 'escalation', label: 'Escalation',        dataKey: 'escalationCurve', maxScale: 5,   refLine: 2,  refLabel: 'Safe zone', colorFn: escalationColor },
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
    <div className="bg-card rounded-xl border border-border p-6">

      <div className="flex gap-6 border-b border-border mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'pb-2 text-sm transition-colors',
              activeTab === t.id
                ? 'border-b-2 border-primary text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative" style={{ height: '160px' }}>
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-border-strong pointer-events-none z-10"
          style={{ bottom: `${(refPct / 100) * 128}px` }}
        >
          <span className="absolute right-0 -top-4 text-[10px] text-muted-foreground bg-card px-1">
            {tab.refLabel}
          </span>
        </div>

        {data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <div className="flex items-end gap-1.5 h-32 overflow-x-auto pb-0">
            {data.map((point, i) => {
              const heightPct = Math.max(2, (point.value / tab.maxScale) * 100)
              return (
                <div key={i} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ minWidth: '32px' }}>
                  <span className="text-xs text-muted-foreground font-medium tabular-nums leading-none">
                    {point.value}
                  </span>
                  <div className="w-8 flex flex-col justify-end" style={{ height: '96px' }}>
                    <div
                      className={cn('w-full rounded-t-sm transition-all duration-500', tab.colorFn(point.value))}
                      style={{ height: `${(heightPct / 100) * 96}px` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums leading-none">{point.turn}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex gap-6 justify-center mt-3">
        {[
          { label: 'Min', value: stats.min },
          { label: 'Avg', value: stats.avg },
          { label: 'Max', value: stats.max },
        ].map(({ label, value }) => (
          <span key={label} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{label}:</span> {value}
          </span>
        ))}
      </div>
    </div>
  )
}
