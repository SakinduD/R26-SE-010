import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Gauge,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import AnalyticsUserBadge from './AnalyticsUserBadge'
import { useAnalyticsIdentity } from './analyticsAuth'

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

const SKILL_OPTIONS = Object.entries(SKILL_LABELS).map(([value, label]) => ({ value, label }))

const DEMO_DATA = {
  user_id: 'demo-user',
  predictions: [
    prediction('emotional_control', 48, 39, 'declining', 'high', 0.78, 3),
    prediction('empathy', 70, 58, 'declining', 'medium', 0.72, 3),
    prediction('confidence', 78, 90, 'improving', 'low', 0.65, 3),
    prediction('professionalism', 80, 84, 'improving', 'low', 0.61, 2),
  ],
  summary: {
    predicted_count: 4,
    low_risk_count: 2,
    medium_risk_count: 1,
    high_risk_count: 1,
    highest_risk_prediction: prediction('emotional_control', 48, 39, 'declining', 'high', 0.78, 3),
  },
  generated_at: '2026-05-03T00:00:00',
  model_version: 'ml-predictive-behavioral-analytics-v1',
}

function prediction(skillArea, currentScore, predictedScore, trendLabel, riskLevel, confidence, evidencePoints) {
  return {
    predicted_skill: skillArea,
    current_score: currentScore,
    predicted_score: predictedScore,
    trend_label: trendLabel,
    risk_level: riskLevel,
    confidence,
    evidence_points: evidencePoints,
    recommendation: `${labelFor(skillArea)} should be reviewed before the next session.`,
  }
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function PredictiveAnalytics() {
  const params = useParams()
  const {
    userId: connectedUserId,
    userLabel,
    isAuthLoading,
    isAuthenticated,
  } = useAnalyticsIdentity(params.userId)
  const [userId, setUserId] = useState(connectedUserId)
  const [selectedSkill, setSelectedSkill] = useState('confidence')
  const [data, setData] = useState(DEMO_DATA)
  const [skillPrediction, setSkillPrediction] = useState(null)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const sortedPredictions = useMemo(
    () => [...(data.predictions || [])].sort((a, b) => riskWeight(b.risk_level) - riskWeight(a.risk_level)),
    [data.predictions]
  )

  const highPriority = data.summary?.highest_risk_prediction || sortedPredictions[0]
  const hasLiveData = status !== 'live' || Boolean(data.predictions?.length)
  const isMlModel = data.model_version === 'ml-predictive-behavioral-analytics-v1'

  const loadPredictions = async (nextUserId = userId) => {
    const targetUserId = nextUserId.trim()

    if (!targetUserId) {
      setError('Enter a user id')
      return
    }

    setStatus('loading')
    setError('')

    try {
      const [predictionResult, selectedResult] = await Promise.all([
        analyticsService.getPredictedOutcomesByUser(targetUserId),
        analyticsService.getPredictedOutcomeBySkill(targetUserId, selectedSkill),
      ])
      setData(predictionResult)
      setSkillPrediction(selectedResult)
      setStatus('live')
    } catch (err) {
      setData(DEMO_DATA)
      setSkillPrediction(null)
      setStatus('demo')
      setError('Backend predictions unavailable. Showing demo predictions.')
    }
  }

  useEffect(() => {
    setUserId(connectedUserId)
  }, [connectedUserId])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) {
      loadPredictions(connectedUserId)
    }
  }, [connectedUserId, isAuthLoading, isAuthenticated, selectedSkill])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
            <h1 className="mt-1 text-2xl font-semibold">Predictive Analytics</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <AnalyticsNav />
            <SelectInput label="Skill" value={selectedSkill} onChange={setSelectedSkill} options={SKILL_OPTIONS} />
            <Button className="h-10 self-end" onClick={() => loadPredictions()}>
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
          <ModelPill modelVersion={data.model_version} isMlModel={isMlModel} />
          {error ? <span className="text-sm text-warning">{error}</span> : null}
        </div>

        {!hasLiveData ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Live API is connected, but no predictive records were found for this user.
          </div>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_440px]">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BrainCircuit className="h-4 w-4 text-secondary" />
                <span>{isAuthenticated ? userLabel : data.user_id || userId}</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold">Live next-session risk forecast</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                The trained predictive model combines recent skill trends, feedback ratings, sentiment, and session evidence to forecast the next score and risk level.
              </p>
              <div className="mt-4 grid max-w-3xl gap-2 sm:grid-cols-3">
                <ModelFact label="Runtime" value={isMlModel ? 'Trained ML model' : 'Rule fallback'} />
                <ModelFact label="Model version" value={data.model_version || 'rule-based-baseline-v1'} />
                <ModelFact label="Selected skill" value={labelFor(selectedSkill)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric icon={Target} label="Predicted" value={data.summary?.predicted_count || 0} />
              <Metric icon={ShieldAlert} label="High Risk" value={data.summary?.high_risk_count || 0} />
              <Metric icon={AlertTriangle} label="Medium Risk" value={data.summary?.medium_risk_count || 0} />
              <Metric icon={CheckCircle2} label="Low Risk" value={data.summary?.low_risk_count || 0} />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          <Panel title="Highest Priority" icon={ShieldAlert}>
            {highPriority ? <PriorityCard item={highPriority} /> : <EmptyState text="No priority prediction yet" />}
          </Panel>

          <Panel title="Selected Skill Forecast" icon={Gauge}>
            <SelectedSkillCard item={skillPrediction} fallbackSkill={selectedSkill} />
          </Panel>
        </div>

        <Panel title="Prediction Detail" icon={BrainCircuit}>
          <PredictionGrid predictions={sortedPredictions} />
        </Panel>
      </section>
    </main>
  )
}

