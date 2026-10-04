import { useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'

// The signature visualization — trust ACROSS completed sessions (one point
// per session's final_trust), not a per-turn curve within a single session
// (that data doesn't exist without an extra fetch per session, which this
// deliberately avoids — see MySessions.jsx). Shape, not just color, carries
// outcome: filled circle = strong result, diamond = needs work, hollow
// circle = ended without a decisive outcome — so the read doesn't depend on
// color perception alone.
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

export default function TrustJourneyChart({ sessions, selectedIndex, onSelect }) {
  const trackRef = useRef(null)
  const [hoverIndex, setHoverIndex] = useState(null)

  const { points, width, height, padX, padY, plotH, gridLines } = useMemo(() => {
    const gap = 92
    const padX = 44
    const padY = 26
    const plotH = 150
    const height = plotH + padY * 2
    const width = padX * 2 + gap * Math.max(0, sessions.length - 1)
    const valueToY = (v) => padY + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH

    const points = sessions.map((s, i) => ({
      ...s,
      x: padX + i * gap,
      y: valueToY(s.trust),
    }))
    const gridLines = [0, 25, 50, 75, 100].map((v) => ({ value: v, y: valueToY(v) }))
    return { points, width, height, padX, padY, plotH, gridLines }
  }, [sessions])

  const pathD = useMemo(() => buildSmoothPath(points), [points])
  const areaD = useMemo(() => {
    if (points.length === 0) return ''
    const baseline = padY + plotH
    return `${pathD} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`
  }, [pathD, points, padY, plotH])

  const scopeRef = useGsapScope(({ instant }) => {
    const container = scopeRef.current
    const path = container?.querySelector('.tjc-line')
    const area = container?.querySelector('.tjc-area')
    if (path) {
      const length = path.getTotalLength()
      if (instant) {
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: 0 })
        if (area) gsap.set(area, { opacity: 1 })
      } else {
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length })
        gsap.to(path, { strokeDashoffset: 0, duration: 1.1, ease: 'power3.out' })
        if (area) gsap.fromTo(area, { opacity: 0 }, { opacity: 1, duration: 0.9, delay: 0.3, ease: 'power2.out' })
      }
    }
    const nodes = gsap.utils.toArray('.tjc-node-mark', container)
    if (instant) {
      gsap.set(nodes, { opacity: 1, scale: 1 })
    } else {
      gsap.fromTo(nodes, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.8)', stagger: 0.07, delay: 0.5 })
    }
  }, [sessions.length])

  if (points.length === 0) return null

  const handleKeyDown = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(i === selectedIndex ? null : i)
    } else if (e.key === 'ArrowRight' && i < points.length - 1) {
      e.preventDefault()
      trackRef.current?.querySelectorAll('.tjc-node')[i + 1]?.focus()
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      trackRef.current?.querySelectorAll('.tjc-node')[i - 1]?.focus()
    }
  }

  const activeIndex = hoverIndex ?? selectedIndex

  return (
    <div className="tjc-wrap" ref={(el) => { scopeRef.current = el }}>
      <div className="tjc-scroll" ref={trackRef}>
        <div className="tjc-inner" style={{ width: `max(100%, ${width}px)` }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="tjc-svg"
            role="img"
            aria-label={`Trust across ${points.length} sessions: started at ${points[0].trust}, most recently ${points[points.length - 1].trust}`}
          >
            <defs>
              <linearGradient id="tjc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {gridLines.map((g) => (
              <g key={g.value}>
                <line x1={padX - 10} x2={width - padX + 10} y1={g.y} y2={g.y} className="tjc-grid" />
                <text x={2} y={g.y + 3} className="tjc-grid-label">{g.value}</text>
              </g>
            ))}

            <path d={areaD} className="tjc-area" fill="url(#tjc-fill)" stroke="none" />
            <path d={pathD} className="tjc-line" fill="none" strokeWidth={2.5} strokeLinecap="round" />

            {points.map((p, i) => {
              const isLast = i === points.length - 1
              const isActive = activeIndex === i
              const r = isLast ? 8 : 6

              return (
                <g
                  key={p.sessionId}
                  className="tjc-node"
                  tabIndex={0}
                  role="button"
                  aria-pressed={selectedIndex === i}
                  aria-label={`${p.title}, trust ${p.trust}, ${p.statusLabel}`}
                  onClick={() => onSelect(i === selectedIndex ? null : i)}
                  onKeyDown={(e) => handleKeyDown(e, i)}
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onFocus={() => setHoverIndex(i)}
                  onBlur={() => setHoverIndex(null)}
                >
                  <title>{`${p.title} — ${p.difficulty} — Trust ${p.trust} — ${p.statusLabel}`}</title>
                  <circle cx={p.x} cy={p.y} r={r + 10} fill="transparent" />

                  {p.shape === 'diamond' && (
                    <rect
                      x={p.x - r * 0.78} y={p.y - r * 0.78} width={r * 1.56} height={r * 1.56}
                      transform={`rotate(45 ${p.x} ${p.y})`}
                      className={`tjc-node-mark ${p.tone}`}
                      style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                    />
                  )}
                  {p.shape === 'hollow' && (
                    <circle
                      cx={p.x} cy={p.y} r={r}
                      className={`tjc-node-mark hollow ${p.tone}`}
                      style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                    />
                  )}
                  {p.shape === 'circle' && (
                    <circle
                      cx={p.x} cy={p.y} r={r}
                      className={`tjc-node-mark ${p.tone}`}
                      style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                    />
                  )}
                  {isActive && (
                    <circle cx={p.x} cy={p.y} r={r + 5} className={`tjc-node-ring ${p.tone}`} />
                  )}

                  {isLast && (
                    <text x={p.x} y={p.y - r - 10} textAnchor="middle" className="tjc-value">{p.trust}</text>
                  )}
                </g>
              )
            })}
          </svg>

          {hoverIndex != null && (
            <div
              className="tjc-tooltip"
              style={{
                left: `${(points[hoverIndex].x / width) * 100}%`,
                top: `${(points[hoverIndex].y / height) * 100}%`,
              }}
            >
              <p className="tjc-tt-title">{points[hoverIndex].title}</p>
              <p className="tjc-tt-meta">{points[hoverIndex].difficulty} · {points[hoverIndex].dateLabel}</p>
              <div className="tjc-tt-trust">
                <span className="tjc-tt-num">{points[hoverIndex].trust}</span>
                <span className="tjc-tt-label">Trust</span>
              </div>
              <p className={`tjc-tt-status ${points[hoverIndex].tone}`}>{points[hoverIndex].statusLabel}</p>
            </div>
          )}
        </div>
      </div>

      <table className="sr-only-table">
        <caption>Trust by session</caption>
        <thead><tr><th>Session</th><th>Trust</th><th>Outcome</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.sessionId}><td>{p.title}</td><td>{p.trust}</td><td>{p.statusLabel}</td></tr>
          ))}
        </tbody>
      </table>

      <style>{`
        .tjc-wrap{ position:relative; }
        .tjc-scroll{ width:100%; overflow-x:auto; padding:4px 2px 6px; }
        .tjc-inner{ position:relative; }
        .tjc-svg{ display:block; width:100%; height:auto; overflow:visible; }
        .tjc-grid{ stroke:var(--border); stroke-width:1; stroke-dasharray:3 4; opacity:.6; }
        .tjc-grid-label{ font-size:9px; fill:var(--text-low); }
        .tjc-line{ stroke:var(--accent); }
        .tjc-value{ font-size:12px; font-weight:800; fill:var(--text-hi); font-variant-numeric:tabular-nums; }

        .tjc-node{ cursor:pointer; outline:none; }
        .tjc-node:focus-visible .tjc-node-mark{ filter:drop-shadow(0 0 0 3px var(--accent-glow)); }

        .tjc-node-mark{ stroke:var(--surface); stroke-width:2.5; transition:filter .15s ease; }
        .tjc-node-mark.success{ fill:var(--success); }
        .tjc-node-mark.danger{  fill:var(--danger); }
        .tjc-node-mark.neutral{ fill:var(--text-low); }
        .tjc-node-mark.hollow{ fill:var(--surface); stroke-width:2.5; }
        .tjc-node-mark.hollow.success{ stroke:var(--success); }
        .tjc-node-mark.hollow.danger{  stroke:var(--danger); }
        .tjc-node-mark.hollow.neutral{ stroke:var(--text-low); }

        .tjc-node-ring{ fill:none; stroke-width:2; opacity:.55; }
        .tjc-node-ring.success{ stroke:var(--success); }
        .tjc-node-ring.danger{  stroke:var(--danger); }
        .tjc-node-ring.neutral{ stroke:var(--text-low); }

        .tjc-tooltip{
          position:absolute; transform:translate(-50%, -100%) translateY(-14px);
          background:var(--surface); border:1px solid var(--border); border-radius:12px;
          padding:10px 13px; min-width:150px; box-shadow:0 12px 28px rgba(17,12,34,0.14);
          pointer-events:none; z-index:5; animation:tjcTooltipIn .15s ease;
        }
        @keyframes tjcTooltipIn{ from{ opacity:0; transform:translate(-50%, -100%) translateY(-8px); } to{ opacity:1; transform:translate(-50%, -100%) translateY(-14px); } }
        .tjc-tt-title{ font-size:12px; font-weight:700; color:var(--text-hi); margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
        .tjc-tt-meta{ font-size:10.5px; color:var(--text-low); margin:2px 0 0; text-transform:capitalize; }
        .tjc-tt-trust{ display:flex; align-items:baseline; gap:4px; margin-top:6px; }
        .tjc-tt-num{ font-size:16px; font-weight:800; color:var(--text-hi); font-variant-numeric:tabular-nums; }
        .tjc-tt-label{ font-size:9.5px; font-weight:650; text-transform:uppercase; letter-spacing:.05em; color:var(--text-low); }
        .tjc-tt-status{ font-size:10.5px; font-weight:650; margin:2px 0 0; }
        .tjc-tt-status.success{ color:var(--success); }
        .tjc-tt-status.danger{  color:var(--danger); }
        .tjc-tt-status.neutral{ color:var(--text-med); }

        .sr-only-table{
          position:absolute; width:1px; height:1px; padding:0; margin:-1px;
          overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;
        }
      `}</style>
    </div>
  )
}
