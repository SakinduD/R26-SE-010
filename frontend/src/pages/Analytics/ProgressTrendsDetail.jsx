import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  LineChart,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
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

// Only the 5 composite skills the backend trend engine supports.
const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
}

const SKILL_OPTIONS = Object.entries(SKILL_LABELS).map(([value, label]) => ({ value, label }))
const TREND_VARIANT = { improving: 'success', stable: 'neutral', declining: 'danger', insufficient_data: 'info' }

const DEMO_DATA = {
  user_id: 'demo-user',
  summary: {
    analyzed_skill_count: 5,
    improving_count: 2,
    stable_count: 2,
    declining_count: 1,
    insufficient_data_count: 0,
    strongest_improvement: trend('vocal_command', 'improving', [55, 65, 78]),
    strongest_decline: trend('overall', 'declining', [90, 82, 70]),
  },
  trends: [
    trend('vocal_command', 'improving', [55, 65, 78]),
    trend('speech_fluency', 'stable', [72, 73, 74]),
    trend('presence_engagement', 'improving', [66, 72, 79]),
    trend('emotional_intelligence', 'stable', [70, 75, 80]),
    trend('overall', 'declining', [90, 82, 70]),
  ],
  generated_at: '2026-05-03T00:00:00',
  trend_version: 'rule-based-v1',
}

