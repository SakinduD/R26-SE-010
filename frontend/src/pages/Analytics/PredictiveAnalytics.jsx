import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import AnalyticsSessionSelect from './AnalyticsSessionSelect'
import { useAnalyticsIdentity } from './analyticsAuth'
import { loadComponentSessionOptions, selectPreferredComponentSession } from './analyticsIntegrationUtils'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

// Only the 5 composite skills the backend trend/prediction engine supports.
const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
}

const SKILL_OPTIONS = Object.entries(SKILL_LABELS).map(([value, label]) => ({ value, label }))
const RISK_VARIANT = { high: 'danger', medium: 'warning', low: 'success' }

const DEMO_DATA = {
  user_id: 'demo-user',
  predictions: [
    prediction('emotional_intelligence', 48, 39, 'declining', 'high', 0.78, 3),
    prediction('speech_fluency', 70, 58, 'declining', 'medium', 0.72, 3),
    prediction('vocal_command', 78, 90, 'improving', 'low', 0.65, 3),
    prediction('presence_engagement', 80, 84, 'improving', 'low', 0.61, 2),
  ],
  summary: {
    predicted_count: 4,
    low_risk_count: 2,
    medium_risk_count: 1,
    high_risk_count: 1,
    highest_risk_prediction: prediction('emotional_intelligence', 48, 39, 'declining', 'high', 0.78, 3),
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

function hasPredictionEvidence(item) {
  if (!item) return false
  return (
    Number(item.evidence_points || 0) > 0 ||
    (item.current_score !== null && item.current_score !== undefined) ||
    (item.predicted_score !== null && item.predicted_score !== undefined)
  )
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
  const [selectedSkill, setSelectedSkill] = useState('overall')
  const [sessionOptions, setSessionOptions] = useState([])
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [data, setData] = useState(DEMO_DATA)
  const [skillPrediction, setSkillPrediction] = useState(null)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const sortedPredictions = useMemo(
    () => [...(data.predictions || [])].sort((a, b) => riskWeight(b.risk_level) - riskWeight(a.risk_level)),
    [data.predictions]
  )

  const availablePredictionSkills = useMemo(
    () => [...new Set((data.predictions || []).map((item) => item.predicted_skill).filter(Boolean))],
    [data.predictions]
  )

  const highPriority = data.summary?.highest_risk_prediction || sortedPredictions[0]
  const hasLiveData = status !== 'live' || Boolean(data.predictions?.length)
  const isMlModel = data.model_version === 'ml-predictive-behavioral-analytics-v1'

  const loadPredictions = async (nextUserId = userId, nextSessionId = selectedSessionId) => {
    const targetUserId = nextUserId.trim()
    const requestParams = nextSessionId ? { session_id: nextSessionId } : {}
    if (!targetUserId) { setError('Enter a user id'); return }
    setStatus('loading'); setError('')
    try {
      const [predictionResult, selectedResult] = await Promise.all([
        analyticsService.getPredictedOutcomesByUser(targetUserId, requestParams),
        analyticsService.getPredictedOutcomeBySkill(targetUserId, selectedSkill, requestParams),
      ])
      setData(predictionResult); setSkillPrediction(selectedResult); setStatus('live')
    } catch {
      setData(DEMO_DATA); setSkillPrediction(null); setStatus('demo')
      setError('Backend predictions unavailable. Showing demo predictions.')
    }
  }

  useEffect(() => { setUserId(connectedUserId) }, [connectedUserId])

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) { setSessionOptions([]); setSelectedSessionId(''); return undefined }
    let active = true
    loadComponentSessionOptions(analyticsService)
      .then((options) => {
        if (!active) return
        setSessionOptions(options)
        const preferred = selectPreferredComponentSession(options)
        setSelectedSessionId((current) => current || preferred?.id || '')
      })
      .catch(() => { if (active) setSessionOptions([]) })
    return () => { active = false }
  }, [isAuthLoading, isAuthenticated])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) {
      loadPredictions(connectedUserId, selectedSessionId)
    }
  }, [connectedUserId, isAuthLoading, isAuthenticated, selectedSkill, selectedSessionId])

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page page-wide">
      <PageHead
        eyebrow="Feedback System & Predictive Analytics"
        title="Predictive Analytics"
        sub="Next-session risk forecast powered by the trained behavioural analytics model."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <AnalyticsNav />
        <AnalyticsSessionSelect
          value={selectedSessionId}
          options={sessionOptions}
          onChange={setSelectedSessionId}
          minWidthClass="min-w-[260px]"
        />
        <SelectInput label="Skill" value={selectedSkill} onChange={setSelectedSkill} options={SKILL_OPTIONS} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <Button onClick={() => loadPredictions()} variant="secondary" size="sm" loading={status === 'loading'}>
            {status !== 'loading' && <RefreshCw size={12} strokeWidth={1.8} />}
            Load
          </Button>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant="neutral">
          {status === 'live' ? 'Live API predictions' : status === 'loading' ? 'Loading…' : 'Demo predictions'}
        </Badge>
        <Badge variant={isMlModel ? 'accent' : 'neutral'}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={10} strokeWidth={1.8} />
            {data.model_version || 'rule-based-baseline-v1'}
          </span>
        </Badge>
        {error && <span className="t-cap" style={{ color: 'var(--warning)' }}>{error}</span>}
      </motion.div>

      {!hasLiveData && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid color-mix(in oklch, var(--warning) 40%, transparent)', background: 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
            <span className="t-cap" style={{ color: 'var(--warning)' }}>
              Live API is connected, but no predictive records were found for this user.
            </span>
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <BrainCircuit size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
                <span className="t-cap">{isAuthenticated ? userLabel : data.user_id || userId}</span>
              </div>
              <div className="t-h3">Live next-session risk forecast</div>
              <p className="t-cap" style={{ maxWidth: 520, marginTop: 6, lineHeight: 1.6 }}>
                The trained predictive model combines recent skill trends, feedback ratings, sentiment, and session evidence to forecast the next score and risk level.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14, maxWidth: 480 }}>
                <ModelFact label="Runtime" value={isMlModel ? 'Trained ML model' : 'Rule fallback'} />
                <ModelFact label="Model version" value={data.model_version || 'rule-based-baseline-v1'} />
                <ModelFact label="Selected skill" value={labelFor(selectedSkill)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, minWidth: 200 }}>
              <MetricBox icon={Target} label="Predicted" value={data.summary?.predicted_count || 0} />
              <MetricBox icon={ShieldAlert} label="High Risk" value={data.summary?.high_risk_count || 0} />
              <MetricBox icon={AlertTriangle} label="Medium Risk" value={data.summary?.medium_risk_count || 0} />
              <MetricBox icon={CheckCircle2} label="Low Risk" value={data.summary?.low_risk_count || 0} />
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Highest Priority" icon={ShieldAlert}>
          {highPriority ? <PriorityCard item={highPriority} /> : <EmptyMsg text="No priority prediction yet" />}
        </Panel>
        <Panel title="Selected Skill Forecast" icon={Gauge}>
          <SelectedSkillCard item={skillPrediction} fallbackSkill={selectedSkill} availableSkills={availablePredictionSkills} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Panel title="Prediction Detail" icon={BrainCircuit}>
          <PredictionGrid predictions={sortedPredictions} />
        </Panel>
      </motion.div>
    </motion.div>
  )
}

