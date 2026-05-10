import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Camera, Loader2, Mic, ShieldCheck, X } from 'lucide-react'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'

const CONSENT_KEY = 'empowerz:baseline:consent:v1'
const DECISION_KEY = 'empowerz:baseline:decision'

const CAPTURE_ITEMS = [
  {
    Icon: Mic,
    label: 'Voice',
    detail: 'Tone, pace, and fluency during a ~60-second guided conversation',
  },
  {
    Icon: Camera,
    label: 'Camera',
    detail: 'Facial engagement signals via MediaPipe — processed locally in your browser',
  },
]

const PRIVACY_ITEMS = [
  'Raw audio and video are never stored on our servers',
  'No recordings are shared with third parties',
  'You can redo or delete your baseline at any time from settings',
]

export default function BaselineConsent() {
  const { isLoading: authLoading } = useProtectedRoute()
  const navigate = useNavigate()
  const [skipping, setSkipping] = useState(false)

  function handleConsent() {
    localStorage.setItem(CONSENT_KEY, 'true')
    localStorage.setItem(DECISION_KEY, 'consented')
    navigate('/baseline')
  }

  function handleSkip() {
    setSkipping(true)
    localStorage.setItem(DECISION_KEY, 'skipped')
    navigate('/training-plan')
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', minHeight: '50vh', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    )
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page page-read"
    >
      <PageHead
        eyebrow="Voice baseline"
        title="Before we begin"
        sub="A quick note on what the session captures and how your data is handled."
      />

      {/* What we capture */}
      <motion.div variants={fadeInUp}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
              }}
            >
              <Mic size={14} strokeWidth={1.8} />
            </div>
            <div className="t-h3" style={{ margin: 0 }}>What we capture</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {CAPTURE_ITEMS.map(({ Icon, label, detail }) => (
              <div
                key={label}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <Icon size={16} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div className="fg" style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                  <div className="t-cap" style={{ marginTop: 3 }}>{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Privacy */}
      <motion.div variants={fadeInUp}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'color-mix(in oklch, var(--success) 12%, transparent)',
                border: '1px solid color-mix(in oklch, var(--success) 22%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--success)',
              }}
            >
              <ShieldCheck size={14} strokeWidth={1.8} />
            </div>
            <div className="t-h3" style={{ margin: 0 }}>What we don't do</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PRIVACY_ITEMS.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <ShieldCheck
                  size={14} strokeWidth={1.8}
                  style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }}
                />
                <div className="fg" style={{ fontSize: 14 }}>{item}</div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* CTAs */}
      <motion.div
        variants={fadeInUp}
        style={{ paddingTop: 8, paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <button
          type="button"
          onClick={handleConsent}
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
        >
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            I understand — let's start
            <ArrowRight size={14} strokeWidth={1.8} />
          </span>
        </button>

        <button
          type="button"
          onClick={handleSkip}
          disabled={skipping}
          className="btn btn-secondary btn-lg"
          style={{ width: '100%' }}
        >
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {skipping
              ? <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
              : <X size={14} strokeWidth={1.8} />}
            Skip baseline
          </span>
        </button>

        <div className="t-cap" style={{ textAlign: 'center', paddingTop: 4 }}>
          You can always complete the baseline later from your dashboard.
        </div>
      </motion.div>
    </motion.div>
  )
}
