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
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px; padding: 20px 22px;
          backdrop-filter: blur(14px);
          box-shadow: var(--card-shadow, 0 12px 30px -10px rgba(0, 0, 0, 0.5));
          display: flex; flex-direction: column; gap: 10px;
          transition: transform .2s var(--ease), border-color .2s var(--ease), box-shadow .2s var(--ease);
        }
        .sc-card:hover{
          transform: translateY(-2px);
          border-color: rgba(168, 85, 247, 0.4);
          box-shadow: 0 16px 36px -10px var(--accent-glow);
        }
        .sc-label{ font-size: 10.5px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--text-med); }
        .sc-value-row{ display: flex; align-items: baseline; gap: 4px; }
        .sc-value{ font-size: 32px; font-weight: 850; font-variant-numeric: tabular-nums; color: var(--text-hi); line-height: 1; }
        .sc-unit{ font-size: 12.5px; font-weight: 600; color: var(--text-low); }
        .sc-status{
          align-self: flex-start;
          font-size: 11px; font-weight: 700;
          padding: 2px 9px; border-radius: 100px;
        }
        .sc-status.success{ color: var(--success); background: var(--success-glow); border: 1px solid rgba(16, 185, 129, 0.25); }
        .sc-status.accent{  color: var(--accent); background: var(--accent-glow); border: 1px solid rgba(168, 85, 247, 0.25); }
        .sc-status.warning{ color: var(--warning); background: var(--warning-glow); border: 1px solid rgba(245, 158, 11, 0.25); }
        .sc-status.danger{  color: var(--danger); background: var(--danger-glow); border: 1px solid rgba(239, 68, 68, 0.25); }
        .sc-status.neutral{ color: var(--text-med); background: var(--surface-hi); border: 1px solid var(--border); }
      `}</style>
    </div>
  )
}
