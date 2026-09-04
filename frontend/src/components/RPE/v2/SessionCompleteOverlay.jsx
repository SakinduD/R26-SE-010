import { Check } from 'lucide-react'

// Subtle transition over the stage when the session ends — not a modal
// thrown over the avatar. Visibility is driven by the parent's
// data-voice-state="complete" CSS selector (RolePlaySessionV2.css) so the
// fade timing matches the avatar finishing its last line, same moment V1
// reveals its own completion card.
export default function SessionCompleteOverlay({ trustScore, subtitle, onViewFeedback }) {
  return (
    <div className="rps2-complete-overlay">
      <div className="rps2-complete-card">
        <div className="rps2-complete-check"><Check size={24} strokeWidth={2.4} /></div>
        <p className="rps2-complete-title">Session Complete</p>
        {trustScore != null && (
          <>
            <p className="rps2-complete-trust-num">{trustScore}</p>
            <p className="rps2-complete-trust-label">Final Trust</p>
          </>
        )}
        {subtitle && <p className="rps2-complete-sub">{subtitle}</p>}
        <button type="button" className="rps2-complete-btn" onClick={onViewFeedback}>
          View feedback
        </button>
      </div>
    </div>
  )
}
