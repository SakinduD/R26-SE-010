import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CheckCircle2,
  ClipboardCheck,
  Plus,
  MessageSquare,
  RefreshCw,
  Save,
  Star,
  User,
  Users,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsUserBadge from './AnalyticsUserBadge'
import AnalyticsUserField from './AnalyticsUserField'
import { useAnalyticsIdentity } from './analyticsAuth'

const SKILL_OPTIONS = [
  { value: 'confidence', label: 'Confidence' },
  { value: 'communication_clarity', label: 'Communication Clarity' },
  { value: 'empathy', label: 'Empathy' },
  { value: 'active_listening', label: 'Active Listening' },
  { value: 'adaptability', label: 'Adaptability' },
  { value: 'emotional_control', label: 'Emotional Control' },
  { value: 'professionalism', label: 'Professionalism' },
  { value: 'overall', label: 'Overall' },
]

const FEEDBACK_TYPES = [
  { value: 'self', label: 'Self', icon: User },
  { value: 'peer', label: 'Peer', icon: Users },
]

const SENTIMENT_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
]

const INITIAL_FORM = {
  user_id: 'demo-user',
  session_id: createSessionId(),
  feedback_type: 'self',
  skill_area: 'overall',
  rating: 75,
  sentiment: 'neutral',
  comment: '',
}

