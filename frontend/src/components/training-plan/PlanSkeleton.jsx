import React from 'react'
import Card from '@/components/ui/Card'

/**
 * Skeleton loaders sized to the real cards so nothing shifts when data lands.
 * Uses the shared .skel shimmer from index.css.
 */

function Line({ w = '100%', h = 12, mt = 0 }) {
  return <div className="skel" style={{ width: w, height: h, marginTop: mt }} />
}

export function PlanCardSkeleton({ lines = 3 }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div className="skel" style={{ width: 28, height: 28, borderRadius: 8 }} />
        <Line w={180} h={16} />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Line key={i} w={i === lines - 1 ? '65%' : '100%'} mt={i === 0 ? 0 : 10} />
      ))}
    </Card>
  )
}

export function PlanListSkeleton({ rows = 3 }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div className="skel" style={{ width: 28, height: 28, borderRadius: 8 }} />
        <Line w={140} h={16} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="skel"
            style={{ height: 62, borderRadius: 'var(--radius)' }}
          />
        ))}
      </div>
    </Card>
  )
}

/** Full plan-detail placeholder — brief hero, summary, blueprint. */
export default function PlanSkeleton() {
  return (
    <div className="col" style={{ gap: 16 }} aria-busy="true" aria-label="Loading training plan">
      <PlanCardSkeleton lines={3} />
      <PlanCardSkeleton lines={4} />
      <PlanCardSkeleton lines={5} />
    </div>
  )
}
