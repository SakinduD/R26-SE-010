import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Loader2, Mic, ScanFace, ShieldCheck, X } from 'lucide-react'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import Card from '@/components/ui/Card'

// Bump the version suffix when what we capture changes, so users re-consent.
const CONSENT_KEYS = {
  baseline: 'empowerz:baseline:consent:v1',
  live: 'empowerz:live:consent:v1',
}

export function hasCaptureConsent(mode) {
  try {
    return localStorage.getItem(CONSENT_KEYS[mode]) === 'true'
  } catch {
    return false
  }
}

export function saveCaptureConsent(mode) {
  try {
    localStorage.setItem(CONSENT_KEYS[mode], 'true')
  } catch { }
}

const SIGNALS = [
  { Icon: Mic, label: 'Voice', tags: ['Tone', 'Pace', 'Fluency'] },
  { Icon: ScanFace, label: 'Face', tags: ['Eye contact', 'Head pose', 'Engagement'] },
]

const MODES = {
  baseline: {
    title: 'Baseline session',
    when: '~8 min guided chat with an AI coach, once',
    acceptLabel: "Agree & start",
    declineLabel: 'Skip for now',
  },
  live: {
    title: 'Live session',
    when: 'Real-time nudges while you talk, until you stop',
    acceptLabel: 'Agree & continue',
    declineLabel: 'Not now',
  },
}

const PRIVACY = [
  'No raw audio or video is stored',
  'Face is analysed on your device',
  'Redo or stop any time',
]

// Longer explanation, folded away for anyone who wants it.
const DETAILS = [
  'Voice audio is analysed in short chunks on our server and discarded straight after.',
  'Face landmarks (MediaPipe) run in your browser; only averaged scores are sent.',
  "Your speech is turned into text by your browser's speech recognition. Some browsers (e.g. Chrome) use the vendor's own service for this.",
  'Saved to your account: scores, averaged face metrics, voice tone over time, nudges and text transcripts.',
  "Live mode only: if you choose to share meeting audio, other participants' speech is transcribed too — let them know first.",
]

/**
 * CaptureConsent — short consent screen shown before the camera or
 * microphone is turned on.
 *
 * Props:
 *   mode      — "baseline" | "live"
 *   onAccept  — called once the user ticks the box and confirms
 *   onDecline — called when the user backs out
 *   declining — shows a spinner on the decline button
 */
export default function CaptureConsent({ mode, onAccept, onDecline, declining = false }) {
  const [agreed, setAgreed] = useState(false)
  const copy = MODES[mode]
  const checkboxId = `capture-consent-${mode}`

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page page-read"
      style={{ maxWidth: 560, margin: '0 auto' }}
    >
      <motion.div variants={fadeInUp} style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="t-over" style={{ marginBottom: 6 }}>{copy.title}</div>
        <div className="t-h1">We'll capture</div>
      </motion.div>

      {/* The two signals, at a glance */}
      <motion.div
        variants={fadeInUp}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}
      >
        {SIGNALS.map(({ Icon, label, tags }) => (
          <Card key={label} style={{ textAlign: 'center', padding: 20 }}>
            <div
              style={{
                width: 48, height: 48, borderRadius: 12, margin: '0 auto 10px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
              }}
            >
              <Icon size={22} strokeWidth={1.8} />
            </div>
            <div className="fg" style={{ fontSize: 16, fontWeight: 600 }}>{label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 10 }}>
              {tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}
            </div>
          </Card>
        ))}
      </motion.div>

      <motion.div variants={fadeInUp} className="t-cap" style={{ textAlign: 'center', marginTop: 12 }}>
        {copy.when}
      </motion.div>

      {/* Privacy in three lines */}
      <motion.div
        variants={fadeInUp}
        style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 16px', marginTop: 20 }}
      >
        {PRIVACY.map((item) => (
          <span key={item} className="fg" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <ShieldCheck size={14} strokeWidth={1.8} style={{ color: 'var(--success)' }} />
            {item}
          </span>
        ))}
      </motion.div>

      <motion.details variants={fadeInUp} style={{ marginTop: 12, textAlign: 'center' }}>
        <summary className="t-cap" style={{ cursor: 'pointer', color: 'var(--accent)' }}>More details</summary>
        <ul className="t-cap" style={{ textAlign: 'left', marginTop: 10, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, listStyle: 'disc' }}>
          {DETAILS.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </motion.details>

      {/* Agreement + CTAs */}
      <motion.div
        variants={fadeInUp}
        style={{ paddingTop: 20, paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <label
          htmlFor={checkboxId}
          className="fg"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          I agree to my voice and face signals being captured
        </label>

        <button
          type="button"
          onClick={onAccept}
          disabled={!agreed}
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
        >
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {copy.acceptLabel}
            <ArrowRight size={14} strokeWidth={1.8} />
          </span>
        </button>

        <button
          type="button"
          onClick={onDecline}
          disabled={declining}
          className="btn btn-ghost"
          style={{ width: '100%' }}
        >
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {declining
              ? <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
              : <X size={14} strokeWidth={1.8} />}
            {copy.declineLabel}
          </span>
        </button>
      </motion.div>
    </motion.div>
  )
}
