import { useState } from 'react'
import { cn } from '@/lib/utils'

/* ── colour helpers ─────────────────────────────────────────── */
function qualityColor(v) {
  if (v < 4) return 'bg-red-400'
  if (v < 7) return 'bg-yellow-400'
  return 'bg-blue-500'
}

function trustColor(v) {
  if (v >= 70) return 'bg-green-500'
  if (v >= 40) return 'bg-yellow-400'
  return 'bg-red-500'
}

function escalationColor(v) {
  if (v <= 1) return 'bg-green-400'
  if (v <= 3) return 'bg-yellow-400'
  return 'bg-red-500'
}

/* ── tab config ─────────────────────────────────────────────── */
const TABS = [
  {
    id:        'quality',
    label:     'Response Quality',
    dataKey:   'qualityCurve',
    maxScale:  10,
    refLine:   7,
    refLabel:  'Target',
    colorFn:   qualityColor,
  },
  {
    id:        'trust',
    label:     'Trust Score',
    dataKey:   'trustCurve',
    maxScale:  100,
    refLine:   50,
    refLabel:  'Baseline',
    colorFn:   trustColor,
  },
  {
    id:        'escalation',
    label:     'Escalation',
    dataKey:   'escalationCurve',
    maxScale:  5,
    refLine:   2,
    refLabel:  'Safe zone',
    colorFn:   escalationColor,
  },
]

function calcStats(data) {
  if (!data || data.length === 0) return { min: 0, avg: 0, max: 0 }
  const vals = data.map((d) => d.value)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const avg  = vals.reduce((s, v) => s + v, 0) / vals.length
  return { min, avg: Math.round(avg * 10) / 10, max }
}

/**
 * QualityCurveChart
 * Props:
 *   qualityCurve:    [{turn, value}]  — 0-10
 *   trustCurve:      [{turn, value}]  — 0-100
 *   escalationCurve: [{turn, value}]  — 0-5
 */
export default function QualityCurveChart({ qualityCurve = [], trustCurve = [], escalationCurve = [] }) {
  const [activeTab, setActiveTab] = useState('quality')

  const sourceMap = { qualityCurve, trustCurve, escalationCurve }
  const tab = TABS.find((t) => t.id === activeTab)
  const data = sourceMap[tab.dataKey] ?? []
  const stats = calcStats(data)
  const refPct = (tab.refLine / tab.maxScale) * 100

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">

      {/* Tab bar */}
      <div className="flex gap-6 border-b border-gray-100 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'pb-2 text-sm transition-colors',
              activeTab === t.id
                ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                : 'text-gray-400 hover:text-gray-600'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="relative" style={{ height: '160px' }}>

        {/* Reference line */}
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-gray-300 pointer-events-none z-10"
          style={{ bottom: `${(refPct / 100) * 128}px` }}
        >
          <span
            className="absolute right-0 -top-4 text-[10px] text-gray-400 bg-white px-1"
          >
            {tab.refLabel}
          </span>
        </div>

        {/* Bars */}
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            No data available
          </div>
        ) : (
          <div className="flex items-end gap-1.5 h-32 overflow-x-auto pb-0">
            {data.map((point, i) => {
              const heightPct = Math.max(2, (point.value / tab.maxScale) * 100)
              return (
                <div key={i} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ minWidth: '32px' }}>
                  {/* Value label */}
                  <span className="text-xs text-gray-500 font-medium tabular-nums leading-none">
                    {point.value}
                  </span>
                  {/* Bar */}
                  <div className="w-8 flex flex-col justify-end" style={{ height: '96px' }}>
                    <div
                      className={cn('w-full rounded-t-sm transition-all duration-500', tab.colorFn(point.value))}
                      style={{ height: `${(heightPct / 100) * 96}px` }}
                    />
                  </div>
                  {/* Turn label */}
                  <span className="text-xs text-gray-400 tabular-nums leading-none">{point.turn}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex gap-6 justify-center mt-3">
        {[
          { label: 'Min', value: stats.min },
          { label: 'Avg', value: stats.avg },
          { label: 'Max', value: stats.max },
        ].map(({ label, value }) => (
          <span key={label} className="text-xs text-gray-400">
            <span className="font-medium text-gray-600">{label}:</span> {value}
          </span>
        ))}
      </div>
    </div>
  )
}
