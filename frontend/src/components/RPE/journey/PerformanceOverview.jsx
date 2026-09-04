import { useRef } from 'react'
import gsap from 'gsap'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'

// Typography-led metric strip, not another card grid — the numbers are the
// point. `metrics` is pre-computed by the caller (MySessions.jsx) from real
// session data only; a metric that can't be legitimately calculated (e.g.
// trust growth with fewer than 2 completed sessions) is simply omitted from
// the array rather than shown as a fabricated 0.
function Metric({ value, prefix, suffix, label, tone }) {
  const ref = useRef(null)
  const scopeRef = useGsapScope(({ instant }) => {
    const el = ref.current
    if (!el) return
    if (instant || typeof value !== 'number') { el.textContent = String(value); return }
    const obj = { v: 0 }
    gsap.to(obj, {
      v: value, duration: 0.9, ease: 'power2.out',
      onUpdate: () => { el.textContent = String(Math.round(obj.v)) },
    })
  }, [value])

  return (
    <div className="po-metric">
      <div className="po-value-row">
        {prefix && <span className={`po-affix ${tone || ''}`}>{prefix}</span>}
        <span className={`po-value ${tone || ''}`} ref={(el) => { scopeRef.current = el; ref.current = el }}>
          {typeof value === 'number' ? 0 : value}
        </span>
        {suffix && <span className="po-affix">{suffix}</span>}
      </div>
      <span className="po-label">{label}</span>
    </div>
  )
}

export default function PerformanceOverview({ metrics }) {
  if (!metrics || metrics.length === 0) return null

  return (
    <div className="po-wrap">
      {metrics.map((m, i) => <Metric key={i} {...m} />)}

      <style>{`
        .po-wrap{ display:flex; flex-wrap:wrap; gap:32px 44px; padding:22px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
        .po-metric{ display:flex; flex-direction:column; gap:3px; }
        .po-value-row{ display:flex; align-items:baseline; gap:2px; }
        .po-value{ font-size:32px; font-weight:800; letter-spacing:-0.02em; color:var(--text-hi); font-variant-numeric:tabular-nums; line-height:1; }
        .po-affix{ font-size:18px; font-weight:700; color:var(--text-hi); font-variant-numeric:tabular-nums; }
        .po-value.success, .po-affix.success{ color:var(--success); }
        .po-value.warning, .po-affix.warning{ color:var(--warning); }
        .po-value.danger,  .po-affix.danger { color:var(--danger); }
        .po-label{ font-size:11px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; color:var(--text-low); }

        @media (max-width:560px){
          .po-wrap{ gap:20px 28px; }
          .po-value{ font-size:26px; }
        }
      `}</style>
    </div>
  )
}
