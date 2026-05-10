import React, { useEffect, useMemo, useRef, useState } from 'react'
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

// 4 composite skills matching the real system pipeline:
//   Vocal Command         → speech_volume_score
//   Speech Fluency        → speech_pace_score + clarity_score
//   Presence & Engagement → eye_contact_score + confidence_score
//   Emotional Intelligence→ empathy_score + emotional_control_score
const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
  // raw sub-skill aliases → composite display label
  speech_volume: 'Vocal Command',
  speech_volume_score: 'Vocal Command',
  professionalism: 'Vocal Command',
  professionalism_score: 'Vocal Command',
  speech_pace: 'Speech Fluency',
  speech_pace_score: 'Speech Fluency',
  communication_clarity: 'Speech Fluency',
  clarity: 'Speech Fluency',
  clarity_score: 'Speech Fluency',
  eye_contact: 'Presence & Engagement',
  eye_contact_score: 'Presence & Engagement',
  confidence: 'Presence & Engagement',
  confidence_score: 'Presence & Engagement',
  adaptability: 'Presence & Engagement',
  adaptability_score: 'Presence & Engagement',
  empathy: 'Emotional Intelligence',
  empathy_score: 'Emotional Intelligence',
  emotional_control: 'Emotional Intelligence',
  emotional_control_score: 'Emotional Intelligence',
  active_listening: 'Emotional Intelligence',
  listening_score: 'Emotional Intelligence',
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replace(/_/g, ' ') || 'Unknown'
}

function toScoreValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Average of all provided values that are valid numbers
function avgOf(...vals) {
  const nums = vals.map(v => toScoreValue(v)).filter(n => n !== null)
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null
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
      ratings.reduce((total, r) => total + r, 0) / ratings.length,
    ])
  )
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}

// Demo data using the 4 composite skills
const DEMO_PROFILE = {
  aggregate: {
    scores: {
      metric_count: 5,
      averages: {
        speech_volume_score: 74,
        speech_pace_score: 70,
        clarity_score: 78,
        eye_contact_score: 82,
        confidence_score: 80,
        empathy_score: 84,
        emotional_control_score: 67,
        overall_score: 76,
      },
    },
    feedback: {
      total_count: 9,
      average_rating: 76,
      by_type: { self: 4, system: 5 },
      skill_rating_averages: {},
      latest_entries: [],
    },
    predictions: { total_count: 4 },
  },
  trends: {
    summary: { improving_count: 2, stable_count: 1, declining_count: 1, insufficient_data_count: 0 },
    trends: [
      mkTrend('vocal_command', 'improving', [60, 67, 74]),
      mkTrend('speech_fluency', 'stable', [73, 74, 74]),
      mkTrend('presence_engagement', 'improving', [70, 77, 81]),
      mkTrend('emotional_intelligence', 'declining', [80, 74, 69]),
    ],
  },
  predictions: {
    summary: { predicted_count: 4, low_risk_count: 2, medium_risk_count: 1, high_risk_count: 1 },
    predictions: [
      mkPred('emotional_intelligence', 69, 61, 'declining', 'high'),
      mkPred('vocal_command', 74, 80, 'improving', 'low'),
      mkPred('presence_engagement', 81, 86, 'improving', 'low'),
      mkPred('speech_fluency', 74, 70, 'declining', 'medium'),
    ],
  },
  blindSpots: {
    summary: { total_count: 1, high_count: 0, medium_count: 1, low_count: 0 },
    blind_spots: [
      {
        skill_area: 'emotional_control',
        blind_spot_type: 'overestimation',
        severity: 'medium',
        gap: 22,
        self_rating: 89,
        recommendation: 'Compare your self-rating with observed pacing and tone before the next session.',
      },
    ],
  },
}

