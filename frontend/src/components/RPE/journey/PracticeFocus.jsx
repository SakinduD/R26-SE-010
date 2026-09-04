import gsap from 'gsap'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'

// "What you've been practicing" — real target_skills pulled from the
// scenarios behind the learner's own sessions (getScenarios() already
// carries apa_metadata.target_skills), counted by how often each one
// appears across sessions actually played. Nothing here is invented — a
// learner whose scenarios carry no skill metadata simply doesn't see this
// section (MySessions.jsx omits it entirely when the list is empty).
export default function PracticeFocus({ skills }) {
  const scopeRef = useGsapScope(({ instant }) => {
    const bars = gsap.utils.toArray('.pf-bar-fill')
    if (instant) { gsap.set(bars, { scaleX: 1 }); return }
    gsap.fromTo(bars, { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power3.out', stagger: 0.08, delay: 0.1 })
  }, [skills])

  if (!skills || skills.length === 0) return null
  const max = Math.max(...skills.map((s) => s.count), 1)

  return (
    <div className="pf-wrap" ref={(el) => { scopeRef.current = el }}>
      <p className="pf-caption">How many of your sessions practiced each skill</p>
      {skills.map((s) => (
        <div key={s.name} className="pf-row">
          <span className="pf-name">{s.name}</span>
          <div className="pf-bar-track">
            <div className="pf-bar-fill" style={{ width: `${Math.max(8, (s.count / max) * 100)}%`, transformOrigin: 'left' }} />
          </div>
          <span className="pf-count">{s.count} session{s.count === 1 ? '' : 's'}</span>
        </div>
      ))}

      <style>{`
        .pf-wrap{ display:flex; flex-direction:column; gap:11px; }
        .pf-caption{ font-size:11.5px; color:var(--text-low); margin:0 0 2px; }
        .pf-row{ display:grid; grid-template-columns:150px 1fr auto; align-items:center; gap:12px; }
        .pf-name{ font-size:12.5px; font-weight:650; color:var(--text-hi); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .pf-bar-track{ height:8px; border-radius:100px; background:var(--surface-hi); overflow:hidden; }
        .pf-bar-fill{ height:100%; border-radius:100px; background:linear-gradient(90deg, var(--accent), #9B6BFF); }
        .pf-count{ font-size:11.5px; font-weight:650; color:var(--text-low); text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }

        @media (max-width:520px){
          .pf-row{ grid-template-columns:96px 1fr auto; gap:8px; }
          .pf-name{ font-size:11.5px; }
          .pf-count{ font-size:10.5px; }
        }
      `}</style>
    </div>
  )
}
