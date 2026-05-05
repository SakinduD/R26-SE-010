import React, { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
} from 'lucide-react'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'

const SKILL_LABELS = {
  confidence: 'Confidence',
  communication_clarity: 'Clarity',
  empathy: 'Empathy',
  active_listening: 'Listening',
  adaptability: 'Adaptability',
  emotional_control: 'Emotional Control',
  professionalism: 'Professionalism',
  overall: 'Overall',
}

const DEMO_REPORT = {
  session_id: 'demo-session',
  user_id: 'demo-user',
  summary: {
    headline: 'Session completed with focused improvement areas.',
    strengths: ['Empathy', 'Listening', 'Professionalism'],
    improvement_areas: ['Confidence', 'Emotional Control'],
    completion_status: 'complete',
  },
  aggregate: {
    scores: { metric_count: 1 },
    feedback: {
      total_count: 4,
      average_rating: 78,
      latest_entries: [
        {
          id: 1,
          feedback_type: 'self',
          skill_area: 'confidence',
          rating: 92,
          sentiment: 'positive',
          comment: 'I felt confident during the negotiation.',
        },
        {
          id: 2,
          feedback_type: 'peer',
          skill_area: 'confidence',
          rating: 60,
          sentiment: 'neutral',
          comment: 'Good attempt, but eye contact and response structure need work.',
        },
      ],
    },
    predictions: {
      total_count: 1,
      latest_predictions: [
        {
          id: 1,
          predicted_skill: 'confidence',
          current_score: 58,
          predicted_score: 52,
          risk_level: 'high',
          recommendation: 'Practice shorter opening responses before the next scenario.',
        },
      ],
    },
  },
  skill_scores: {
    overall_score: 76,
    completeness: 0.86,
    skill_scores: {
      confidence: 58,
      communication_clarity: 74,
      empathy: 82,
      active_listening: 79,
      adaptability: 72,
      emotional_control: 64,
      professionalism: 80,
    },
  },
  blind_spots: {
    summary: { total_count: 1, high_count: 1, medium_count: 0, low_count: 0 },
    blind_spots: [
      {
        skill_area: 'confidence',
        blind_spot_type: 'overestimation',
        severity: 'high',
        gap: 34,
        recommendation: 'Review confidence evidence and set one measurable eye-contact goal.',
      },
    ],
  },
  action_items: [
    {
      priority: 'high',
      skill_area: 'confidence',
      title: 'Review Confidence blind spot',
      detail: 'Compare self-rating with observed and peer feedback before the next session.',
    },
    {
      priority: 'medium',
      skill_area: 'emotional_control',
      title: 'Practice Emotional Control',
      detail: 'Use a pause-breathe-answer pattern during difficult role-play prompts.',
    },
  ],
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function PostSessionReport() {
  const params = useParams()
  const [sessionId, setSessionId] = useState(params.sessionId || 'demo-session')
  const [report, setReport] = useState(DEMO_REPORT)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const radarScores = useMemo(() => {
    const scores = report.skill_scores?.skill_scores || {}
    return Object.entries(SKILL_LABELS)
      .filter(([key]) => key !== 'overall')
      .map(([key, label]) => ({ key, label, value: Number(scores[key] || 0) }))
  }, [report])

  const loadReport = async () => {
    if (!sessionId.trim()) {
      setError('Enter a session id')
      return
    }

    setStatus('loading')
    setError('')

    try {
      const nextReport = await analyticsService.getPostSessionReport(sessionId.trim())
      setReport(nextReport)
      setStatus('live')
    } catch (err) {
      setReport(DEMO_REPORT)
      setStatus('demo')
      setError('Backend report unavailable. Showing demo report.')
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
            <h1 className="mt-1 text-2xl font-semibold">Post-Session Report</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <AnalyticsNav />
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span>Session</span>
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
              />
            </label>
            <Button className="h-10 self-end" onClick={loadReport}>
              {status === 'loading' ? <RefreshCw className="animate-spin" /> : <Search />}
              Load
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-4 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {error ? <span className="text-sm text-warning">{error}</span> : null}
        </div>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4 text-secondary" />
                <span>{report.session_id}</span>
                {report.user_id ? <span>{report.user_id}</span> : null}
              </div>
              <h2 className="mt-3 max-w-3xl text-xl font-semibold">{report.summary?.headline}</h2>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
              <Metric label="Overall" value={formatScore(report.skill_scores?.overall_score)} />
              <Metric label="Feedback" value={report.aggregate?.feedback?.total_count || 0} />
              <Metric label="Actions" value={report.action_items?.length || 0} />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Skill Twin" icon={Target}>
            <SkillTwinRadar scores={radarScores} />
          </Panel>

          <Panel title="Report Summary" icon={CheckCircle2}>
            <SummaryList title="Strengths" items={report.summary?.strengths || []} emptyText="No strengths detected yet" />
            <div className="mt-4">
              <SummaryList title="Improvement Areas" items={report.summary?.improvement_areas || []} emptyText="No improvement areas detected yet" />
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Action Plan" icon={ClipboardList}>
            <ActionList actions={report.action_items || []} />
          </Panel>

          <Panel title="Blind Spots" icon={ShieldAlert}>
            <BlindSpotList blindSpots={report.blind_spots?.blind_spots || []} />
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Feedback Evidence" icon={FileText}>
            <FeedbackList entries={report.aggregate?.feedback?.latest_entries || []} />
          </Panel>

          <Panel title="Prediction Evidence" icon={AlertTriangle}>
            <PredictionList predictions={report.aggregate?.predictions?.latest_predictions || []} />
          </Panel>
        </div>
      </section>
    </main>
  )
}

function StatusPill({ status }) {
  const label = status === 'live' ? 'Live API report' : status === 'loading' ? 'Loading report' : 'Demo report'
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  )
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-secondary" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function SummaryList({ title, items, emptyText }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className="rounded-full border border-border bg-background px-3 py-1 text-xs">
              {item}
            </span>
          ))}
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}
    </div>
  )
}

