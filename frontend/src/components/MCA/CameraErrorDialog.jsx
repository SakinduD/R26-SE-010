import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { VideoOff, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'

// Copy per error kind (see onCameraError in useNudgeSensing).
const COPY = {
  in_use: {
    title: 'Your camera is being used by another app',
    body: 'Another app (like Teams or Zoom) has your camera, and Windows only lets one app use it at a time by default. You can let apps share it:',
    steps: [
      'Open Windows Settings → Bluetooth & devices → Cameras.',
      'Click your camera, then open Advanced camera options.',
      'Turn on "Allow multiple apps to use the camera at the same time".',
      'Close and reopen Teams and this browser, then try again.',
    ],
    note: 'Or turn your camera off in the other app and try again.',
  },
  blocked: {
    title: 'Camera access is blocked',
    body: 'Your browser isn\'t allowing this site to use the camera.',
    steps: [
      'Click the camera or lock icon at the left of the address bar.',
      'Set Camera to Allow for this site.',
      'Reload the page, then try again.',
    ],
  },
  unknown: {
    title: 'Couldn\'t start your camera',
    body: 'Check that your camera is connected and not turned off with a privacy switch, then try again.',
  },
}

/**
 * CameraErrorDialog — closable popup explaining why the camera failed to
 * start and how to fix it.
 *
 * Props:
 *   error   — { kind: "in_use" | "blocked" | "unknown", name } or null (hidden)
 *   onClose — dismiss the popup
 *   onRetry — dismiss and try turning the camera on again
 */
export default function CameraErrorDialog({ error, onClose, onRetry }) {
  useEffect(() => {
    if (!error) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [error, onClose])

  if (!error) return null
  const copy = COPY[error.kind] || COPY.unknown

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="camera-error-title"
        className="relative w-full max-w-md bg-surface border border-border-default rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-t-tertiary hover:text-t-primary hover:bg-elevated transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div className="shrink-0 p-2.5 rounded-xl" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            <VideoOff size={20} />
          </div>
          <div>
            <h2 id="camera-error-title" className="text-base font-semibold text-t-primary">{copy.title}</h2>
            <p className="mt-1 text-sm text-t-secondary">{copy.body}</p>
          </div>
        </div>

        {copy.steps && (
          <ol className="mt-4 ml-1 space-y-2 text-sm text-t-primary list-decimal list-inside">
            {copy.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        )}
        {copy.note && <p className="mt-3 text-sm text-t-secondary">{copy.note}</p>}
        {error.kind === 'unknown' && error.name && (
          <p className="mt-3 text-xs font-mono text-t-tertiary">Error: {error.name}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
