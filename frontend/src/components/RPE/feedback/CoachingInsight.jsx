import { useRef } from 'react'
import gsap from 'gsap'
import { useGsapScope } from './useGsapScope'

// The dominant coaching insight for the session. `advice[0]` (the LLM's
// first, most important actionable point) is the "biggest opportunity";
// `summary` (the same one-sentence session summary shown on the outcome
// screen) doubles as the "why it mattered" context here — there's no
// separate backend field for that, and inventing a second rationale
// alongside the real summary would risk contradicting it. Remaining advice
// items become the scannable "next time" list.
export default function CoachingInsight({ summary, advice = [] }) {
  const [headline, ...rest] = advice
  const listRef = useRef(null)

  const scopeRef = useGsapScope(({ instant }) => {
    const items = gsap.utils.toArray('.ci-step')
    if (instant) { gsap.set(items, { opacity: 1, x: 0 }); return }
    gsap.fromTo(items, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.35, ease: 'power2.out', stagger: 0.1 })
  }, [advice.length])

  if (!headline) return null

  return (
    <div className="ci-wrap" ref={(el) => { scopeRef.current = el; listRef.current = el }}>
      <p className="ci-eyebrow">The biggest opportunity</p>
      <p className="ci-headline">{headline}</p>

      {summary && (
        <div className="ci-why">
          <p className="ci-why-label">Why it mattered</p>
          <p className="ci-why-text">{summary}</p>
        </div>
      )}

      {rest.length > 0 && (
        <div className="ci-next">
          <p className="ci-next-label">Next time</p>
          <ol className="ci-steps">
            {rest.map((point, i) => (
              <li key={i} className="ci-step">
                <span className="ci-num">{String(i + 1).padStart(2, '0')}</span>
                <p>{point}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <style>{`
        .ci-wrap{ display:flex; flex-direction:column; gap:4px; }
        .ci-eyebrow{ font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--accent); margin:0; }
        .ci-headline{ font-size:24px; font-weight:800; letter-spacing:-0.01em; line-height:1.3; color:var(--text-hi); margin:6px 0 0; }

        .ci-why{
          margin-top:16px; border-left:3px solid rgba(124,58,237,0.4); background:var(--accent-glow);
          border-radius:0 8px 8px 0; padding:12px 16px;
        }
        .ci-why-label{ font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); margin:0 0 4px; }
        .ci-why-text{ font-size:13.5px; line-height:1.6; color:var(--quote-text); margin:0; }

        .ci-next{ margin-top:20px; }
        .ci-next-label{ font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); margin:0 0 12px; }
        .ci-steps{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
        .ci-step{ display:flex; gap:12px; align-items:flex-start; }
        .ci-step p{ margin:0; font-size:13.5px; line-height:1.55; color:var(--text-hi); padding-top:1px; }
        .ci-num{
          font-size:11px; font-weight:800; color:var(--accent); flex-shrink:0;
          font-variant-numeric:tabular-nums; padding-top:1px;
        }
      `}</style>
    </div>
  )
}
