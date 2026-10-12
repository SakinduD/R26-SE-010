import { useState } from 'react'
import {
  Sparkles, Mic2, SmilePlus, Gauge, X,
  AlertTriangle, Info, Volume2, Smile,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// The whole "quiet coach" system in one place: the pill that replaces V1's
// "Analyzing On" label, its explanatory popover, and the nudge stack itself.
export function CoachingToggle({ active, onToggle }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rps2-coaching-wrap">
      <button
        type="button"
        className={cn('rps2-coaching-pill', active && 'active')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="rps2-coaching-dot" aria-hidden />
        {active ? 'Live coaching' : 'Coaching off'}
      </button>

      {open && (
        <div className="rps2-coaching-popover" role="dialog" aria-label="Live coaching details">
          <p className="rps2-coaching-title">Live coaching</p>
          <ul className="rps2-coaching-list">
            <li><Mic2 size={13} strokeWidth={2} /> Voice</li>
            <li><SmilePlus size={13} strokeWidth={2} /> Facial expression</li>
            <li><Gauge size={13} strokeWidth={2} /> Speaking pace</li>
          </ul>
          <p className="rps2-coaching-desc">
            Your camera and microphone are used for real-time coaching nudges during the simulation.
          </p>
          <button
            type="button"
            className="rps2-coaching-off"
            onClick={() => { onToggle(); setOpen(false) }}
          >
            {active ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      )}
    </div>
  )
}

function renderNudgeIcon(nudge) {
  if (nudge.severity === 'critical') {
    return <AlertTriangle size={13} strokeWidth={2.2} className="rps2-nudge-icon rps2-nudge-icon-critical" aria-hidden />
  }
  if (nudge.category === 'volume') {
    return <Volume2 size={13} strokeWidth={2} className="rps2-nudge-icon" aria-hidden />
  }
  if (nudge.category === 'pace') {
    return <Gauge size={13} strokeWidth={2} className="rps2-nudge-icon" aria-hidden />
  }
  if (nudge.category === 'expression') {
    return <Smile size={13} strokeWidth={2} className="rps2-nudge-icon" aria-hidden />
  }
  if (nudge.severity === 'warning') {
    return <AlertTriangle size={13} strokeWidth={2} className="rps2-nudge-icon rps2-nudge-icon-warning" aria-hidden />
  }
  return <Sparkles size={13} strokeWidth={2} className="rps2-nudge-icon rps2-nudge-icon-info" aria-hidden />
}

export default function CoachingNudge({ nudges, onDismiss }) {
  if (!nudges || nudges.length === 0) return null

  return (
    <div className="rps2-nudge-stack">
      {nudges.map((nudge) => {
        const severityClass = nudge.severity === 'critical'
          ? 'rps2-nudge-critical'
          : nudge.severity === 'warning'
            ? 'rps2-nudge-warning'
            : 'rps2-nudge-info'

        return (
          <div key={nudge.id} className={cn('rps2-nudge', severityClass)}>
            {renderNudgeIcon(nudge)}
            <span className="rps2-nudge-text">{nudge.text}</span>
            <button
              type="button"
              className="rps2-nudge-dismiss"
              onClick={() => onDismiss(nudge.id)}
              aria-label="Dismiss coaching note"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
