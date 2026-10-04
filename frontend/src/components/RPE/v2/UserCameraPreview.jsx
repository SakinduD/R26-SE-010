import Webcam from 'react-webcam'
import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

// Small, upper-right camera preview — the same webcamRef/canvasRef from
// useNudgeSensing (the shared MCA sensing pipeline), just visually
// secondary now instead of a competing panel.
//
// Face-mesh overlay toggle is dev-only here (V1 keeps its own existing
// behavior untouched, exposing it to every learner) — the landmark
// tracking visualization reads as a computer-vision debug view, not
// something a learner-facing camera preview should ever show, let alone
// let a learner turn ON. `showMesh` already defaults to false in
// RolePlaySessionV2.jsx; this additionally removes the control that would
// let a production user re-enable it. The underlying coaching-sensing
// analysis is unaffected either way — showMesh only ever gated the actual
// drawConnectors() overlay drawing (see useNudgeSensing.js), never the
// metrics feeding real coaching nudges.
export default function UserCameraPreview({ webcamRef, canvasRef, showMesh, onToggleMesh }) {
  return (
    <div className="rps2-camera-dock">
      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        videoConstraints={{ facingMode: 'user', aspectRatio: 1 }}
      />
      <canvas ref={canvasRef} />
      <span className="rps2-camera-label">
        <span className="rps2-camera-live-dot" aria-hidden />
        You
      </span>
      {import.meta.env.DEV && (
        <button
          type="button"
          className={cn('rps2-mesh-toggle', !showMesh && 'muted')}
          onClick={onToggleMesh}
          title={showMesh ? 'Hide face tracking overlay (dev only)' : 'Show face tracking overlay (dev only)'}
          aria-label={showMesh ? 'Hide face mesh overlay' : 'Show face mesh overlay'}
        >
          <Activity size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
