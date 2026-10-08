import gsap from 'gsap'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'

// The page's new identity — "how am I developing as a communicator?"
// instead of "what sessions have I done?". sessionCount is the only number
// shown here (real, from the actual list length) — everything heavier
// (trust, growth, skills) lives in PerformanceOverview right below.
export default function PracticeJourneyHero({ sessionCount, isTrashView }) {
  const scopeRef = useGsapScope(({ instant }) => {
    if (instant) { gsap.set('.pjh-anim', { opacity: 1, y: 0 }); return }
    gsap.fromTo('.pjh-anim', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.08 })
  }, [])

  return (
    <div className="pjh-wrap" ref={(el) => { scopeRef.current = el }}>
      <p className="pjh-eyebrow pjh-anim">Practice</p>
      <h1 className="pjh-title pjh-anim">
        {isTrashView ? 'Recycle Bin' : 'Your Practice Journey'}
      </h1>
      <p className="pjh-sub pjh-anim">
        {isTrashView
          ? "Sessions you've removed — restore them or delete for good."
          : 'See how your conversations are evolving over time.'}
      </p>
      {!isTrashView && sessionCount > 0 && (
        <span className="pjh-count pjh-anim">
          {sessionCount} session{sessionCount === 1 ? '' : 's'} so far
        </span>
      )}

      <style>{`
        .pjh-wrap{ display:flex; flex-direction:column; gap:6px; }
        .pjh-eyebrow{ font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin:0; }
        .pjh-title{
          font-size:clamp(26px, 3.6vw, 36px); font-weight:800; letter-spacing:-0.015em; margin:0;
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          text-wrap:balance;
        }
        .pjh-sub{ font-size:14.5px; color:var(--text-med); margin:2px 0 0; max-width:480px; }
        .pjh-count{
          margin-top:10px; align-self:flex-start; font-size:11.5px; font-weight:650; color:var(--accent);
          background:var(--accent-glow); padding:5px 13px; border-radius:100px;
        }
      `}</style>
    </div>
  )
}