function PredictionGrid({ predictions }) {
  if (!predictions.length) return <EmptyState text="No predictions yet" />

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {predictions.map((item) => (
        <PredictionCard key={item.predicted_skill} item={item} />
      ))}
    </div>
  )
}

function PredictionCard({ item }) {
  const delta = scoreDelta(item.current_score, item.predicted_score)
  return (
    <div className="rounded-lg border border-border bg-background/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{labelFor(item.predicted_skill)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{item.evidence_points || 0} evidence points</p>
        </div>
        <RiskBadge risk={item.risk_level} />
      </div>

      <ScoreMovement current={item.current_score} predicted={item.predicted_score} />

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <InfoBox label="Trend" value={item.trend_label} icon={item.trend_label === 'declining' ? TrendingDown : TrendingUp} />
        <InfoBox label="Confidence" value={`${Math.round(Number(item.confidence || 0) * 100)}%`} icon={Activity} />
      </div>

      <p className="mt-4 text-sm text-muted-foreground">{item.recommendation}</p>
      <p className={`mt-3 text-xs ${delta < 0 ? 'text-destructive' : delta > 0 ? 'text-success' : 'text-muted-foreground'}`}>
        Projected change {formatDelta(delta)}
      </p>
    </div>
  )
}

function PriorityCard({ item }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-background/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">{labelFor(item.predicted_skill)}</h3>
          <RiskBadge risk={item.risk_level} />
        </div>
        <ScoreMovement current={item.current_score} predicted={item.predicted_score} />
        <p className="mt-4 text-sm text-muted-foreground">{item.recommendation}</p>
      </div>
    </div>
  )
}

function SelectedSkillCard({ item, fallbackSkill }) {
  if (!item) {
    return (
      <div>
        <EmptyState text={`Load live API data to inspect ${labelFor(fallbackSkill)} individually`} />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{labelFor(item.predicted_skill)}</h3>
        <RiskBadge risk={item.risk_level} />
      </div>
      <ScoreMovement current={item.current_score} predicted={item.predicted_score} />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric icon={Target} label="Current" value={formatScore(item.current_score)} compact />
        <Metric icon={BrainCircuit} label="Predicted" value={formatScore(item.predicted_score)} compact />
        <Metric icon={Activity} label="Evidence" value={item.evidence_points || 0} compact />
        <Metric icon={Gauge} label="Confidence" value={`${Math.round(Number(item.confidence || 0) * 100)}%`} compact />
      </div>
      <div className="mt-2">
        <InfoBox label="Trend" value={item.trend_label} icon={item.trend_label === 'declining' ? TrendingDown : TrendingUp} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{item.recommendation}</p>
    </div>
  )
}

function ScoreMovement({ current, predicted }) {
  const currentScore = normalizeScore(current)
  const predictedScore = normalizeScore(predicted)

  return (
    <div className="mt-4 space-y-3">
      <ScoreBar label="Current" value={currentScore} />
      <ScoreBar label="Predicted" value={predictedScore} />
    </div>
  )
}

function ScoreBar({ label, value }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value === null ? 'N/A' : value}</span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-secondary" style={{ width: `${value || 0}%` }} />
      </div>
    </div>
  )
}

function InfoBox({ label, value, icon: Icon }) {
  return (
    <div className="rounded-md border border-border p-3">
      <Icon className="mb-2 h-4 w-4 text-secondary" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium">{value || 'N/A'}</p>
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

function ModelFact({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
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

function Input({ label, value, onChange }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
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

function StatusPill({ status }) {
  const label = status === 'live' ? 'Live API predictions' : status === 'loading' ? 'Loading predictions' : 'Demo predictions'
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function ModelPill({ modelVersion, isMlModel }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${
        isMlModel
          ? 'border-secondary/40 bg-secondary/10 text-secondary'
          : 'border-border bg-card text-muted-foreground'
      }`}
    >
      <Sparkles className="h-3 w-3" />
      {modelVersion || 'rule-based-baseline-v1'}
    </span>
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

function normalizeScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null
  return Math.max(0, Math.min(100, Math.round(Number(value))))
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}

function scoreDelta(current, predicted) {
  if (current === null || current === undefined || predicted === null || predicted === undefined) return null
  return Math.round(Number(predicted) - Number(current))
}

function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return `${value > 0 ? '+' : ''}${value}`
}

function riskWeight(risk) {
  if (risk === 'high') return 3
  if (risk === 'medium') return 2
  if (risk === 'low') return 1
  return 0
}
