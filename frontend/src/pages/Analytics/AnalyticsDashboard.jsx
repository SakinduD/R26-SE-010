import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  LineChart,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import AnalyticsUserBadge from './AnalyticsUserBadge'
import AnalyticsUserField from './AnalyticsUserField'
import { useAnalyticsIdentity } from './analyticsAuth'
import {
  hasPulledComponentData,
  normalizeAdaptivePlan,
  normalizeRpeFeedback,
  normalizeRpeSession,
  normalizeSurveyProfile,
  optionalRequest,
} from './analyticsIntegrationUtils'

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

const DEMO_DATA = {
  aggregate: {
    scores: {
      metric_count: 4,
      averages: {
        confidence_score: 78,
        clarity_score: 74,
        empathy_score: 82,
        listening_score: 76,
        adaptability_score: 71,
        emotional_control_score: 69,
        professionalism_score: 80,
        overall_score: 76,
      },
    },
    feedback: {
      total_count: 7,
      by_type: { self: 3, system: 4 },
      sentiment_counts: { positive: 4, neutral: 2, negative: 1 },
      average_rating: 76,
    },
    predictions: { total_count: 4 },
    data_completeness: {
      has_session_metrics: true,
      has_feedback: true,
      has_predictions: true,
    },
  },
  blindSpots: {
    summary: {
      total_count: 2,
      high_count: 1,
      medium_count: 1,
      low_count: 0,
    },
    blind_spots: [
      {
        skill_area: 'confidence',
        blind_spot_type: 'overestimation',
        severity: 'high',
        self_rating: 92,
        comparison_score: 55,
        comparison_source: 'observed',
        gap: 37,
        confidence: 0.92,
        recommendation: 'Review confidence examples carefully and set one measurable improvement target.',
      },
      {
        skill_area: 'empathy',
        blind_spot_type: 'underestimation',
        severity: 'medium',
        self_rating: 64,
        comparison_score: 90,
        comparison_source: 'observed',
        gap: 26,
        confidence: 0.81,
        recommendation: 'Use positive evidence to build confidence and maintain this behaviour.',
      },
    ],
  },
  trends: {
    summary: {
      improving_count: 3,
      stable_count: 2,
      declining_count: 1,
      insufficient_data_count: 1,
    },
    trends: [
      trend('confidence', 'improving', [55, 65, 78]),
      trend('communication_clarity', 'stable', [72, 73, 74]),
      trend('empathy', 'declining', [90, 82, 70]),
      trend('active_listening', 'improving', [66, 72, 79]),
      trend('professionalism', 'improving', [70, 75, 80]),
    ],
  },
  predictions: {
    summary: {
      predicted_count: 4,
      low_risk_count: 2,
      medium_risk_count: 1,
      high_risk_count: 1,
    },
    predictions: [
      prediction('confidence', 78, 89.5, 'improving', 'low'),
      prediction('empathy', 70, 58, 'declining', 'medium'),
      prediction('emotional_control', 48, 39, 'declining', 'high'),
      prediction('professionalism', 80, 84, 'improving', 'low'),
    ],
  },
}

