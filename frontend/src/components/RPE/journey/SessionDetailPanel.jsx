import gsap from 'gsap'
import { ArrowRight, X } from 'lucide-react'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'

// Shown when a Trust Journey node is clicked — lets the learner understand
// the session before deciding to jump into it, rather than navigating away
// immediately on click.
export default function SessionDetailPanel({ point, onOpenFeedback, onClose }) {
  const scopeRef = useGsapScope(({ instant }) => {
    if (instant) { gsap.set('.sdp-anim', { opacity: 1, y: 0 }); return }
    gsap.fromTo('.sdp-anim', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out' })
  }, [point?.sessionId])

  if (!point) return null

  return (
    <div className="sdp-wrap sdp-anim" ref={(el) => { scopeRef.current = el }}>
      <div className="sdp-head">
        <p className="sdp-eyebrow">Session Detail</p>
        <button type="button" className="sdp-close" onClick={onClose} aria-label="Close detail">
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>

      <h3 className="sdp-title">{point.title}</h3>
      <p className="sdp-meta">{point.difficulty} · {point.dateLabel}</p>

      <div className="sdp-stats">
        <div className="sdp-stat">
          <span className={`sdp-stat-val ${point.tone}`}>{point.trust}</span>
          <span className="sdp-stat-label">Trust</span>
        </div>
        <div className="sdp-stat">
          <span className={`sdp-stat-val ${point.tone}`}>{point.statusLabel}</span>
          <span className="sdp-stat-label">Outcome</span>
        </div>
        {point.durationLabel && (
          <div className="sdp-stat">
            <span className="sdp-stat-val">{point.durationLabel}</span>
            <span className="sdp-stat-label">Duration</span>
          </div>
        )}
      </div>

      <button type="button" className="sdp-view" onClick={() => onOpenFeedback(point.sessionId)}>
        View session <ArrowRight size={13} strokeWidth={2} />
      </button>

      <style>{`
        .sdp-wrap{
          background:var(--surface); border:1px solid var(--border); border-radius:16px;
          padding:20px 22px; box-shadow:0 10px 26px rgba(17,12,34,0.06); margin-top:16px;
        }
        .sdp-head{ display:flex; align-items:center; justify-content:space-between; }
        .sdp-eyebrow{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--accent); margin:0; }
        .sdp-close{
          background:var(--surface-hi); border:1px solid var(--border); border-radius:8px; color:var(--text-med);
          width:26px; height:26px; display:flex; align-items:center; justify-content:center; cursor:pointer;
        }
        .sdp-close:hover{ color:var(--text-hi); }
        .sdp-title{ font-size:17px; font-weight:750; margin:10px 0 0; }
        .sdp-meta{ font-size:12px; color:var(--text-med); margin:4px 0 0; text-transform:capitalize; }

        .sdp-stats{ display:flex; gap:24px; margin-top:16px; flex-wrap:wrap; }
        .sdp-stat{ display:flex; flex-direction:column; gap:2px; }
        .sdp-stat-val{ font-size:16px; font-weight:750; color:var(--text-hi); font-variant-numeric:tabular-nums; text-transform:capitalize; }
        .sdp-stat-val.success{ color:var(--success); }
        .sdp-stat-val.danger{  color:var(--danger); }
        .sdp-stat-val.neutral{ color:var(--text-med); }
        .sdp-stat-label{ font-size:10px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; color:var(--text-low); }

        .sdp-view{
          display:inline-flex; align-items:center; gap:6px; margin-top:18px; background:none; border:none;
          color:var(--accent); font-size:13px; font-weight:700; cursor:pointer; padding:0; font-family:inherit;
        }
        .sdp-view:hover{ text-decoration:underline; }
      `}</style>
    </div>
  )
}
