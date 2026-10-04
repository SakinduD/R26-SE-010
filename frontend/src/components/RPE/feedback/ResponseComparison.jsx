import { useState } from 'react'
import gsap from 'gsap'
import { X, ArrowRight } from 'lucide-react'
import { useGsapScope } from './useGsapScope'

const PREVIEW_LEN = 160

// Before/after using coaching_advice.improvement_original/
// improvement_suggested — real, LLM-written per session (see
// rpe_coaching_service.py), not a hardcoded example. Only renders when both
// are actually present. There's no backend field breaking down *why* the
// rewrite is better point-by-point, so this doesn't fabricate a checklist —
// it shows the real focus_areas as what the rewrite addresses instead of
// inventing per-point justifications that don't exist.
export default function ResponseComparison({ turn, original, suggested, focusAreas = [] }) {
  const [expanded, setExpanded] = useState(false)
  if (!original || !suggested) return null

  const isLong = suggested.length > PREVIEW_LEN
  const shown = expanded || !isLong ? suggested : `${suggested.slice(0, PREVIEW_LEN)}…`

  const scopeRef = useGsapScope(({ instant }) => {
    const els = gsap.utils.toArray('.rc-reveal')
    if (instant) { gsap.set(els, { opacity: 1, y: 0 }); return }
    gsap.fromTo(els, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', stagger: 0.12 })
  }, [])

  return (
    <div className="rc-wrap" ref={(el) => { scopeRef.current = el }}>
      {turn != null && <p className="rc-eyebrow">Turn {turn}</p>}

      <div className="rc-reveal rc-block original">
        <p className="rc-label">Your response</p>
        <p className="rc-text">"{original}"</p>
        <span className="rc-tag danger"><X size={11} strokeWidth={2.5} /> Didn't land</span>
      </div>

      <div className="rc-arrow"><ArrowRight size={16} strokeWidth={2} /></div>

      <div className="rc-reveal rc-block suggested">
        <p className="rc-label">A stronger response</p>
        <p className="rc-text">
          "{shown}"
          {isLong && (
            <button type="button" className="rc-expand" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </p>
      </div>

      {focusAreas.length > 0 && (
        <div className="rc-focus">
          <p className="rc-focus-label">This addresses</p>
          <div className="rc-focus-row">
            {focusAreas.map((f, i) => <span key={i} className="rc-focus-chip">{f}</span>)}
          </div>
        </div>
      )}

      <style>{`
        .rc-wrap{ display:flex; flex-direction:column; gap:2px; }
        .rc-eyebrow{ font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); margin:0 0 10px; }

        .rc-block{ border-radius:14px; padding:16px 18px; border:1px solid transparent; box-shadow:0 6px 18px rgba(17,12,34,0.05); }
        .rc-block.original{ background:var(--surface); border-color:var(--border); }
        .rc-block.suggested{ background:var(--success-glow); border-color:rgba(63,185,80,0.3); }
        .rc-label{ font-size:10px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--text-low); margin:0 0 6px; }
        .rc-block.suggested .rc-label{ color:var(--success); }
        .rc-text{ font-size:13.5px; line-height:1.6; color:var(--text-hi); margin:0; font-style:italic; }
        .rc-expand{ background:none; border:none; color:var(--accent); font-size:12px; font-weight:650; cursor:pointer; margin-left:6px; font-style:normal; padding:0; }
        .rc-tag{ display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:650; margin-top:8px; color:var(--danger); }

        .rc-arrow{ display:flex; justify-content:center; color:var(--text-low); margin:6px 0; }

        .rc-focus{ margin-top:14px; }
        .rc-focus-label{ font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-low); margin:0 0 8px; }
        .rc-focus-row{ display:flex; flex-wrap:wrap; gap:6px; }
        .rc-focus-chip{ font-size:11px; font-weight:600; padding:4px 11px; border-radius:100px; background:var(--accent-glow); color:var(--accent); }
      `}</style>
    </div>
  )
}