export default function FeedbackForm() {
  const params = useParams()
  const {
    userId: connectedUserId,
    userLabel,
    isAuthenticated,
  } = useAnalyticsIdentity(null, INITIAL_FORM.user_id)
  const [form, setForm] = useState({
    ...INITIAL_FORM,
    user_id: connectedUserId,
    session_id: params.sessionId || createSessionId(),
  })
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [createdEntry, setCreatedEntry] = useState(null)

  const canSubmit = useMemo(
    () => form.user_id.trim() && form.session_id.trim() && form.skill_area && form.feedback_type,
    [form]
  )

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setMessage('')
  }

  const submitFeedback = async (event) => {
    event.preventDefault()
    if (!canSubmit) {
      setMessage('User, session, feedback type, and skill are required.')
      return
    }

    setStatus('saving')
    setMessage('')

    const payload = {
      user_id: form.user_id.trim(),
      session_id: form.session_id.trim(),
      feedback_type: form.feedback_type,
      skill_area: form.skill_area,
      rating: Number(form.rating),
      sentiment: form.sentiment,
      comment: form.comment.trim() || null,
    }

    try {
      const entry = await analyticsService.createFeedbackEntry(payload)
      setCreatedEntry(entry)
      setStatus('success')
      setMessage('Feedback saved successfully.')
    } catch (error) {
      setStatus('error')
      setMessage('Could not save feedback. Check that the backend is running and try again.')
    }
  }

  const resetForm = () => {
    setForm({
      ...INITIAL_FORM,
      user_id: connectedUserId,
      session_id: params.sessionId || createSessionId(),
    })
    setCreatedEntry(null)
    setStatus('idle')
    setMessage('')
  }

  const startNewSession = () => {
    updateField('session_id', createSessionId())
    setCreatedEntry(null)
    setStatus('idle')
    setMessage('New session ID generated.')
  }

  useEffect(() => {
    setForm((current) => ({ ...current, user_id: connectedUserId }))
  }, [connectedUserId])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 md:px-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
          <h1 className="text-2xl font-semibold">Self and Peer Feedback</h1>
          <div className="pt-2">
            <AnalyticsUserBadge isAuthenticated={isAuthenticated} userLabel={userLabel} />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={submitFeedback} className="rounded-lg border border-border bg-card p-4">
          <div className="mb-5 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-secondary" />
            <h2 className="text-base font-semibold">Submit Feedback</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <AnalyticsUserField
              userId={form.user_id}
              userLabel={userLabel}
              isAuthenticated={isAuthenticated}
              onChange={(value) => updateField('user_id', value)}
            />
            <TextInput
              label="Session ID"
              value={form.session_id}
              onChange={(value) => updateField('session_id', value)}
              placeholder="session-123"
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  onClick={startNewSession}
                >
                  <Plus className="h-3 w-3" />
                  New
                </button>
              }
            />
          </div>

          <div className="mt-5">
            <FieldLabel>Feedback Type</FieldLabel>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FEEDBACK_TYPES.map((item) => (
                <SegmentButton
                  key={item.value}
                  active={form.feedback_type === item.value}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => updateField('feedback_type', item.value)}
                />
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <SelectInput
              label="Skill Area"
              value={form.skill_area}
              onChange={(value) => updateField('skill_area', value)}
              options={SKILL_OPTIONS}
            />
            <SelectInput
              label="Sentiment"
              value={form.sentiment}
              onChange={(value) => updateField('sentiment', value)}
              options={SENTIMENT_OPTIONS}
            />
          </div>

          <div className="mt-5 rounded-lg border border-border bg-background/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Rating</FieldLabel>
              <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">{form.rating}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={form.rating}
              onChange={(event) => updateField('rating', event.target.value)}
              className="mt-3 w-full accent-cyan-600"
            />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Needs work</span>
              <span>Excellent</span>
            </div>
          </div>

          <div className="mt-5">
            <FieldLabel>Comment</FieldLabel>
            <textarea
              className="mt-2 min-h-32 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              value={form.comment}
              placeholder="Write specific evidence from the session..."
              onChange={(event) => updateField('comment', event.target.value)}
            />
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <StatusMessage status={status} message={message} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>
                <RefreshCw />
                Reset
              </Button>
              <Button type="submit" disabled={!canSubmit || status === 'saving'}>
                {status === 'saving' ? <RefreshCw className="animate-spin" /> : <Save />}
                Save Feedback
              </Button>
            </div>
          </div>
        </form>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <Star className="h-4 w-4 text-secondary" />
              <h2 className="text-base font-semibold">Current Entry</h2>
            </div>
            <PreviewItem label="User" value={isAuthenticated ? userLabel : form.user_id} />
            <PreviewItem label="Session" value={form.session_id} />
            <PreviewItem label="Type" value={form.feedback_type} />
            <PreviewItem label="Skill" value={labelForSkill(form.skill_area)} />
            <PreviewItem label="Rating" value={form.rating} />
            <PreviewItem label="Sentiment" value={form.sentiment} />
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-secondary" />
              <h2 className="text-base font-semibold">Saved Result</h2>
            </div>
            {createdEntry ? (
              <div className="space-y-3 text-sm">
                <PreviewItem label="Feedback ID" value={createdEntry.id} />
                <PreviewItem label="Created" value={formatDate(createdEntry.created_at)} />
                <p className="rounded-md border border-success/30 bg-success/10 p-3 text-success">
                  This feedback is now available for post-session reports, blind spot detection, and feedback analysis.
                </p>
              </div>
            ) : (
              <EmptyState text="No feedback saved in this form yet" />
            )}
          </section>
        </aside>
      </section>
    </main>
  )
}

function TextInput({ label, value, onChange, placeholder, action }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        {action}
      </span>
      <input
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function SelectInput({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function SegmentButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      className={`flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium transition ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function FieldLabel({ children }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>
}

function StatusMessage({ status, message }) {
  if (!message) return <span className="text-sm text-muted-foreground">Ready to save feedback</span>

  const className =
    status === 'success' ? 'text-success' : status === 'error' ? 'text-destructive' : 'text-warning'
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${className}`}>
      {status === 'success' ? <CheckCircle2 className="h-4 w-4" /> : null}
      {message}
    </span>
  )
}

function PreviewItem({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[220px] truncate font-medium">{value || 'N/A'}</span>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{text}</div>
}

function labelForSkill(value) {
  return SKILL_OPTIONS.find((option) => option.value === value)?.label || value
}

function formatDate(value) {
  if (!value) return 'N/A'
  return new Date(value).toLocaleString()
}

function createSessionId() {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  return `softskill-session-${stamp}`
}
