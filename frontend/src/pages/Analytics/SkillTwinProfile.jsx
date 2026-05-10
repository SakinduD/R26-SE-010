import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  TrendingUp,
  UserCircle,
} from 'lucide-react'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
// REDESIGN: AnalyticsNav removed — sidebar Progress section now handles navigation
import AnalyticsUserBadge from './AnalyticsUserBadge'
import { useAnalyticsIdentity } from './analyticsAuth'
import {
  hasPulledComponentData,
  normalizeAdaptivePlan,
  normalizeComponentSessionOptions,
  normalizeMcaNudges,
  normalizeMcaSessionNudges,
  normalizeRpeFeedback,
  normalizeRpeSession,
  normalizeSurveyProfile,
  optionalRequest,
  selectMcaSession,
  selectPreferredComponentSession,
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

const DEMO_PROFILE = {
  aggregate: {
    scores: {
      metric_count: 5,
      averages: {
        confidence_score: 74,
        clarity_score: 78,
        empathy_score: 84,
        listening_score: 81,
        adaptability_score: 72,
        emotional_control_score: 67,
        professionalism_score: 86,
        overall_score: 78,
      },
    },
    feedback: {
      total_count: 9,
      average_rating: 79,
      by_type: { self: 4, system: 5 },
    },
    predictions: { total_count: 4 },
  },
  trends: {
    summary: {
      improving_count: 3,
      stable_count: 2,
      declining_count: 1,
      insufficient_data_count: 1,
    },
    trends: [
      trend('confidence', 'improving', [58, 66, 74]),
      trend('communication_clarity', 'stable', [76, 77, 78]),
      trend('empathy', 'improving', [72, 80, 84]),
      trend('active_listening', 'improving', [70, 76, 81]),
      trend('emotional_control', 'declining', [78, 72, 67]),
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
      prediction('emotional_control', 67, 59, 'declining', 'high'),
      prediction('confidence', 74, 82, 'improving', 'low'),
      prediction('empathy', 84, 88, 'improving', 'low'),
    ],
  },
  blindSpots: {
    summary: {
      total_count: 1,
      high_count: 0,
      medium_count: 1,
      low_count: 0,
    },
    blind_spots: [
      {
        skill_area: 'emotional_control',
        blind_spot_type: 'overestimation',
        severity: 'medium',
        gap: 22,
        recommendation: 'Compare your self-rating with observed pacing and tone before the next session.',
      },
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
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

function toScoreValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function averageFeedbackBySkill(entries) {
  const grouped = entries.reduce((acc, entry) => {
    if (!entry.skill_area || entry.rating === null || entry.rating === undefined) return acc
    acc[entry.skill_area] = acc[entry.skill_area] || []
    acc[entry.skill_area].push(Number(entry.rating))
    return acc
  }, {})

  return Object.fromEntries(
    Object.entries(grouped).map(([skill, ratings]) => [
      skill,
      ratings.reduce((total, rating) => total + rating, 0) / ratings.length,
    ])
  )
}

export default function SkillTwinProfile() {
  const params = useParams()
  const {
    userId: connectedUserId,
    userLabel,
    isAuthLoading,
    isAuthenticated,
  } = useAnalyticsIdentity(params.userId)
  const [userId, setUserId] = useState(connectedUserId)
  const [sessionId, setSessionId] = useState('')
  const [sessionOptions, setSessionOptions] = useState([])
  const [profile, setProfile] = useState(DEMO_PROFILE)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')
  const [integrationMessage, setIntegrationMessage] = useState('')

  const radarScores = useMemo(() => {
    const averages = profile.aggregate?.scores?.averages || {}
    const feedbackAverages =
      profile.aggregate?.feedback?.skill_rating_averages ||
      averageFeedbackBySkill(profile.aggregate?.feedback?.latest_entries || [])

    return [
      ['confidence', averages.confidence_score ?? feedbackAverages.confidence],
      ['communication_clarity', averages.clarity_score ?? feedbackAverages.communication_clarity],
      ['empathy', averages.empathy_score ?? feedbackAverages.empathy],
      ['active_listening', averages.listening_score ?? feedbackAverages.active_listening],
      ['adaptability', averages.adaptability_score ?? feedbackAverages.adaptability],
      ['emotional_control', averages.emotional_control_score ?? feedbackAverages.emotional_control],
      ['professionalism', averages.professionalism_score ?? feedbackAverages.professionalism],
    ].map(([key, value]) => ({ key, label: labelFor(key), value: toScoreValue(value) }))
  }, [profile])

  const measuredScores = useMemo(
    () => radarScores.filter((item) => item.value !== null),
    [radarScores]
  )

  const missingScores = useMemo(
    () => radarScores.filter((item) => item.value === null),
    [radarScores]
  )

  const strengths = useMemo(
    () => measuredScores.filter((item) => item.value >= 80).sort((a, b) => b.value - a.value),
    [measuredScores]
  )

  const growthAreas = useMemo(
    () => measuredScores.filter((item) => item.value < 72).sort((a, b) => a.value - b.value),
    [measuredScores]
  )

  const hasLiveData = useMemo(() => {
    if (status !== 'live') return true
    return Boolean(
      profile.aggregate?.scores?.metric_count ||
        profile.aggregate?.feedback?.total_count ||
        profile.trends?.trends?.some((item) => item.points?.length > 1) ||
        profile.predictions?.predictions?.length ||
        profile.blindSpots?.summary?.total_count
    )
  }, [profile, status])

  const loadProfile = async (nextUserId = userId, nextSessionId = sessionId) => {
    const targetUserId = nextUserId.trim()
    const targetSessionId = nextSessionId.trim()

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

      const [aggregate, trends, predictions, blindSpots, sessionScores] = await Promise.all([
        analyticsService.getAggregateByUser(targetUserId),
        analyticsService.getProgressTrendsByUser(targetUserId),
        analyticsService.getPredictedOutcomesByUser(targetUserId),
        analyticsService.getBlindSpotsByUser(targetUserId),
        targetSessionId ? analyticsService.getSkillScoresBySession(targetSessionId) : Promise.resolve(null),
      ])
      setProfile({
        aggregate: sessionScores ? mergeSessionScores(aggregate, sessionScores) : aggregate,
        trends,
        predictions,
        blindSpots,
      })
      setStatus('live')
    } catch (err) {
      setProfile(DEMO_PROFILE)
      setStatus('demo')
      setError('Backend profile unavailable. Showing demo skill twin.')
    }
  }

  const pullAndSaveComponentData = async (targetUserId, targetSessionId) => {
    const [surveyProfile, adaptivePlan, rpeSession, rpeFeedback, mcaSessions] = await Promise.all([
      optionalRequest(() => analyticsService.getComponentSurveyProfile()),
      optionalRequest(() => analyticsService.getComponentAdaptivePlan()),
      optionalRequest(() => analyticsService.getComponentRpeSession(targetSessionId)),
      optionalRequest(() => analyticsService.getComponentRpeFeedback(targetSessionId)),
      optionalRequest(() => analyticsService.getComponentMcaSessions()),
    ])

    const mcaSession = selectMcaSession(mcaSessions.data, targetSessionId)
    const mcaNudges = normalizeMcaSessionNudges(mcaSession)
    const sources = {
      surveyProfile,
      adaptivePlan,
      rpeSession,
      rpeFeedback,
      mcaNudges: { ok: mcaNudges.length > 0, data: mcaNudges },
    }

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
      mca_nudges: normalizeMcaNudges(mcaNudges),
    })

    return { checked: true, integrated: true }
  }

  const loadSessionOptions = async () => {
    const [rpeSessions, mcaSessions] = await Promise.all([
      optionalRequest(() => analyticsService.getComponentRpeSessions()),
      optionalRequest(() => analyticsService.getComponentMcaSessions()),
    ])

    const options = normalizeComponentSessionOptions(rpeSessions.data, mcaSessions.data)
    setSessionOptions(options)

    const preferred = selectPreferredComponentSession(options)
    if (preferred) {
      setSessionId((current) => current || preferred.id)
    }
    return preferred
  }

  useEffect(() => {
    setUserId(connectedUserId)
  }, [connectedUserId])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) {
      loadSessionOptions()
        .then((preferred) => loadProfile(connectedUserId, preferred?.id || ''))
        .catch(() => loadProfile(connectedUserId, ''))
    }
  }, [connectedUserId, isAuthLoading, isAuthenticated])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
            <h1 className="mt-1 text-2xl font-semibold">Skill Twin Profile</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SessionSelect
              value={sessionId}
              options={sessionOptions}
              onChange={setSessionId}
            />
            <Button className="h-10 self-end" onClick={() => loadProfile(userId, sessionId)}>
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
            Live API is connected, but no skill twin records were found for this user.
          </div>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserCircle className="h-4 w-4 text-secondary" />
                <span>{isAuthenticated ? userLabel : userId}</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold">Long-term soft skill profile</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                The skill twin combines observed session metrics, self feedback, system evidence, blind spots, and predicted outcomes. Skills with no real evidence yet are shown as N/A instead of fake zero scores.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
              <Metric icon={Activity} label="Sessions" value={profile.aggregate?.scores?.metric_count || 0} />
              <Metric icon={Target} label="Overall" value={formatScore(profile.aggregate?.scores?.averages?.overall_score)} />
              <Metric icon={TrendingUp} label="Improving" value={profile.trends?.summary?.improving_count || 0} />
              <Metric icon={ShieldAlert} label="Blind Spots" value={profile.blindSpots?.summary?.total_count || 0} />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Skill Twin Radar" icon={Target}>
            <SkillTwinRadar scores={radarScores} />
          </Panel>

          <Panel title="Profile Summary" icon={BrainCircuit}>
            <SkillGroup title="Strengths" items={strengths} emptyText="No clear strengths yet" />
            <div className="mt-4">
              <SkillGroup title="Growth Areas" items={growthAreas} emptyText="No growth areas detected yet" />
            </div>
            <div className="mt-4">
              <EvidenceGapList items={missingScores} />
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Progress History" icon={TrendingUp}>
            <ProgressTrendVisualization trends={profile.trends?.trends || []} labelFor={labelFor} />
          </Panel>

          <Panel title="Predictive Risks" icon={AlertTriangle}>
            <PredictionList predictions={profile.predictions?.predictions || []} />
          </Panel>
        </div>

        <Panel title="Blind Spot Notes" icon={ShieldAlert}>
          <BlindSpotList blindSpots={profile.blindSpots?.blind_spots || []} />
        </Panel>
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

