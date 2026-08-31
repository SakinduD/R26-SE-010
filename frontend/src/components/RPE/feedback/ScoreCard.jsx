import { useRef } from 'react'
import gsap from 'gsap'
import { useGsapScope } from './useGsapScope'

// A single outcome metric — always paired with a semantic read (`status`),
// never a bare number. `status` is computed by the caller (ResultScreen)
// since "higher is better" isn't true for every metric here (trust: higher
// is better; escalation: lower is better) — this component just renders
// whatever tone/label it's handed.
export default function ScoreCard({ label, value, unit, status }) {
  const numRef = useRef(null)
  const scopeRef = useGsapScope(({ instant }) => {
    const el = numRef.current
    if (!el || value == null) return
    if (instant) { el.textContent = String(value); return }
    const obj = { v: 0 }
    gsap.to(obj, {
      v: value,
      duration: 0.9,
      ease: 'power2.out',
      onUpdate: () => { el.textContent = String(Math.round(obj.v)) },
    })
  }, [value])

  return (
    <div className="sc-card" ref={(el) => { scopeRef.current = el }}>
      <span className="sc-label">{label}</span>
      <div className="sc-value-row">
        <span className="sc-value" ref={numRef}>{value ?? '—'}</span>
        {unit && <span className="sc-unit">{unit}</span>}
      </div>
      {status && <span className={`sc-status ${status.tone}`}>{status.label}</span>}

      <style>{`
        .sc-card{
          background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:18px;
          box-shadow:0 8px 22px rgba(17,12,34,0.05);
          display:flex; flex-direction:column; gap:8px;
          transition:transform .15s var(--ease), border-color .15s var(--ease), box-shadow .15s var(--ease);
        }
        .sc-card:hover{ transform:translateY(-2px); border-color:var(--text-low); box-shadow:0 12px 28px rgba(17,12,34,0.08); }
        .sc-label{ font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); }
        .sc-value-row{ display:flex; align-items:baseline; gap:3px; }
        .sc-value{ font-size:28px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--text-hi); line-height:1; }
        .sc-unit{ font-size:12px; font-weight:600; color:var(--text-med); }
        .sc-status{ font-size:11px; font-weight:650; }
        .sc-status.success{ color:var(--success); }
        .sc-status.accent{  color:var(--accent); }
        .sc-status.warning{ color:var(--warning); }
        .sc-status.danger{  color:var(--danger); }
        .sc-status.neutral{ color:var(--text-med); }
      `}</style>
    </div>
  )
}
