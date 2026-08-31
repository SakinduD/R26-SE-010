import { useMemo, useRef } from 'react'
import gsap from 'gsap'
import { cn } from '@/lib/utils'
import { useGsapScope } from './useGsapScope'

/*
 * TrustJourney.jsx
 * Replaces the old SessionRoadmap's decorative sine-wave path with a real
 * trust trajectory — vertical position is the actual trust value (0-100),
 * not a winding illusion, so "trust rose then fell" is something you can
 * actually read off the shape instead of just the node colors.
 *
 * Data in: viz_payload.trust_curve / trust_deltas (both real, per session —
 * see FeedbackDashboard). Nothing here invents a value; a turn with no
 * curve point simply doesn't get a node.
 */
const TONE_COLOR = {
  success: 'var(--success)',
  danger:  'var(--danger)',
  warning: 'var(--warning)',
  accent:  'var(--accent)',
  neutral: 'var(--text-low)',
}

// Direction -> node state tone. 'down' reads as a concern regardless of
// magnitude — the point of this view is "where did it change," the exact
// size is already in the tooltip/detail panel.
const DIRECTION_TONE = { up: 'success', down: 'danger', flat: 'neutral' }

// Quadratic-through-midpoints smoothing: for each segment, curve through a
// control point at the midpoint's x but each end's own y, which produces a
// gently flowing line without pulling in a spline library for four to
// fifteen points.
function buildSmoothPath(points) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const midX = (prev.x + curr.x) / 2
    d += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`
  }
  return d
}

export default function TrustJourney({
  trustCurve = [],
  trustDeltas = [],
  outcomeTone = 'neutral',
  selectedIndex,
  onSelect,
}) {
  const trackRef = useRef(null)

  const { points, width, height, padX, padY, plotH, gridLines } = useMemo(() => {
    const gap    = 96
    const padX   = 50
    const padY   = 28
    const plotH  = 130
    const height = plotH + padY * 2
    const width  = padX * 2 + gap * Math.max(0, trustCurve.length - 1)
    const valueToY = (v) => padY + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH

    const points = trustCurve.map((pt, i) => ({
      ...pt,
      x: padX + i * gap,
      y: valueToY(pt.value),
    }))

    const gridLines = [0, 25, 50, 75, 100].map((v) => ({ value: v, y: valueToY(v) }))

    return { points, width, height, padX, padY, plotH, gridLines }
  }, [trustCurve])

  const pathD = useMemo(() => buildSmoothPath(points), [points])

  // IMPORTANT: only ever scale the circle itself, never the whole <g> node
  // (circle + value label + turn label together) — a circle's bounding box
  // is naturally centered on its own cx/cy, so a default-origin CSS `scale`
  // stays put. The group's is NOT centered (the value label sits well above
  // the circle, the turn label well below it), so scaling the group made
  // both text labels fly away from their real positions whenever a node was
  // selected — that was the actual bug, not a scroll/overflow issue.
  const scopeRef = useGsapScope(({ instant }) => {
    const container = scopeRef.current
    const path = container?.querySelector('.tj-line')
    if (path) {
      const length = path.getTotalLength()
      if (instant) {
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: 0 })
      } else {
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length })
        gsap.to(path, { strokeDashoffset: 0, duration: 1.1, ease: 'power3.out' })
      }
    }

    const circles = gsap.utils.toArray('.tj-node-circle', container)
    const labels  = gsap.utils.toArray('.tj-node-label', container)
    if (instant) {
      gsap.set(circles, { opacity: 1, scale: 1 })
      gsap.set(labels, { opacity: 1 })
    } else {
      gsap.fromTo(circles, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.8)', stagger: 0.09, delay: 0.5 })
      gsap.fromTo(labels, { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.09, delay: 0.65 })
    }
  }, [trustCurve])

  if (points.length === 0) {
    return <p className="tj-empty">Not enough conversation data to visualize this session.</p>
  }

  const handleKeyDown = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect?.(i)
    } else if (e.key === 'ArrowRight' && i < points.length - 1) {
      e.preventDefault()
      trackRef.current?.querySelectorAll('.tj-node')[i + 1]?.focus()
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      trackRef.current?.querySelectorAll('.tj-node')[i - 1]?.focus()
    }
  }

  return (
    <div className="tj-wrap" ref={(el) => { scopeRef.current = el }}>
      <div className="tj-scroll" ref={trackRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="tj-svg"
          role="img"
          aria-label={`Trust across the session: started at ${points[0].value}, ended at ${points[points.length - 1].value}`}
        >
          {gridLines.map((g) => (
            <g key={g.value}>
              <line x1={padX - 14} x2={width - padX + 14} y1={g.y} y2={g.y} className="tj-grid" />
              <text x={4} y={g.y + 3} className="tj-grid-label">{g.value}</text>
            </g>
          ))}

          <path d={pathD} className="tj-line" fill="none" strokeWidth={3} strokeLinecap="round" />

          {points.map((p, i) => {
            const isLast  = i === points.length - 1
            const isFirst = i === 0
            const tone = isLast ? outcomeTone : (isFirst ? 'neutral' : (DIRECTION_TONE[trustDeltas[i - 1]?.direction] ?? 'neutral'))
            const radius = isLast ? 9 : 7

            return (
              <g
                key={i}
                className="tj-node"
                data-index={i}
                tabIndex={0}
                role="button"
                aria-label={`Turn ${p.turn === 'Start' ? 'start' : p.turn}, trust ${p.value}${isLast ? ', final' : ''}`}
                aria-pressed={selectedIndex === i}
                onClick={() => onSelect?.(i)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                onFocus={() => onSelect?.(i)}
              >
                <circle cx={p.x} cy={p.y} r={radius + 10} fill="transparent" />
                <circle
                  cx={p.x} cy={p.y} r={radius}
                  fill={TONE_COLOR[tone]}
                  stroke="var(--surface)"
                  strokeWidth={3}
                  className={cn('tj-node-circle', selectedIndex === i && 'tj-node-selected')}
                  style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                />
                <text x={p.x} y={p.y - radius - 8} textAnchor="middle" className="tj-value tj-node-label">{p.value}</text>
                <text x={p.x} y={height - 6} textAnchor="middle" className="tj-turn-label tj-node-label">
                  {p.turn === 'Start' ? 'Start' : p.turn}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Textual summary for anyone not interacting with the SVG directly —
          screen readers, or just a quick scan without hovering/tapping. */}
      <table className="sr-only-table">
        <caption>Trust by turn</caption>
        <thead><tr><th>Turn</th><th>Trust</th><th>Change</th></tr></thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{p.turn}</td>
              <td>{p.value}</td>
              <td>{i === 0 ? '—' : (trustDeltas[i - 1]?.direction ?? '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <style>{`
        .tj-wrap{ display:flex; flex-direction:column; gap:4px; }
        .tj-scroll{ width:100%; overflow-x:auto; padding:6px 2px 4px; }
        .tj-svg{ display:block; min-width:100%; overflow:visible; }
        .tj-grid{ stroke:var(--border); stroke-width:1; stroke-dasharray:3 4; opacity:.6; }
        .tj-grid-label{ font-size:8.5px; fill:var(--text-low); }
        .tj-line{ stroke:var(--accent); }
        .tj-node{ cursor:pointer; outline:none; }
        .tj-node:focus-visible circle:nth-child(2){ stroke:var(--accent); stroke-width:3; filter:drop-shadow(0 0 0 3px var(--accent-glow)); }
        .tj-node-circle{ transition:stroke .2s var(--ease), stroke-width .2s var(--ease), filter .2s var(--ease); }
        .tj-node-selected{ stroke:var(--accent) !important; stroke-width:4.5 !important; filter:drop-shadow(0 0 5px var(--accent-glow)); }
        .tj-value{ font-size:10.5px; font-weight:700; fill:var(--text-hi); font-variant-numeric:tabular-nums; }
        .tj-turn-label{ font-size:9px; fill:var(--text-low); text-transform:uppercase; letter-spacing:.04em; }
        .tj-empty{ font-size:13px; color:var(--text-med); padding:24px; text-align:center; }

        .sr-only-table{
          position:absolute; width:1px; height:1px; padding:0; margin:-1px;
          overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;
        }
      `}</style>
    </div>
  )
}
