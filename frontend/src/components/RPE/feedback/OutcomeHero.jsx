import { useRef } from 'react'
import gsap from 'gsap'
import { useGsapScope } from './useGsapScope'
import { scoreStatus } from './feedbackTheme'

// The hero number for the outcome screen, plus an honest one-line
// interpretation. The interpretation is not a client-side generator —
// it's coaching_advice.summary, the same one-sentence session summary the
// backend's coaching LLM already writes per session (see
// rpe_coaching_service.py). Reusing it here avoids building a second,
// possibly-contradictory "insight" sentence from the raw numbers.
export default function OutcomeHero({ finalTrust, interpretation, icon }) {
  const numRef = useRef(null)
  const status = scoreStatus(finalTrust)

  const scopeRef = useGsapScope(({ instant }) => {
    const el = numRef.current
    if (!el || finalTrust == null) return
    if (instant) { el.textContent = String(finalTrust); return }
    const obj = { v: 0 }
    gsap.to(obj, {
      v: finalTrust,
      duration: 1,
      ease: 'power2.out',
      onUpdate: () => { el.textContent = String(Math.round(obj.v)) },
    })
  }, [finalTrust])

  return (
    <div className="oh-wrap" ref={(el) => { scopeRef.current = el }}>
      {icon && <p className="oh-icon">{icon}</p>}
      <div className="oh-hero">
        <span className="oh-num" ref={numRef}>{finalTrust ?? '—'}</span>
        <span className="oh-unit">/ 100</span>
      </div>
      <div className="oh-row">
        <span className="oh-label">Final Trust</span>
        <span className={`oh-status ${status.tone}`}>{status.label}</span>
      </div>
      {interpretation && <p className="oh-interp">{interpretation}</p>}

      <style>{`
        .oh-wrap{ display:flex; flex-direction:column; align-items:flex-start; gap:6px; }
        .oh-icon{ font-size:32px; margin:0 0 2px; }
        .oh-hero{ display:flex; align-items:baseline; gap:6px; }
        .oh-num{ font-size:56px; font-weight:800; letter-spacing:-0.02em; color:var(--text-hi); font-variant-numeric:tabular-nums; line-height:1; }
        .oh-unit{ font-size:18px; font-weight:650; color:var(--text-med); }
        .oh-row{ display:flex; align-items:center; gap:10px; }
        .oh-label{ font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-low); }
        .oh-status{ font-size:12.5px; font-weight:650; }
        .oh-status.success{ color:var(--success); }
        .oh-status.accent{  color:var(--accent); }
        .oh-status.warning{ color:var(--warning); }
        .oh-status.danger{  color:var(--danger); }
        .oh-status.neutral{ color:var(--text-med); }
        .oh-interp{
          font-size:14px; line-height:1.6; color:var(--quote-text); margin:10px 0 0; max-width:520px;
          border-left:3px solid rgba(124,58,237,0.4); background:var(--accent-glow);
          border-radius:0 8px 8px 0; padding:10px 14px;
        }
      `}</style>
    </div>
  )
}
