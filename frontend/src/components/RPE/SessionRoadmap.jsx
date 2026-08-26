import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/*
 * SessionRoadmap.jsx
 * A Duolingo-style winding path, one node per turn, built from the
 * session's trust curve. The connecting line draws itself in on mount and
 * nodes pop in one after another — the point is to make "how far you came"
 * something you can see at a glance, not read off a table. Node color
 * follows that turn's trust delta (up/down/flat), and the final node
 * carries the session's own outcome icon as the finish marker.
 *
 * Built on framer-motion rather than hand-rolled CSS: animating `pathLength`
 * on the path lets it measure and draw the real path length itself (a fixed
 * stroke-dasharray guess made the line "snap" in almost instantly instead of
 * drawing smoothly), and animating the circles' own `r`/`opacity` attributes
 * avoids mixing an SVG `transform` attribute with a CSS transform animation
 * on the same node, which was overriding the nodes' positions entirely.
 */
const DIRECTION_TONE = { up: 'success', down: 'danger', flat: 'neutral' }
const TONE_COLOR = {
  success: '#3FB950',
  danger:  '#F85149',
  warning: '#D29922',
  neutral: '#484F58',
}

export default function SessionRoadmap({ trustCurve = [], trustDeltas = [], outcomeIcon = '🏁', outcomeTone = 'neutral' }) {
  const [activeIndex, setActiveIndex] = useState(null)
  const prefersReduced = useReducedMotion()

  if (trustCurve.length === 0) return null

  const nodeGap   = 86
  const padX      = 50
  const width     = padX * 2 + nodeGap * Math.max(0, trustCurve.length - 1)
  const height    = 180
  const centerY   = height / 2
  const amplitude = 46

  const points = trustCurve.map((pt, i) => ({
    ...pt,
    x: padX + i * nodeGap,
    y: centerY + Math.sin(i * 1.05) * amplitude,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const active = activeIndex != null ? points[activeIndex] : null

  return (
    <div className="roadmap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="roadmap-svg"
        role="img"
        aria-label="Trust across the session, turn by turn"
      >
        <motion.path
          d={pathD}
          fill="none"
          stroke="var(--border, #30363D)"
          strokeWidth={3}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: prefersReduced ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
        {points.map((p, i) => {
          const isLast  = i === points.length - 1
          const isStart = i === 0
          const tone = isLast ? outcomeTone : (isStart ? 'neutral' : (DIRECTION_TONE[trustDeltas[i - 1]?.direction] ?? 'neutral'))
          const radius = isLast ? 15 : 11
          const delay  = prefersReduced ? 0 : i * 0.11

          return (
            <g key={i}>
              <motion.circle
                cx={p.x}
                cy={p.y}
                fill={TONE_COLOR[tone]}
                stroke="var(--bg, #0D1117)"
                strokeWidth={3}
                initial={{ r: 0, opacity: 0 }}
                animate={{ r: radius, opacity: 1 }}
                transition={{ delay, type: 'spring', stiffness: 380, damping: 18 }}
                style={{ cursor: 'pointer' }}
                onClick={() => setActiveIndex((prev) => (prev === i ? null : i))}
              />
              {isLast && (
                <motion.text
                  x={p.x} y={p.y + 5}
                  textAnchor="middle"
                  fontSize="14"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: delay + 0.15, duration: 0.25 }}
                  style={{ pointerEvents: 'none' }}
                >
                  {outcomeIcon}
                </motion.text>
              )}
            </g>
          )
        })}
      </svg>

      {active && (
        <div className="roadmap-tip" style={{ left: `${(active.x / width) * 100}%`, top: `${(active.y / height) * 100}%` }}>
          <span className="roadmap-tip-turn">{active.turn}</span>
          <span className="roadmap-tip-val">Trust {active.value}</span>
        </div>
      )}

      <style>{`
        .roadmap{ position:relative; width:100%; overflow-x:auto; padding:26px 4px 10px; }
        .roadmap-svg{ display:block; min-width:100%; height:180px; overflow:visible; }

        .roadmap-tip{
          position:absolute; transform:translate(-50%, -140%);
          background:var(--surface-hi, #21262D); border:1px solid var(--border, #30363D); border-radius:8px;
          padding:6px 10px; display:flex; flex-direction:column; gap:1px; pointer-events:none;
          box-shadow:0 8px 20px rgba(0,0,0,0.4); white-space:nowrap; z-index:2;
        }
        .roadmap-tip-turn{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--text-low, #484F58); }
        .roadmap-tip-val{ font-size:12px; font-weight:700; color:var(--text-hi, #F0F6FC); }
      `}</style>
    </div>
  )
}