function ActionList({ actions }) {
  if (!actions.length) return <EmptyState text="No action items yet" />

  return (
    <div className="space-y-3">
      {actions.map((item, index) => (
        <div key={`${item.title}-${index}`} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{item.title}</span>
            <PriorityBadge priority={item.priority} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
        </div>
      ))}
    </div>
  )
}

function BlindSpotList({ blindSpots }) {
  if (!blindSpots.length) return <EmptyState text="No blind spots detected" />

  return (
    <div className="space-y-3">
      {blindSpots.map((item) => (
        <div key={item.skill_area} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelFor(item.skill_area)}</span>
            <PriorityBadge priority={item.severity} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.blind_spot_type} gap of {formatScore(item.gap)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{item.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function FeedbackList({ entries }) {
  if (!entries.length) return <EmptyState text="No feedback entries yet" />

  return (
    <div className="space-y-3">
      {entries.map((item) => (
        <div key={item.id} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelFor(item.skill_area || item.feedback_type)}</span>
            <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{item.feedback_type}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.comment || 'No comment provided'}</p>
          <p className="mt-2 text-xs text-muted-foreground">Rating {formatScore(item.rating)}</p>
        </div>
      ))}
    </div>
  )
}

function PredictionList({ predictions }) {
  if (!predictions.length) return <EmptyState text="No prediction evidence yet" />

  return (
    <div className="space-y-3">
      {predictions.map((item) => (
        <div key={item.id || item.predicted_skill} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelFor(item.predicted_skill)}</span>
            <PriorityBadge priority={item.risk_level} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-muted-foreground">
            <span>Current {formatScore(item.current_score)}</span>
            <span>Next {formatScore(item.predicted_score)}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function PriorityBadge({ priority }) {
  const className =
    priority === 'high'
      ? 'bg-destructive/20 text-destructive'
      : priority === 'medium'
        ? 'bg-warning/20 text-warning'
        : 'bg-success/20 text-success'
  return <span className={`rounded-full px-2 py-1 text-xs ${className}`}>{priority}</span>
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{text}</div>
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}
