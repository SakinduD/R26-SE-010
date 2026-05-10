import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Save,
  Star,
  ShieldCheck,
  User,
  Layout,
  Activity,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import { useAnalyticsIdentity } from './analyticsAuth'
import {
  normalizeComponentSessionOptions,
  optionalRequest,
  selectPreferredComponentSession,
} from './analyticsIntegrationUtils'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Banner from '@/components/ui/Banner'
import SegmentedControl from '@/components/ui/SegmentedControl'
import KeyValuePair from '@/components/ui/KeyValuePair'

const SKILL_OPTIONS = [
  { value: 'vocal_command', label: 'Vocal Command', sub: 'Speech Volume' },
  { value: 'speech_fluency', label: 'Speech Fluency', sub: 'Pace & Clarity' },
  { value: 'presence_engagement', label: 'Presence & Engagement', sub: 'Eye Contact & Confidence' },
  { value: 'emotional_intelligence', label: 'Emotional Intelligence', sub: 'Empathy & Control' },
]

export default function FeedbackForm() {
  const params = useParams()
  const navigate = useNavigate()
  const {
    userId: connectedUserId,
    userLabel,
  } = useAnalyticsIdentity(null, 'user-123')

  const [form, setForm] = useState({
    user_id: connectedUserId,
    session_id: params.sessionId || '',
    ratings: {
      vocal_command: 75,
      speech_fluency: 75,
      presence_engagement: 75,
      emotional_intelligence: 75,
    },
    sentiment: 'neutral',
    comment: '',
  })

  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  // Session options + status are loaded but not displayed in this restyle —
  // sidebar nav handles session selection. Kept to preserve existing fetch logic.
  // eslint-disable-next-line no-unused-vars
  const [sessionOptions, setSessionOptions] = useState([])
  // eslint-disable-next-line no-unused-vars
  const [sessionStatus, setSessionStatus] = useState('loading')

  const avgRating = useMemo(() => {
    const vals = Object.values(form.ratings)
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  }, [form.ratings])

  const canSubmit = useMemo(
    () => form.user_id.trim() && form.session_id.trim(),
    [form]
  )

  const updateRating = (skill, value) => {
    setForm(prev => ({
      ...prev,
      ratings: { ...prev.ratings, [skill]: Number(value) }
    }))
    setMessage('')
  }

  const submitFeedback = async (event) => {
    event.preventDefault()
    if (!canSubmit) {
      setMessage('Session ID is required.')
      return
    }

    setStatus('saving')
    setMessage('')

    try {
      const promises = Object.entries(form.ratings).map(([skill, val]) => {
        return analyticsService.createFeedbackEntry({
          user_id: form.user_id.trim(),
          session_id: form.session_id.trim(),
          feedback_type: 'self',
          skill_area: skill,
          rating: val,
          sentiment: form.sentiment,
          comment: skill === 'vocal_command' ? form.comment : null
        })
      })

      await Promise.all(promises)
      setStatus('success')
      setMessage('Self-evaluation completed!')
      if (params.sessionId) {
        setTimeout(() => navigate('/analytics-dashboard'), 2000)
      }
    } catch (error) {
      setStatus('error')
      setMessage('Error saving feedback.')
    }
  }

  useEffect(() => {
    setForm((current) => ({ ...current, user_id: connectedUserId }))
  }, [connectedUserId])

  useEffect(() => {
    let cancelled = false
    const loadCompletedSessions = async () => {
      setSessionStatus('loading')
      const [rpeSessions, mcaSessions] = await Promise.all([
        optionalRequest(() => analyticsService.getComponentRpeSessions()),
        optionalRequest(() => analyticsService.getComponentMcaSessions()),
      ])
      if (cancelled) return
      const options = normalizeComponentSessionOptions(rpeSessions.data, mcaSessions.data)
      const preferred = selectPreferredComponentSession(options)
      setSessionOptions(options)
      setSessionStatus(options.length ? 'ready' : 'empty')

      setForm((current) => {
        if (params.sessionId) return { ...current, session_id: params.sessionId }
        if (preferred) return { ...current, session_id: preferred.id }
        return current
      })
    }
    loadCompletedSessions().catch(() => { if (!cancelled) setSessionStatus('error') })
    return () => { cancelled = true }
  }, [params.sessionId])

  return (
    <div className="page page-wide">
      {/* REDESIGN: hero replaced AnalyticsNav + indigo-500/font-black/tracking-[0.3em] header
          with PageHead + Badge for "Self-reflection" */}
      <PageHead
        eyebrow="Post-session evaluation"
        title="Self-reflection"
        sub="Your reflections seed the prediction model — be honest."
      />

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px', alignItems: 'start' }}>

        {/* REDESIGN: form column rebuilt with Card components, prototype tokens, no indigo/slate hardcoded colors */}
        <form onSubmit={submitFeedback} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent)',
                }}
              >
                <ShieldCheck size={16} strokeWidth={1.8} />
              </div>
              <div>
                <div className="t-h3" style={{ margin: 0 }}>Session verification</div>
                <p className="t-cap" style={{ margin: 0 }}>
                  This form is required to finalize your analytics
                </p>
              </div>
            </div>

            <div className="field">
              <label className="field-label">Active session ID</label>
              <div
                className="input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 44,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  color: form.session_id ? 'var(--text-primary)' : 'var(--text-quaternary)',
                }}
              >
                {form.session_id || 'Waiting for session…'}
              </div>
            </div>
          </Card>

          {/* REDESIGN: skill ratings — replaced bg-indigo-600/bg-slate-700 with .input track + accent thumb (CSS var styling) */}
          <Card>
            <div className="t-h3" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px' }}>
              <Star size={14} strokeWidth={1.8} style={{ color: 'var(--warning)' }} />
              Rate your performance
            </div>
            <p className="t-cap" style={{ margin: '0 0 24px' }}>
              How do you feel you performed in each area? (0–100)
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {SKILL_OPTIONS.map((skill) => (
                <div key={skill.value}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-end',
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <span className="fg" style={{ fontSize: 14, fontWeight: 500, display: 'block' }}>
                        {skill.label}
                      </span>
                      <span className="t-cap" style={{ fontStyle: 'italic' }}>
                        {skill.sub}
                      </span>
                    </div>
                    <Badge variant="accent">
                      <span className="score-num">{form.ratings[skill.value]}</span>
                    </Badge>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={form.ratings[skill.value]}
                    onChange={(e) => updateRating(skill.value, e.target.value)}
                    className="slider"
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* REDESIGN: sentiment buttons replaced emoji + bg-green-500/10 etc. with text-only SegmentedControl */}
          <Card>
            <div className="t-h3" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px' }}>
              <Star size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
              Overall sentiment
            </div>
            <SegmentedControl
              value={form.sentiment}
              onChange={(v) => setForm((p) => ({ ...p, sentiment: v }))}
              options={[
                { label: 'Positive', value: 'positive' },
                { label: 'Neutral', value: 'neutral' },
                { label: 'Negative', value: 'negative' },
              ]}
            />
          </Card>

          {/* REDESIGN: comment textarea uses .input + .textarea (was bg-background + ring-indigo-500/30) */}
          <Card>
            <div className="t-h3" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px' }}>
              <MessageSquare size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
              Additional observations
            </div>
            <textarea
              className="input textarea"
              placeholder="What specific moment in the session made you feel this way? (Optional)"
              value={form.comment}
              onChange={(e) => setForm(prev => ({ ...prev, comment: e.target.value }))}
              style={{ minHeight: 120, padding: 14 }}
            />
          </Card>

          {/* REDESIGN: status message replaced bg-red-500/10/etc. ad-hoc colors with Banner */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            {message && (
              <div style={{ width: '100%' }}>
                <Banner
                  variant={
                    status === 'success' ? 'success'
                      : status === 'error' ? 'danger'
                      : 'info'
                  }
                >
                  {message}
                </Banner>
              </div>
            )}
            {/* REDESIGN: bg-indigo-600 submit button replaced with Button primary */}
            <Button
              type="submit"
              disabled={!canSubmit || status === 'saving'}
              loading={status === 'saving'}
              size="lg"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {status === 'saving'
                  ? <RefreshCw size={14} strokeWidth={1.8} className="animate-spin" />
                  : <Save size={14} strokeWidth={1.8} />}
                Complete evaluation
              </span>
            </Button>
          </div>
        </form>

        {/* REDESIGN: preview pane rebuilt with Card accent + KeyValuePair (was indigo-400/slate-200) */}
        <aside style={{ position: 'sticky', top: 80, height: 'fit-content' }} className="hide-mobile-aside">
          <Card variant="accent">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
                color: 'var(--accent)',
              }}
            >
              <Star size={14} strokeWidth={1.8} />
              <div className="t-over" style={{ color: 'var(--accent)' }}>Current entry</div>
            </div>

            <KeyValuePair k={<><User size={12} strokeWidth={1.8} style={{ marginRight: 4 }} />User</>} v={userLabel || connectedUserId || '—'} />
            <KeyValuePair k={<><Layout size={12} strokeWidth={1.8} style={{ marginRight: 4 }} />Session</>} v={form.session_id || '—'} mono />
            <KeyValuePair k={<><Activity size={12} strokeWidth={1.8} style={{ marginRight: 4 }} />Type</>} v="Self reflection" />
            <KeyValuePair k={<><Star size={12} strokeWidth={1.8} style={{ marginRight: 4 }} />Skills</>} v="4 skills" />
            <KeyValuePair k={<><CheckCircle2 size={12} strokeWidth={1.8} style={{ marginRight: 4 }} />Avg rating</>} v={avgRating} mono />
            <KeyValuePair k={<><MessageSquare size={12} strokeWidth={1.8} style={{ marginRight: 4 }} />Sentiment</>} v={<span style={{ textTransform: 'capitalize' }}>{form.sentiment}</span>} />

            <div
              style={{
                marginTop: 18,
                padding: 14,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-muted)',
                borderRadius: 'var(--radius)',
              }}
            >
              <p className="t-cap" style={{ color: 'var(--accent)', lineHeight: 1.55, margin: 0 }}>
                Confirm your ratings before submitting. Your self-reflection will be compared with AI-observed metrics to detect blind spots.
              </p>
            </div>
          </Card>
        </aside>
      </div>

      {/* Hide preview pane on mobile (was hidden lg:block) */}
      <style>{`
        @media (max-width: 1023px) {
          .hide-mobile-aside { display: none; }
        }
      `}</style>
    </div>
  )
}
