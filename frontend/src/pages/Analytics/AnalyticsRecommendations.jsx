import React, { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Lightbulb,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'

const SKILL_LABELS = {
  confidence: 'Confidence',
  communication_clarity: 'Communication Clarity',
  empathy: 'Empathy',
  active_listening: 'Active Listening',
  adaptability: 'Adaptability',
  emotional_control: 'Emotional Control',
  professionalism: 'Professionalism',
  overall: 'Overall',
}

const DEMO_DATA = {
  userId: 'demo-user',
  source: 'demo',
  modelVersion: 'demo-llm-mentoring',
  recommendations: [
    recommendation(
      'high',
      'confidence',
      'Review confidence blind spot',
      'Confidence has a visible self-perception gap.',
      'Your self-rating is higher than observed and peer evidence. Rewatch one response and define one measurable confidence behaviour.',
      'Before the next role-play, compare one self-rating with peer feedback and set one measurable confidence goal.',
      'Blind spot detection',
      ['blind_spot_detection', 'feedback_analysis']
    ),
    recommendation(
      'high',
      'emotional_control',
      'Reduce emotional-control risk',
      'The predictive model flags emotional control as the highest-risk area.',
      'Predicted score is declining. Practice a pause-breathe-answer routine before the next role-play.',
      'Use the pause-breathe-answer routine in the next difficult customer or manager response.',
      'Predictive analytics',
      ['predictive_model', 'progress_trends']
    ),
    recommendation(
      'medium',
      'empathy',
      'Protect empathy progress',
      'Empathy needs reinforcement before the next scenario.',
      'Empathy is showing decline. Add one reflective listening prompt in the next scenario.',
      'Prepare two reflective listening phrases and use at least one during the next simulation.',
      'Progress trend',
      ['progress_trends']
    ),
    recommendation(
      'low',
      'professionalism',
      'Maintain professionalism strength',
      'Professionalism is currently stable and can be maintained.',
      'Professionalism is stable and strong. Continue using clear openings and concise closing summaries.',
      'Keep using a concise opening and closing summary in each role-play.',
      'Skill twin',
      ['skill_twin_scores']
    ),
  ],
  aggregate: {
    scores: { metric_count: 4 },
    feedback: { total_count: 7, average_rating: 76 },
  },
  predictions: {
    summary: { high_risk_count: 1, medium_risk_count: 1, low_risk_count: 2 },
  },
  blindSpots: {
    summary: { total_count: 2, high_count: 1, medium_count: 1, low_count: 0 },
  },
  trends: {
    summary: { improving_count: 2, stable_count: 2, declining_count: 1 },
  },
}

function recommendation(priority, skillArea, title, reason, detail, nextAction, source, evidenceSources = []) {
  return {
    priority,
    skill_area: skillArea,
    title,
    reason,
    detail,
    next_action: nextAction,
    source,
    evidence_sources: evidenceSources,
  }
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function AnalyticsRecommendations() {
  const params = useParams()
  const [userId, setUserId] = useState(params.userId || 'demo-user')
  const [data, setData] = useState(DEMO_DATA)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const groupedRecommendations = useMemo(
    () => ({
      high: data.recommendations.filter((item) => item.priority === 'high'),
      medium: data.recommendations.filter((item) => item.priority === 'medium'),
      low: data.recommendations.filter((item) => item.priority === 'low'),
    }),
    [data.recommendations]
  )

  const hasLiveData = status !== 'live' || data.recommendations.length > 0

  const loadRecommendations = async () => {
    if (!userId.trim()) {
      setError('Enter a user id')
      return
    }

    setStatus('loading')
    setError('')

    try {
      const recommendations = await analyticsService.getMentoringRecommendationsByUser(userId.trim())

      setData({
        userId: recommendations.user_id,
        source: recommendations.source,
        modelVersion: recommendations.model_version,
        recommendationVersion: recommendations.recommendation_version,
        evidence: recommendations.evidence,
        recommendations: recommendations.recommendations,
        aggregate: {
          scores: { metric_count: recommendations.evidence?.session_count || 0 },
          feedback: {
            total_count: recommendations.evidence?.feedback_count || 0,
            average_rating: recommendations.evidence?.average_feedback_rating || null,
          },
        },
        blindSpots: {
          summary: {
            total_count: recommendations.evidence?.blind_spot_count || 0,
            high_count: recommendations.evidence?.high_blind_spot_count || 0,
          },
        },
        trends: {
          summary: {
            improving_count: recommendations.evidence?.improving_count || 0,
            declining_count: recommendations.evidence?.declining_count || 0,
          },
        },
        predictions: {
          summary: {
            high_risk_count: recommendations.evidence?.high_risk_prediction_count || 0,
            medium_risk_count: recommendations.evidence?.medium_risk_prediction_count || 0,
          },
        },
      })
      setStatus('live')
    } catch (err) {
      setData(DEMO_DATA)
      setStatus('demo')
      setError('Backend analytics unavailable. Showing demo recommendations.')
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
            <h1 className="mt-1 text-2xl font-semibold">Analytics Recommendations</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span>User</span>
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              />
            </label>
            <Button className="h-10 self-end" onClick={loadRecommendations}>
              {status === 'loading' ? <RefreshCw className="animate-spin" /> : <Search />}
              Load
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-4 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {data.modelVersion ? <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">{data.modelVersion}</span> : null}
          {error ? <span className="text-sm text-warning">{error}</span> : null}
        </div>

        {!hasLiveData ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Live API is connected, but no recommendation evidence was found for this user.
          </div>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lightbulb className="h-4 w-4 text-secondary" />
                <span>{data.userId || userId}</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold">Prioritized mentoring actions</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Recommendations combine blind spots, predicted risks, progress trends, feedback volume, session evidence, and LLM mentoring into one action plan.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric icon={ClipboardList} label="Actions" value={data.recommendations.length} />
              <Metric icon={AlertTriangle} label="High" value={groupedRecommendations.high.length} />
              <Metric icon={Target} label="Medium" value={groupedRecommendations.medium.length} />
              <Metric icon={CheckCircle2} label="Low" value={groupedRecommendations.low.length} />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Priority Action Plan" icon={ClipboardList}>
            <RecommendationList items={data.recommendations} />
          </Panel>

          <Panel title="Evidence Summary" icon={BrainCircuit}>
            <EvidenceSummary data={data} />
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="High Priority" icon={AlertTriangle}>
            <RecommendationList items={groupedRecommendations.high} compact />
          </Panel>
          <Panel title="Medium Priority" icon={Target}>
            <RecommendationList items={groupedRecommendations.medium} compact />
          </Panel>
          <Panel title="Maintenance" icon={CheckCircle2}>
            <RecommendationList items={groupedRecommendations.low} compact />
          </Panel>
        </div>
      </section>
    </main>
  )
}

function buildRecommendations({ aggregate, blindSpots, trends, predictions }) {
  const actions = []

  for (const item of blindSpots?.blind_spots || []) {
    actions.push(
      recommendation(
        item.severity,
        item.skill_area,
        `Review ${labelFor(item.skill_area)} blind spot`,
        item.recommendation,
        item.recommendation,
        `Compare your self-rating with peer or observed evidence for ${labelFor(item.skill_area)}.`,
        'Blind spot detection',
        ['blind_spot_detection']
      )
    )
  }

  for (const item of predictions?.predictions || []) {
    if (item.risk_level === 'low') continue
    actions.push(
      recommendation(
        item.risk_level,
        item.predicted_skill,
        `Reduce ${labelFor(item.predicted_skill)} risk`,
        item.recommendation,
        item.recommendation,
        `Add one targeted ${labelFor(item.predicted_skill)} exercise to the next session.`,
        'Predictive analytics',
        ['predictive_model']
      )
    )
  }

  for (const item of trends?.trends || []) {
    if (item.trend_label !== 'declining') continue
    actions.push(
      recommendation(
        'medium',
        item.skill_area,
        `Reverse ${labelFor(item.skill_area)} decline`,
        item.recommendation,
        item.recommendation,
        `Set one measurable ${labelFor(item.skill_area)} goal before the next role-play.`,
        'Progress trend',
        ['progress_trends']
      )
    )
  }

  const averages = aggregate?.scores?.averages || {}
  const lowScores = [
    ['confidence', averages.confidence_score],
    ['communication_clarity', averages.clarity_score],
    ['empathy', averages.empathy_score],
    ['active_listening', averages.listening_score],
    ['adaptability', averages.adaptability_score],
    ['emotional_control', averages.emotional_control_score],
    ['professionalism', averages.professionalism_score],
  ].filter(([, score]) => Number(score) > 0 && Number(score) < 70)

  for (const [skillArea, score] of lowScores) {
    actions.push(
      recommendation(
        Number(score) < 60 ? 'high' : 'medium',
        skillArea,
        `Practice ${labelFor(skillArea)}`,
        `Average score is ${Math.round(Number(score))}.`,
        `Average score is ${Math.round(Number(score))}. Add one targeted exercise before the next role-play session.`,
        `Complete one focused ${labelFor(skillArea)} drill and request peer feedback.`,
        'Skill twin',
        ['skill_twin_scores']
      )
    )
  }

  const deduped = []
  const seen = new Set()
  for (const item of actions) {
    const key = `${item.priority}-${item.skill_area}-${item.title}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  if (!deduped.length && aggregate?.scores?.metric_count) {
    deduped.push(
      recommendation(
        'low',
        'overall',
        'Maintain current progress',
        'No urgent risk was detected.',
        'Continue practicing at the current difficulty and review post-session feedback after each role-play.',
        'Complete one more role-play session and compare the new scores with this baseline.',
        'Analytics summary',
        ['analytics_summary']
      )
    )
  }

  return deduped.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority)).slice(0, 8)
}

function RecommendationList({ items, compact = false }) {
  if (!items.length) return <EmptyState text="No recommendations yet" />

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className="rounded-lg border border-border bg-background/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{labelFor(item.skill_area)} • {item.source}</p>
            </div>
            <PriorityBadge priority={item.priority} />
          </div>
          {item.reason ? <p className="mt-3 text-sm text-foreground/90">{item.reason}</p> : null}
          <p className={`mt-2 text-sm text-muted-foreground ${compact ? 'line-clamp-3' : ''}`}>{item.detail}</p>
          {item.next_action && !compact ? (
            <div className="mt-3 rounded-md border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Next action: </span>
              {item.next_action}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function EvidenceSummary({ data }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Metric icon={BrainCircuit} label="Sessions" value={data.aggregate?.scores?.metric_count || 0} compact />
      <Metric icon={ClipboardList} label="Feedback" value={data.aggregate?.feedback?.total_count || 0} compact />
      <Metric icon={ShieldAlert} label="Blind Spots" value={data.blindSpots?.summary?.total_count || 0} compact />
      <Metric icon={AlertTriangle} label="High Risk" value={data.predictions?.summary?.high_risk_count || 0} compact />
      <Metric icon={TrendingUp} label="Improving" value={data.trends?.summary?.improving_count || 0} compact />
      <Metric icon={TrendingDown} label="Declining" value={data.trends?.summary?.declining_count || 0} compact />
    </div>
  )
}

function Metric({ icon: Icon, label, value, compact = false }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <Icon className="mb-2 h-4 w-4 text-secondary" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${compact ? 'text-base' : 'text-xl'} mt-1 truncate font-semibold`}>{value}</p>
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

function StatusPill({ status }) {
  const label = status === 'live' ? 'Live API recommendations' : status === 'loading' ? 'Loading recommendations' : 'Demo recommendations'
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
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

function priorityWeight(priority) {
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  if (priority === 'low') return 1
  return 0
}
