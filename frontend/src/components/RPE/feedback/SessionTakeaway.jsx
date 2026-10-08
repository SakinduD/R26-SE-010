import gsap from 'gsap'
import { useGsapScope } from './useGsapScope'

// Completion-screen recap — advice[0] as the key takeaway, the session
// summary as "what to remember," and a compact real stat row. All from the
// same coaching_advice the rest of the feedback flow already uses.
export default function SessionTakeaway({ takeaway, summary, finalTrust, totalTurns, strengthCount, focusCount }) {
  const scopeRef = useGsapScope(({ instant }) => {
    const els = gsap.utils.toArray('.st-reveal')
    if (instant) { gsap.set(els, { opacity: 1, y: 0 }); return }
    gsap.fromTo(els, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', stagger: 0.1 })
  }, [])

  if (!takeaway && !summary) return null

  const stats = [
    { value: finalTrust, label: 'Final Trust' },
    { value: totalTurns, label: 'Turns' },
    { value: focusCount, label: focusCount === 1 ? 'Key improvement' : 'Key improvements' },
    { value: strengthCount, label: strengthCount === 1 ? 'Strength' : 'Strengths' },
  ].filter((s) => s.value != null)

  return (
    <div className="stk-wrap" ref={(el) => { scopeRef.current = el }}>
      {takeaway && (
        <div className="st-reveal">
          <p className="stk-label">Your key takeaway</p>
          <p className="stk-takeaway">{takeaway}</p>
        </div>
      )}
      {summary && (
        <div className="st-reveal">
          <p className="stk-label">What to remember</p>
          <p className="stk-remember">{summary}</p>
        </div>
      )}
      {stats.length > 0 && (
        <div className="st-reveal stk-stats">
          {stats.map((s, i) => (
            <div key={i} className="stk-stat">
              <span className="stk-stat-val">{s.value}</span>
              <span className="stk-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .stk-wrap{ display:flex; flex-direction:column; gap:20px; }
        .stk-label{ font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); margin:0 0 6px; }
        .stk-takeaway{ font-size:19px; font-weight:700; line-height:1.4; color:var(--text-hi); margin:0; }
        .stk-remember{ font-size:13.5px; line-height:1.6; color:var(--text-med); margin:0; }

        .stk-stats{ display:flex; gap:24px; flex-wrap:wrap; padding-top:6px; border-top:1px solid var(--border); }
        .stk-stat{ display:flex; flex-direction:column; gap:2px; }
        .stk-stat-val{ font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--text-hi); line-height:1; }
        .stk-stat-label{ font-size:10.5px; font-weight:650; color:var(--text-low); margin-top:4px; }
      `}</style>
    </div>
  )
}
