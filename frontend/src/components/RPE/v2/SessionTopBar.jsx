import { ArrowLeft, Maximize, Minimize } from 'lucide-react'

// Minimal floating HUD over the scene, anchored entirely to the top-LEFT —
// back button, live/duration, fullscreen toggle, all in one small cluster.
// Deliberately does not reach toward the top-right: that corner is the
// camera preview's alone now (see RolePlaySessionV2.jsx/.css), so the two
// never compete or overlap. No title here either: scenario/NPC identity
// lives in one consolidated block just below this row (see
// .rps2-npc-identity) rather than duplicated in both places. Position:
// absolute over the scene (see the CSS) instead of its own solid-background
// row, so it doesn't push the stage down and eat into the cinematic
// composition's vertical budget.
export default function SessionTopBar({ duration, onBack, isFullscreen, onToggleFullscreen }) {
  return (
    <div className="rps2-topbar">
      <button type="button" className="rps2-back" onClick={onBack} aria-label="Back to Practice Lab">
        <ArrowLeft size={16} strokeWidth={1.8} />
      </button>
      <span className="rps2-live">
        <span className="rps2-live-dot" aria-hidden />
        Live · {duration}
      </span>
      {onToggleFullscreen && (
        <button
          type="button"
          className="rps2-fullscreen-btn"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        >
          {isFullscreen ? <Minimize size={15} strokeWidth={1.8} /> : <Maximize size={15} strokeWidth={1.8} />}
        </button>
      )}
    </div>
  )
}