function PredictionGrid({ predictions }) {
  if (!predictions.length) return <EmptyMsg text="No predictions yet" />
  return (
    <div className="grid-2">
      {predictions.map((item) => (
        <PredictionCard key={item.predicted_skill} item={item} />
      ))}
    </div>
  )
}

function PredictionCard({ item }) {
  const delta = scoreDelta(item.current_score, item.predicted_score)
  return (
    <div style={{ padding: 16, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'color-mix(in oklch, var(--bg-input) 60%, transparent)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div className="fg" style={{ fontWeight: 500, fontSize: 14 }}>{labelFor(item.predicted_skill)}</div>
          <div className="t-cap" style={{ marginTop: 2 }}>{item.evidence_points || 0} evidence points</div>
        </div>
        <Badge variant={RISK_VARIANT[item.risk_level] ?? 'neutral'}>{item.risk_level}</Badge>
      </div>
      <ScoreMovement current={item.current_score} predicted={item.predicted_score} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <InfoBox label="Trend" value={item.trend_label} icon={item.trend_label === 'declining' ? TrendingDown : TrendingUp} />
        <InfoBox label="Confidence" value={`${Math.round(Number(item.confidence || 0) * 100)}%`} icon={Activity} />
      </div>
      <p className="t-cap" style={{ marginTop: 12, lineHeight: 1.55 }}>{item.recommendation}</p>
      <p style={{ marginTop: 10, fontSize: 12, color: delta < 0 ? 'var(--danger)' : delta > 0 ? 'var(--success)' : 'var(--text-tertiary)' }}>
        Projected change {formatDelta(delta)}
      </p>
    </div>
  )
}

function PriorityCard({ item }) {
  return (
    <div style={{ padding: 16, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div className="fg" style={{ fontWeight: 500, fontSize: 14 }}>{labelFor(item.predicted_skill)}</div>
        <Badge variant={RISK_VARIANT[item.risk_level] ?? 'neutral'}>{item.risk_level}</Badge>
      </div>
      <ScoreMovement current={item.current_score} predicted={item.predicted_score} />
      <p className="t-cap" style={{ marginTop: 12, lineHeight: 1.55 }}>{item.recommendation}</p>
    </div>
  )
}

function SelectedSkillCard({ item, fallbackSkill, availableSkills = [] }) {
  const availableLabels = availableSkills.filter((skill) => skill !== fallbackSkill).map(labelFor)

  if (!item) {
    return <EmptyMsg text={`No live prediction was returned for ${labelFor(fallbackSkill)}.`} />
  }

  if (!hasPredictionEvidence(item)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <EmptyMsg text={`No real prediction evidence for ${labelFor(fallbackSkill)} in the selected session.`} />
        <div style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
          <p className="t-cap" style={{ lineHeight: 1.55 }}>
            {availableLabels.length
              ? <><span className="fg" style={{ fontWeight: 500 }}>Real skills available:</span> {availableLabels.join(', ')}</>
              : 'Select a completed session that has role-play or multimodal performance scores.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div className="fg" style={{ fontWeight: 500, fontSize: 14 }}>{labelFor(item.predicted_skill)}</div>
        <Badge variant={RISK_VARIANT[item.risk_level] ?? 'neutral'}>{item.risk_level}</Badge>
      </div>
      <ScoreMovement current={item.current_score} predicted={item.predicted_score} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
        <MetricBox icon={Target} label="Current" value={formatScore(item.current_score)} compact />
        <MetricBox icon={BrainCircuit} label="Predicted" value={formatScore(item.predicted_score)} compact />
        <MetricBox icon={Activity} label="Evidence" value={item.evidence_points || 0} compact />
        <MetricBox icon={Gauge} label="Confidence" value={`${Math.round(Number(item.confidence || 0) * 100)}%`} compact />
      </div>
      <div style={{ marginTop: 10 }}>
        <InfoBox label="Trend" value={item.trend_label} icon={item.trend_label === 'declining' ? TrendingDown : TrendingUp} />
      </div>
      <p className="t-cap" style={{ marginTop: 12, lineHeight: 1.55 }}>{item.recommendation}</p>
    </div>
  )
}

function ScoreMovement({ current, predicted }) {
  const currentScore = normalizeScore(current)
  const predictedScore = normalizeScore(predicted)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ScoreBar label="Current" value={currentScore} />
      <ScoreBar label="Predicted" value={predictedScore} />
    </div>
  )
}

function ScoreBar({ label, value }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span className="t-cap">{label}</span>
        <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{value === null ? 'N/A' : value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-input)' }}>
        <div style={{ height: 6, borderRadius: 99, background: 'var(--accent)', width: `${value || 0}%`, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function InfoBox({ label, value, icon: Icon }) {
  return (
    <div style={{ padding: 10, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
      {Icon && <Icon size={12} strokeWidth={1.8} style={{ color: 'var(--accent)', marginBottom: 6 }} />}
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{value || 'N/A'}</div>
    </div>
  )
}

function MetricBox({ icon: Icon, label, value, compact = false }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      {Icon && <Icon size={13} strokeWidth={1.8} style={{ color: 'var(--accent)', marginBottom: 6 }} />}
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: compact ? 14 : 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function ModelFact({ label, value }) {
  return (
    <div style={{ padding: 10, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: 12, fontWeight: 500, marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}

function Panel({ title, icon: Icon, children }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Icon size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
        <div className="t-over">{title}</div>
      </div>
      {children}
    </Card>
  )
}

function SelectInput({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="t-cap">{label}</span>
      <select
        className="input"
        style={{ height: 36, paddingTop: 0, paddingBottom: 0 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  )
}

function EmptyMsg({ text }) {
  return (
    <div style={{ padding: 20, borderRadius: 'var(--radius)', border: '1px dashed var(--border-subtle)', textAlign: 'center' }}>
      <span className="t-cap">{text}</span>
    </div>
  )
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