function trend(skillArea, trendLabel, scores) {
  return {
    skill_area: skillArea,
    trend_label: trendLabel,
    first_score: scores[0],
    latest_score: scores[scores.length - 1],
    delta: scores[scores.length - 1] - scores[0],
    points: scores.map((score, index) => ({
      session_id: `S${index + 1}`,
      score,
      created_at: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00`,
    })),
  }
}

function prediction(skillArea, currentScore, predictedScore, trendLabel, riskLevel) {
  return {
    predicted_skill: skillArea,
    current_score: currentScore,
    predicted_score: predictedScore,
    trend_label: trendLabel,
    risk_level: riskLevel,
    confidence: 0.72,
    recommendation: `${labelFor(skillArea)} should be monitored in the next session.`,
  }
}

function labelFor(value) {
  return SKILL_LABELS[value] || value.replaceAll('_', ' ')
}

export default function AnalyticsDashboard() {
  const {
    userId: connectedUserId,
    userLabel,
    isAuthLoading,
    isAuthenticated,
  } = useAnalyticsIdentity()
  const [userId, setUserId] = useState(connectedUserId)
  const [sessionId, setSessionId] = useState('')
  const [data, setData] = useState(DEMO_DATA)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')
  const [integrationMessage, setIntegrationMessage] = useState('')

  const radarScores = useMemo(() => {
    const averages = data.aggregate?.scores?.averages || {}
    const feedbackAverages =
      data.aggregate?.feedback?.skill_rating_averages ||
      averageFeedbackBySkill(data.aggregate?.feedback?.latest_entries || [])
    return [
      ['confidence', averages.confidence_score ?? feedbackAverages.confidence],
      ['communication_clarity', averages.clarity_score ?? feedbackAverages.communication_clarity],
      ['empathy', averages.empathy_score ?? feedbackAverages.empathy],
      ['active_listening', averages.listening_score ?? feedbackAverages.active_listening],
      ['adaptability', averages.adaptability_score ?? feedbackAverages.adaptability],
      ['emotional_control', averages.emotional_control_score ?? feedbackAverages.emotional_control],
      ['professionalism', averages.professionalism_score ?? feedbackAverages.professionalism],
    ].map(([key, value]) => ({ key, label: labelFor(key), value: Number(value || 0) }))
  }, [data.aggregate])

  const hasLiveData = useMemo(() => {
    if (status !== 'live') return true
    return Boolean(
      data.aggregate?.scores?.metric_count ||
        data.aggregate?.feedback?.total_count ||
        data.blindSpots?.summary?.total_count ||
        data.trends?.trends?.some((item) => item.points?.length > 1) ||
        data.predictions?.predictions?.length
    )
  }, [data, status])

  const loadDashboard = async (nextUserId = userId) => {
    const targetUserId = nextUserId.trim()
    const targetSessionId = sessionId.trim()

    if (!targetUserId) {
      setError('Enter a user id')
      return
    }

    setStatus('loading')
    setError('')
    setIntegrationMessage('')

    try {
      if (targetSessionId) {
        const integrationResult = await pullAndSaveComponentData(targetUserId, targetSessionId)
        if (integrationResult.integrated) {
          setIntegrationMessage('Real component data pulled and saved into analytics for this session.')
        } else if (integrationResult.checked) {
          setIntegrationMessage('No component session data was found yet for this session ID.')
        }
      }

      const [aggregate, blindSpots, trends, predictions, sessionScores] = await Promise.all([
        analyticsService.getAggregateByUser(targetUserId),
        analyticsService.getBlindSpotsByUser(targetUserId),
        analyticsService.getProgressTrendsByUser(targetUserId),
        analyticsService.getPredictedOutcomesByUser(targetUserId),
        targetSessionId ? analyticsService.getSkillScoresBySession(targetSessionId) : Promise.resolve(null),
      ])

      setData({
        aggregate: sessionScores ? mergeSessionScores(aggregate, sessionScores) : aggregate,
        blindSpots,
        trends,
        predictions,
      })
      setStatus('live')
    } catch (err) {
      setData(DEMO_DATA)
      setStatus('demo')
      setError('Backend data unavailable. Showing demo analytics.')
    }
  }

  const pullAndSaveComponentData = async (targetUserId, targetSessionId) => {
    const [surveyProfile, adaptivePlan, rpeSession, rpeFeedback] = await Promise.all([
      optionalRequest(() => analyticsService.getComponentSurveyProfile()),
      optionalRequest(() => analyticsService.getComponentAdaptivePlan()),
      optionalRequest(() => analyticsService.getComponentRpeSession(targetSessionId)),
      optionalRequest(() => analyticsService.getComponentRpeFeedback(targetSessionId)),
    ])

    const sources = { surveyProfile, adaptivePlan, rpeSession, rpeFeedback }
    if (!hasPulledComponentData(sources)) {
      return { checked: true, integrated: false }
    }

    const scenarioId =
      rpeSession.data?.scenario_id ||
      rpeFeedback.data?.scenario_id ||
      adaptivePlan.data?.primary_scenario ||
      adaptivePlan.data?.selected_scenario_id ||
      adaptivePlan.data?.scenario_id

    const skillType =
      adaptivePlan.data?.skill ||
      rpeFeedback.data?.skill_type ||
      rpeSession.data?.skill_type ||
      'communication'

    await analyticsService.integrateCompletedSession({
      user_id: targetUserId,
      session_id: targetSessionId,
      scenario_id: scenarioId || undefined,
      skill_type: skillType,
      survey_profile: normalizeSurveyProfile(surveyProfile.data),
      adaptive_plan: normalizeAdaptivePlan(adaptivePlan.data),
      rpe_session: normalizeRpeSession(rpeSession.data),
      rpe_feedback: normalizeRpeFeedback(rpeFeedback.data),
      mca_nudges: [],
    })

    return { checked: true, integrated: true }
  }

  useEffect(() => {
    setUserId(connectedUserId)
  }, [connectedUserId])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) {
      loadDashboard(connectedUserId)
    }
  }, [connectedUserId, isAuthLoading, isAuthenticated])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
            <h1 className="mt-1 text-2xl font-semibold">Analytics Dashboard</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <AnalyticsNav />
            <AnalyticsUserField
              userId={userId}
              userLabel={userLabel}
              isAuthenticated={isAuthenticated}
              onChange={setUserId}
            />
            <Input label="Session" value={sessionId} onChange={setSessionId} placeholder="optional" />
            <Button className="h-10 self-end" onClick={() => loadDashboard()}>
              {status === 'loading' ? <RefreshCw className="animate-spin" /> : <Search />}
              Load
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-4 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          <AnalyticsUserBadge isAuthenticated={isAuthenticated} userLabel={userLabel} />
          {error ? <span className="text-sm text-warning">{error}</span> : null}
          {integrationMessage ? <span className="text-sm text-secondary">{integrationMessage}</span> : null}
        </div>
        {!hasLiveData ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Live API is connected, but no analytics records were found for this user. Add session metrics,
            self feedback, component performance evidence, and predictions for this user.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            icon={Activity}
            label="Sessions"
            value={
              data.aggregate?.scores?.metric_count ||
              data.aggregate?.feedback?.session_count ||
              countFeedbackSessions(data.aggregate?.feedback?.latest_entries || []) ||
              0
            }
          />
          <MetricTile icon={Target} label="Avg Rating" value={formatScore(data.aggregate?.feedback?.average_rating)} />
          <MetricTile icon={ShieldAlert} label="Blind Spots" value={data.blindSpots?.summary?.total_count || 0} />
          <MetricTile icon={BrainCircuit} label="High Risk" value={data.predictions?.summary?.high_risk_count || 0} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <Panel title="Skill Twin" icon={BarChart3}>
            <SkillTwinRadar scores={radarScores} />
          </Panel>

          <Panel title="Prediction Risk" icon={BrainCircuit}>
            <RiskList predictions={data.predictions?.predictions || []} />
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Progress Trends" icon={LineChart}>
            <ProgressTrendVisualization trends={data.trends?.trends || []} labelFor={labelFor} />
          </Panel>

          <Panel title="Blind Spot Detection" icon={AlertTriangle}>
            <BlindSpotList blindSpots={data.blindSpots?.blind_spots || []} />
          </Panel>
        </div>
      </section>
    </main>
  )
}

function mergeSessionScores(aggregate, sessionScores) {
  const scores = sessionScores?.skill_scores || {}
  return {
    ...aggregate,
    scores: {
      ...(aggregate?.scores || {}),
      averages: {
        ...(aggregate?.scores?.averages || {}),
        confidence_score: scores.confidence,
        clarity_score: scores.communication_clarity,
        empathy_score: scores.empathy,
        listening_score: scores.active_listening,
        adaptability_score: scores.adaptability,
        emotional_control_score: scores.emotional_control,
        professionalism_score: scores.professionalism,
        overall_score: sessionScores.overall_score,
      },
    },
  }
}

function averageFeedbackBySkill(entries) {
  const grouped = entries.reduce((acc, entry) => {
    if (!entry.skill_area || entry.rating === null || entry.rating === undefined) return acc
    const key = entry.skill_area
    acc[key] = acc[key] || []
    acc[key].push(Number(entry.rating))
    return acc
  }, {})

  return Object.fromEntries(
    Object.entries(grouped).map(([skill, ratings]) => [
      skill,
      ratings.reduce((total, rating) => total + rating, 0) / ratings.length,
    ])
  )
}

function countFeedbackSessions(entries) {
  return new Set(entries.map((entry) => entry.session_id).filter(Boolean)).size
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function StatusPill({ status }) {
  const label = status === 'live' ? 'Live API data' : status === 'loading' ? 'Loading analytics' : 'Demo data'
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function MetricTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Icon className="mb-3 h-4 w-4 text-secondary" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
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

function RiskList({ predictions }) {
  if (!predictions.length) return <EmptyState text="No predictions yet" />

  return (
    <div className="space-y-3">
      {predictions.slice(0, 5).map((item) => (
        <div key={item.predicted_skill} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelFor(item.predicted_skill)}</span>
            <RiskBadge risk={item.risk_level} />
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

function BlindSpotList({ blindSpots }) {
  if (!blindSpots.length) return <EmptyState text="No blind spots detected" />

  return (
    <div className="space-y-3">
      {blindSpots.map((item) => (
        <div key={item.skill_area} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelFor(item.skill_area)}</span>
            <SeverityBadge severity={item.severity} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.blind_spot_type} gap of {item.gap} against {item.comparison_source}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{item.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function RiskBadge({ risk }) {
  const className = risk === 'high' ? 'bg-destructive/20 text-destructive' : risk === 'medium' ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success'
  return <span className={`rounded-full px-2 py-1 text-xs ${className}`}>{risk}</span>
}

function SeverityBadge({ severity }) {
  const className = severity === 'high' ? 'bg-destructive/20 text-destructive' : severity === 'medium' ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground'
  return <span className={`rounded-full px-2 py-1 text-xs ${className}`}>{severity}</span>
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{text}</div>
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}