function SessionSelect({ value, options, onChange }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>Session</span>
      <select
        className="h-10 min-w-[220px] rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.length ? null : <option value="">No session yet</option>}
        {options.map((option) => (
          <option key={`${option.source}-${option.id}`} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function StatusPill({ status }) {
  const label = status === 'live' ? 'Live API profile' : status === 'loading' ? 'Loading profile' : 'Demo profile'
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <Icon className="mb-2 h-4 w-4 text-secondary" />
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

function SkillGroup({ title, items, emptyText }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {items.length ? (
        <div className="space-y-2">
          {items.slice(0, 4).map((item) => (
            <div key={item.key} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <span>{item.label}</span>
              <span className="font-semibold">{formatScore(item.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}
    </div>
  )
}

function EvidenceGapList({ items }) {
  if (!items.length) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Needs Evidence</h3>
      <div className="space-y-2">
        {items.slice(0, 4).map((item) => (
          <div key={item.key} className="flex items-center justify-between rounded-md border border-dashed border-border p-3 text-sm">
            <span>{item.label}</span>
            <span className="text-xs text-muted-foreground">No session data yet</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PredictionList({ predictions }) {
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
    <div className="grid gap-3 md:grid-cols-2">
      {blindSpots.map((item) => (
        <div key={item.skill_area} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{labelFor(item.skill_area)}</span>
            <RiskBadge risk={item.severity} />
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

function RiskBadge({ risk }) {
  const className =
    risk === 'high'
      ? 'bg-destructive/20 text-destructive'
      : risk === 'medium'
        ? 'bg-warning/20 text-warning'
        : 'bg-success/20 text-success'
  return <span className={`rounded-full px-2 py-1 text-xs ${className}`}>{risk}</span>
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{text}</div>
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}
