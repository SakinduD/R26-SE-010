import gsap from 'gsap'
import { Check } from 'lucide-react'
import { useGsapScope } from './useGsapScope'

// coaching_advice.strengths / focus_areas as structured lists rather than a
// row of same-size tag chips — real LLM output either way, just given room
// to actually read instead of being truncated into a pill.
export default function StrengthsImprovements({ strengths = [], focusAreas = [] }) {
  const scopeRef = useGsapScope(({ instant }) => {
    const els = gsap.utils.toArray('.si-item')
    if (instant) { gsap.set(els, { opacity: 1, y: 0 }); return }
    gsap.fromTo(els, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', stagger: 0.06 })
  }, [strengths.length, focusAreas.length])

  if (strengths.length === 0 && focusAreas.length === 0) return null

  return (
    <div className="si-grid" ref={(el) => { scopeRef.current = el }}>
      {strengths.length > 0 && (
        <div className="si-col">
          <p className="si-heading success">Strengths</p>
          <ul className="si-list">
            {strengths.map((s, i) => (
              <li key={i} className="si-item">
                <Check size={14} strokeWidth={2.5} className="si-icon success" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {focusAreas.length > 0 && (
        <div className="si-col">
          <p className="si-heading warning">Improvement areas</p>
          <ul className="si-list numbered">
            {focusAreas.map((f, i) => (
              <li key={i} className="si-item">
                <span className="si-index">{i + 1}</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <style>{`
        .si-grid{ display:grid; grid-template-columns:1fr 1fr; gap:24px; }
        @media (max-width:520px){ .si-grid{ grid-template-columns:1fr; } }
        .si-col{ display:flex; flex-direction:column; gap:12px; }
        .si-heading{ font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; margin:0; }
        .si-heading.success{ color:var(--success); }
        .si-heading.warning{ color:var(--warning); }
        .si-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
        .si-item{ display:flex; gap:10px; align-items:flex-start; font-size:13px; line-height:1.5; color:var(--text-hi); }
        .si-icon{ flex-shrink:0; margin-top:2px; }
        .si-icon.success{ color:var(--success); }
        .si-index{
          flex-shrink:0; width:18px; height:18px; border-radius:50%; background:var(--warning-glow); color:var(--warning);
          font-size:10.5px; font-weight:700; display:flex; align-items:center; justify-content:center; margin-top:1px;
        }
      `}</style>
    </div>
  )
}