function mkTrend(skillArea, trendLabel, scores) {
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

function mkPred(skillArea, currentScore, predictedScore, trendLabel, riskLevel) {
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
  // Tracks whether the first real load has completed so session-change
  // auto-reload doesn't fire before initial data is ready.
  const hasLoadedOnce = useRef(false)

  // ── Composite observed scores ────────────────────────────────────────────
  // Priority chain per skill:
  //   1. Session/user aggregate composite (session-specific when session selected)
  //   2. Feedback rating average (bare key OR _score suffix both checked)
  // Trend latest_score is NOT used here — it is cross-session and broken when
  // all analytics metrics share a recent created_at due to the upsert pattern.
  const radarScores = useMemo(() => {
    const a = profile.aggregate?.scores?.averages || {}
    const f = profile.aggregate?.feedback?.skill_rating_averages ||
              averageFeedbackBySkill(profile.aggregate?.feedback?.latest_entries || [])

    return [
      {
        key: 'vocal_command',
        label: 'Vocal Command',
        value: toScoreValue(a.speech_volume_score ?? a.professionalism_score) ??
               toScoreValue(f.vocal_command ?? f.speech_volume ?? f.speech_volume_score ??
                            f.professionalism ?? f.professionalism_score),
      },
      {
        key: 'speech_fluency',
        label: 'Speech Fluency',
        value: avgOf(a.speech_pace_score, a.clarity_score) ??
               toScoreValue(f.speech_fluency ?? f.speech_pace ?? f.speech_pace_score ??
                            f.clarity ?? f.clarity_score),
      },
      {
        key: 'presence_engagement',
        label: 'Presence & Engagement',
        value: avgOf(a.eye_contact_score, a.confidence_score) ??
               toScoreValue(a.adaptability_score) ??
               toScoreValue(f.presence_engagement ?? f.eye_contact ?? f.eye_contact_score ??
                            f.confidence ?? f.confidence_score),
      },
      {
        key: 'emotional_intelligence',
        label: 'Emotional Intelligence',
        value: avgOf(a.empathy_score, a.emotional_control_score) ??
               toScoreValue(a.listening_score) ??
               toScoreValue(f.emotional_intelligence ?? f.empathy ?? f.empathy_score ??
                            f.emotional_control ?? f.emotional_control_score),
      },
    ]
  }, [profile])

  // ── Self-rating composite scores (self-only feedback, then blind spot self_rating) ──
  const selfScores = useMemo(() => {
    // Prefer self_rating_averages (only feedback_type='self' entries) so amber layer
    // shows what the user actually rated themselves, not blended system+self averages.
    const selfEntries = (profile.aggregate?.feedback?.latest_entries || [])
      .filter(e => e.feedback_type === 'self')
    const f = Object.keys(profile.aggregate?.feedback?.self_rating_averages || {}).length > 0
      ? profile.aggregate.feedback.self_rating_averages
      : selfEntries.length > 0
        ? averageFeedbackBySkill(selfEntries)
        : {}
    const b = profile.blindSpots?.blind_spots || []

    const selfFromBlindSpot = (compositeLabel) => {
      const spot = b.find(x => SKILL_LABELS[x.skill_area] === compositeLabel)
      return toScoreValue(spot?.self_rating)
    }

    // DB skill_area values may be stored without the _score suffix (e.g. "speech_volume"
    // not "speech_volume_score"), so check both variants.
    return [
      {
        key: 'vocal_command',
        label: 'Vocal Command',
        value: toScoreValue(
          f.vocal_command ?? f.speech_volume ?? f.speech_volume_score ??
          f.professionalism ?? f.professionalism_score
        ) ?? selfFromBlindSpot('Vocal Command'),
      },
      {
        key: 'speech_fluency',
        label: 'Speech Fluency',
        value: toScoreValue(
          f.speech_fluency ?? f.speech_pace ?? f.speech_pace_score ??
          f.clarity ?? f.clarity_score
        ) ?? selfFromBlindSpot('Speech Fluency'),
      },
      {
        key: 'presence_engagement',
        label: 'Presence & Engagement',
        value: toScoreValue(
          f.presence_engagement ?? f.eye_contact ?? f.eye_contact_score ??
          f.confidence ?? f.confidence_score
        ) ?? selfFromBlindSpot('Presence & Engagement'),
      },
      {
        key: 'emotional_intelligence',
        label: 'Emotional Intelligence',
        value: toScoreValue(
          f.emotional_intelligence ?? f.empathy ?? f.empathy_score ??
          f.emotional_control ?? f.emotional_control_score
        ) ?? selfFromBlindSpot('Emotional Intelligence'),
      },
    ].filter(item => item.value !== null)
  }, [profile])

  const overallScore = useMemo(() => {
    // Prefer session aggregate overall_score (session-specific);
    // trend latest_score is cross-session and unreliable when cutoff timestamps are stale.
    return toScoreValue(profile.aggregate?.scores?.averages?.overall_score) ??
           toScoreValue(profile.aggregate?.feedback?.average_rating) ??
           toScoreValue((profile.trends?.trends || []).find(t => t.skill_area === 'overall')?.latest_score)
  }, [profile])

  // Use the highest session_count across all trend lines as the real session count,
  // falling back to metric_count (which counts DB rows, not unique sessions).
  const sessionCount = useMemo(() => {
    const trendCounts = (profile.trends?.trends || []).map(t => t.session_count || 0)
    const maxTrend = trendCounts.length ? Math.max(...trendCounts) : 0
    return maxTrend || profile.aggregate?.scores?.metric_count || 0
  }, [profile])

  const measuredScores = useMemo(() => radarScores.filter(item => item.value !== null), [radarScores])
  const missingScores  = useMemo(() => radarScores.filter(item => item.value === null), [radarScores])
  const strengths      = useMemo(() => measuredScores.filter(item => item.value >= 80).sort((a, b) => b.value - a.value), [measuredScores])
  const growthAreas    = useMemo(() => measuredScores.filter(item => item.value < 72).sort((a, b) => a.value - b.value), [measuredScores])

  const hasLiveData = useMemo(() => {
    if (status !== 'live') return true
    return Boolean(
      profile.aggregate?.scores?.metric_count ||
      profile.aggregate?.feedback?.total_count ||
      profile.trends?.trends?.some(item => item.points?.length > 1) ||
      profile.predictions?.predictions?.length ||
      profile.blindSpots?.summary?.total_count
    )
  }, [profile, status])

  // ── Data loading ─────────────────────────────────────────────────────────
  const loadProfile = async (nextUserId = userId, nextSessionId = sessionId) => {
    const targetUserId    = nextUserId.trim()
    const targetSessionId = nextSessionId.trim()

    if (!targetUserId) { setError('Enter a user id'); return }

    setStatus('loading')
    setError('')
    setIntegrationMessage('')

    try {
      // Trigger component data integration first if a session is selected
      if (targetSessionId) {
        const integrationResult = await pullAndSaveComponentData(targetUserId, targetSessionId)
        if (integrationResult.integrated)
          setIntegrationMessage('Real component data pulled and saved into analytics for this session.')
        else if (integrationResult.checked)
          setIntegrationMessage('No component session data was found yet for this session ID.')
      }

      // When a session is selected use its aggregate (has all sub-skill columns);
      // otherwise fall back to the user-level aggregate.
      const [userAggregate, sessionAggregate, trends, predictions, blindSpots] = await Promise.all([
        analyticsService.getAggregateByUser(targetUserId),
        targetSessionId
          ? analyticsService.getAggregateBySession(targetSessionId).catch(() => null)
          : Promise.resolve(null),
        analyticsService.getProgressTrendsByUser(
          targetUserId,
          targetSessionId ? { session_id: targetSessionId } : {}
        ),
        analyticsService.getPredictedOutcomesByUser(
          targetUserId,
          targetSessionId ? { session_id: targetSessionId } : {}
        ),
        targetSessionId
          ? analyticsService.getBlindSpotsBySession(targetSessionId).catch(() =>
              analyticsService.getBlindSpotsByUser(targetUserId)
            )
          : analyticsService.getBlindSpotsByUser(targetUserId),
      ])

      setProfile({
        aggregate: sessionAggregate || userAggregate,
        trends,
        predictions,
        blindSpots,
      })
      setError('')
      setStatus('live')
      hasLoadedOnce.current = true
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
    const mcaNudges  = normalizeMcaSessionNudges(mcaSession)
    const sources = {
      surveyProfile,
      adaptivePlan,
      rpeSession,
      rpeFeedback,
      mcaNudges: { ok: mcaNudges.length > 0, data: mcaNudges },
    }

    if (!hasPulledComponentData(sources)) return { checked: true, integrated: false }

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
    if (preferred) setSessionId(current => current || preferred.id)
    return preferred
  }

  useEffect(() => { setUserId(connectedUserId) }, [connectedUserId])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) {
      loadSessionOptions()
        .then(preferred => loadProfile(connectedUserId, preferred?.id || ''))
        .catch(() => loadProfile(connectedUserId, ''))
    }
  }, [connectedUserId, isAuthLoading, isAuthenticated])

  // Auto-reload whenever the user picks a different session from the dropdown.
  // Skipped during initial mount (hasLoadedOnce guards against double-fetch).
  useEffect(() => {
    if (!hasLoadedOnce.current) return
    if (!userId || !isAuthenticated) return
    loadProfile(userId, sessionId)
  }, [sessionId])

  // ── Render ────────────────────────────────────────────────────────────────
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
          {error && status !== 'live' ? <span className="text-sm text-warning">{error}</span> : null}
          {integrationMessage ? <span className="text-sm text-secondary">{integrationMessage}</span> : null}
        </div>

        {!hasLiveData && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Live API is connected, but no skill twin records were found for this user.
          </div>
        )}

        {/* Profile header */}
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserCircle className="h-4 w-4 text-secondary" />
                <span>{isAuthenticated ? userLabel : userId}</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold">Long-term soft skill profile</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                The skill twin combines observed session metrics, self feedback, system evidence, blind spots, and
                predicted outcomes. Skills with no real evidence yet are shown as N/A.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
              <Metric icon={Activity}    label="Sessions"    value={sessionCount} />
              <Metric icon={Target}      label="Overall"     value={formatScore(overallScore)} />
              <Metric icon={TrendingUp}  label="Improving"   value={profile.trends?.summary?.improving_count || 0} />
              <Metric icon={ShieldAlert} label="Blind Spots" value={profile.blindSpots?.summary?.total_count || 0} />
            </div>
          </div>
        </section>

        {/* Radar + Profile Summary */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Skill Twin Radar" icon={Target}>
            {selfScores.length > 0 && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                Teal = Observed scores · Amber = Your self-rating
              </p>
            )}
            <SkillTwinRadar
              scores={radarScores}
              selfScores={selfScores}
              overallScore={overallScore}
            />
          </Panel>

          <Panel title="Profile Summary" icon={BrainCircuit}>
            <SkillGroup title="Strengths"    items={strengths}   emptyText="No clear strengths yet" />
            <div className="mt-4">
              <SkillGroup title="Growth Areas" items={growthAreas} emptyText="No growth areas detected yet" />
            </div>
            <div className="mt-4">
              <EvidenceGapList items={missingScores} />
            </div>
          </Panel>
        </div>

        {/* Progress + Predictions */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Progress History" icon={TrendingUp}>
            <ProgressTrendVisualization trends={profile.trends?.trends || []} labelFor={labelFor} />
          </Panel>
          <Panel title="Predictive Risks" icon={AlertTriangle}>
            <PredictionList predictions={profile.predictions?.predictions || []} />
          </Panel>
        </div>

        {/* Blind Spots */}
        <Panel title="Blind Spot Notes" icon={ShieldAlert}>
          <BlindSpotList blindSpots={profile.blindSpots?.blind_spots || []} />
        </Panel>
      </section>
    </main>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SessionSelect({ value, options, onChange }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>Session</span>
      <select
        className="h-10 min-w-[220px] rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {!options.length && <option value="">No session yet</option>}
        {options.map(option => (
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
          {items.slice(0, 4).map(item => (
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
        {items.slice(0, 4).map(item => (
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
      {predictions.slice(0, 5).map((item, i) => (
        <div key={`${item.predicted_skill}-${i}`} className="rounded-md border border-border p-3">
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
      {blindSpots.map((item, i) => (
        <div key={`${item.skill_area}-${i}`} className="rounded-md border border-border p-3">
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
    risk === 'high'   ? 'bg-destructive/20 text-destructive' :
    risk === 'medium' ? 'bg-warning/20 text-warning' :
                        'bg-success/20 text-success'
  return <span className={`rounded-full px-2 py-1 text-xs ${className}`}>{risk}</span>
}

function EmptyState({ text }) {
  return (
    <div className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