function trend(skillArea, trendLabel, scores) {
  return {
    skill_area: skillArea,
    trend_label: trendLabel,
    first_score: scores[0],
    latest_score: scores[scores.length - 1],
    delta: scores[scores.length - 1] - scores[0],
    slope: scores.length > 1 ? (scores[scores.length - 1] - scores[0]) / (scores.length - 1) : 0,
    session_count: scores.length,
    recommendation: `${labelFor(skillArea)} trend should be reviewed before the next training plan.`,
    points: scores.map((score, index) => ({
      session_id: `S${index + 1}`,
      score,
      created_at: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00`,
    })),
  }
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function ProgressTrendsDetail() {
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
  const [selectedSkill, setSelectedSkill] = useState('vocal_command')
  const [data, setData] = useState(DEMO_DATA)
  const [selectedTrend, setSelectedTrend] = useState(DEMO_DATA.trends[0])
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const sortedTrends = useMemo(
    () => [...(data.trends || [])].sort((a, b) => Math.abs(Number(b.delta || 0)) - Math.abs(Number(a.delta || 0))),
    [data.trends]
  )

  const hasLiveData = status !== 'live' || Boolean(data.trends?.some((item) => item.points?.length > 1))

  const loadSessionOptions = async () => {
    try {
      const options = await loadComponentSessionOptions(analyticsService)
      setSessionOptions(options)
      setSessionId((current) => current || selectPreferredComponentSession(options)?.id || '')
    } catch {
      setSessionOptions([])
    }
  }

  const loadTrends = async (nextUserId = userId, nextSessionId = sessionId) => {
    const targetUserId = nextUserId.trim()
    const selectedSessionId = nextSessionId?.trim()
    if (!targetUserId) { setError('Enter a user id'); return }
    setStatus('loading'); setError('')
    try {
      const reqParams = selectedSessionId ? { session_id: selectedSessionId } : {}
      const [trendResult, skillResult] = await Promise.all([
        analyticsService.getProgressTrendsByUser(targetUserId, reqParams),
        analyticsService.getProgressTrendBySkill(targetUserId, selectedSkill, reqParams),
      ])
      setData(trendResult); setSelectedTrend(skillResult); setStatus('live')
    } catch {
      setData(DEMO_DATA)
      setSelectedTrend(DEMO_DATA.trends.find((item) => item.skill_area === selectedSkill) || DEMO_DATA.trends[0])
      setStatus('demo')
      setError('Backend trend data unavailable. Showing demo progress trends.')
    }
  }

  useEffect(() => { setUserId(connectedUserId) }, [connectedUserId])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) loadSessionOptions()
  }, [connectedUserId, isAuthLoading, isAuthenticated])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) loadTrends(connectedUserId, sessionId)
  }, [connectedUserId, isAuthLoading, isAuthenticated, selectedSkill, sessionId])

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page page-wide">
      <PageHead
        eyebrow="Feedback System & Predictive Analytics"
        title="Progress Trends"
        sub="Longitudinal skill analysis across sessions to identify patterns and trajectory."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <AnalyticsNav />
        <AnalyticsSessionSelect
          value={sessionId}
          options={sessionOptions}
          onChange={setSessionId}
          minWidthClass="min-w-[260px]"
        />
        <SelectInput label="Skill" value={selectedSkill} onChange={setSelectedSkill} options={SKILL_OPTIONS} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <Button onClick={() => loadTrends(userId, sessionId)} variant="secondary" size="sm" loading={status === 'loading'}>
            {status !== 'loading' && <RefreshCw size={12} strokeWidth={1.8} />}
            Load
          </Button>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant="neutral">
          {status === 'live' ? 'Live API trends' : status === 'loading' ? 'Loading…' : 'Demo trends'}
        </Badge>
        <span className="t-cap">{data.trend_version || 'rule-based-v1'}</span>
        {error && <span className="t-cap" style={{ color: 'var(--warning)' }}>{error}</span>}
      </motion.div>

      {!hasLiveData && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid color-mix(in oklch, var(--warning) 40%, transparent)', background: 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
            <span className="t-cap" style={{ color: 'var(--warning)' }}>
              Live API is connected, but no progress trend history was found for this user.
            </span>
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <LineChart size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
                <span className="t-cap">{isAuthenticated ? userLabel : data.user_id || userId}</span>
              </div>
              <div className="t-h3">Longitudinal skill progress</div>
              <p className="t-cap" style={{ maxWidth: 520, marginTop: 6, lineHeight: 1.6 }}>
                Trend analysis compares session scores over time to identify improving, stable, declining, and insufficient-data skills.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, minWidth: 260 }}>
              <MetricBox icon={Target} label="Analyzed" value={data.summary?.analyzed_skill_count || 0} />
              <MetricBox icon={TrendingUp} label="Improving" value={data.summary?.improving_count || 0} />
              <MetricBox icon={CheckCircle2} label="Stable" value={data.summary?.stable_count || 0} />
              <MetricBox icon={TrendingDown} label="Declining" value={data.summary?.declining_count || 0} />
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Trend Visualisation" icon={LineChart}>
          <ProgressTrendVisualization trends={data.trends || []} labelFor={labelFor} />
        </Panel>
        <Panel title="Selected Skill" icon={Activity}>
          <SelectedTrendCard item={selectedTrend} selectedSkill={selectedSkill} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Strongest Improvement" icon={TrendingUp}>
          <TrendHighlight item={data.summary?.strongest_improvement} emptyText="No strongest improvement yet" />
        </Panel>
        <Panel title="Strongest Decline" icon={TrendingDown}>
          <TrendHighlight item={data.summary?.strongest_decline} emptyText="No strongest decline yet" />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Panel title="Trend Details" icon={BarChart3}>
          <TrendTable trends={sortedTrends} />
        </Panel>
      </motion.div>
    </motion.div>
  )
}

function SelectedTrendCard({ item, selectedSkill }) {
  if (!item) return <EmptyMsg text={`No trend loaded for ${labelFor(selectedSkill)}`} />

  const sessionCount = trendSessionCount(item)
  const hasTrend = hasTrendEvidence(item)
  const emptyTrendValue = sessionCount > 0 ? 'Needs 2 sessions' : 'No data'

  return (
    <div style={{ padding: 16, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'color-mix(in oklch, var(--bg-input) 60%, transparent)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <div className="fg" style={{ fontWeight: 500, fontSize: 14 }}>{labelFor(item.skill_area || selectedSkill)}</div>
          <div className="t-cap" style={{ marginTop: 2 }}>{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}</div>
        </div>
        <TrendBadge label={item.trend_label} />
      </div>
      <ScoreMovement first={item.first_score} latest={item.latest_score} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <InfoBox label="Delta" value={hasTrend ? formatDelta(item.delta) : emptyTrendValue} />
        <InfoBox label="Slope" value={hasTrend ? formatDelta(item.slope) : emptyTrendValue} />
      </div>
      <p className="t-cap" style={{ marginTop: 12, lineHeight: 1.55 }}>
        {sessionCount > 0
          ? item.recommendation
          : `No ${labelFor(item.skill_area || selectedSkill).toLowerCase()} evidence has been collected yet.`}
      </p>
    </div>
  )
}

function TrendHighlight({ item, emptyText }) {
  if (!item) return <EmptyMsg text={emptyText} />
  return <SelectedTrendCard item={item} selectedSkill={item.skill_area} />
}

function TrendTable({ trends }) {
  if (!trends.length) return <EmptyMsg text="No trend details yet" />
  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 780 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr repeat(5, 0.8fr) 1.4fr', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
          {['Skill', 'Trend', 'First', 'Latest', 'Delta', 'Sessions', 'Recommendation'].map((h) => (
            <span key={h} className="t-cap" style={{ fontWeight: 500 }}>{h}</span>
          ))}
        </div>
        {trends.map((item) => {
          const sessionCount = trendSessionCount(item)
          const hasTrend = hasTrendEvidence(item)
          const emptyTrendValue = sessionCount > 0 ? 'Needs 2' : 'No data'
          return (
            <div key={item.skill_area} style={{ display: 'grid', gridTemplateColumns: '1.2fr repeat(5, 0.8fr) 1.4fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <span className="fg" style={{ fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
              <span className="t-cap">{readableTrendLabel(item.trend_label)}</span>
              <span className="fg">{formatScore(item.first_score)}</span>
              <span className="fg">{formatScore(item.latest_score)}</span>
              <span className="fg">{hasTrend ? formatDelta(item.delta) : emptyTrendValue}</span>
              <span className="fg">{sessionCount}</span>
              <span className="t-cap" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.recommendation}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoreMovement({ first, latest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ScoreBar label="First" value={first} />
      <ScoreBar label="Latest" value={latest} />
    </div>
  )
}

function ScoreBar({ label, value }) {
  const score = normalizeScore(value)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span className="t-cap">{label}</span>
        <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{formatScore(score)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-input)' }}>
        <div style={{ height: 6, borderRadius: 99, background: 'var(--accent)', width: `${score || 0}%`, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function MetricBox({ icon: Icon, label, value }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <Icon size={13} strokeWidth={1.8} style={{ color: 'var(--accent)', marginBottom: 6 }} />
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function InfoBox({ label, value }) {
  return (
    <div style={{ padding: 10, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{value}</div>
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

function TrendBadge({ label }) {
  const Icon = label === 'improving' ? TrendingUp : label === 'declining' ? TrendingDown : Activity
  return (
    <Badge variant={TREND_VARIANT[label] ?? 'neutral'}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon size={10} strokeWidth={1.8} />
        {readableTrendLabel(label)}
      </span>
    </Badge>
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
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'No data'
  return Math.round(Number(value))
}

function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'No data'
  const rounded = Math.round(Number(value) * 100) / 100
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

function trendSessionCount(item) {
  return Number(item?.session_count || item?.points?.length || 0)
}

function hasTrendEvidence(item) {
  return trendSessionCount(item) >= 2 && item?.trend_label !== 'insufficient_data'
}

function readableTrendLabel(label) {
  if (!label) return 'No data'
  return label.replaceAll('_', ' ')
}
