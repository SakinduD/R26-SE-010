import { Compass } from 'lucide-react'

export default function EmptyPracticeState({ onBrowse }) {
  return (
    <div className="eps-wrap">
      <div className="eps-icon"><Compass size={26} strokeWidth={1.6} /></div>
      <p className="eps-title">Your practice journey starts here</p>
      <p className="eps-desc">
        Your completed role-play sessions will appear here. Start your first
        scenario and begin building your communication practice history.
      </p>
      <button type="button" onClick={onBrowse} className="btn-c primary">
        Browse scenarios
      </button>

      <style>{`
        .eps-wrap{
          display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
          background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:56px 24px; color:var(--text-med);
          box-shadow:0 10px 28px rgba(17,12,34,0.05); grid-column:1/-1;
        }
        .eps-icon{
          width:52px; height:52px; border-radius:14px; background:var(--accent-glow); color:var(--accent);
          display:flex; align-items:center; justify-content:center; margin-bottom:6px;
        }
        .eps-title{ font-size:16px; font-weight:750; color:var(--text-hi); margin:0; }
        .eps-desc{ font-size:13px; margin:0 0 6px; max-width:360px; line-height:1.55; }
      `}</style>
    </div>
  )
}
