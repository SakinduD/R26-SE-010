import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  LineChart,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsLoadButton from './AnalyticsLoadButton'
// REDESIGN: AnalyticsNav removed — sidebar Progress section now handles navigation
import AnalyticsSessionSelect from './AnalyticsSessionSelect'
import { useAnalyticsIdentity } from './analyticsAuth'
import { loadComponentSessionOptions, selectPreferredComponentSession } from './analyticsIntegrationUtils'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

// The four skills the backend trend engine supports. "Overall" is a summary
// (the mean of these four), not a skill, so it has no trend line of its own.
const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
}

const SKILL_OPTIONS = Object.entries(SKILL_LABELS).map(([value, label]) => ({ value, label }))
const TREND_VARIANT = { improving: 'success', stable: 'neutral', declining: 'danger', insufficient_data: 'info' }

const EMPTY_DATA = {
  user_id: '',
  summary: {
    analyzed_skill_count: 0,
    improving_count: 0,
    stable_count: 0,
    declining_count: 0,
    insufficient_data_count: 0,
    strongest_improvement: null,
    strongest_decline: null,
  },
  trends: [],
  generated_at: null,
  trend_version: 'rule-based-v1',
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
  const [data, setData] = useState(EMPTY_DATA)
  const [selectedTrend, setSelectedTrend] = useState(EMPTY_DATA.trends[0])
  const [status, setStatus] = useState('idle')
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
      setData(EMPTY_DATA)
      setSelectedTrend(EMPTY_DATA.trends.find((item) => item.skill_area === selectedSkill) || EMPTY_DATA.trends[0])
      setStatus('error')
      setError('Your progress trends could not be loaded. Nothing is shown rather than a guess — try again in a moment.')
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
        title="How You Are Changing"
        sub="Every session you have done, in order. This is the one page that shows whether the practice is working."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <AnalyticsSessionSelect
          value={sessionId}
          options={sessionOptions}
          onChange={setSessionId}
          minWidthClass="min-w-[260px]"
        />
        <SelectInput label="Show me" value={selectedSkill} onChange={setSelectedSkill} options={SKILL_OPTIONS} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <AnalyticsLoadButton loading={status === 'loading'} onClick={() => loadTrends(userId, sessionId)} />
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant="neutral">
          {status === 'live' ? 'Live trends' : status === 'loading' ? 'Loading…' : status === 'error' ? 'Unavailable' : 'Not loaded'}
        </Badge>
        {/* Printed the raw version id, "rule-based-v1", which reads like an
            error code. A trend is arithmetic on the learner's own scores - no
            model is involved and none is claimed. */}
        <span className="t-cap">Measured from your sessions</span>
        {error && <span className="t-cap" style={{ color: 'var(--warning)' }}>{error}</span>}
      </motion.div>

      {!hasLiveData && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid color-mix(in oklch, var(--warning) 40%, transparent)', background: 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
            <span className="t-cap" style={{ color: 'var(--warning)' }}>
              You're connected, but there's nothing here yet for this user.
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
              <div className="t-h3">Are you actually getting better?</div>
              <p className="t-cap" style={{ maxWidth: 520, marginTop: 6, lineHeight: 1.6 }}>
                One session tells you about one day. This compares all of them, which is the
                only way to tell practice from a good afternoon.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, minWidth: 260 }}>
              <MetricBox icon={Target} label="Skills tracked" value={data.summary?.analyzed_skill_count || 0} />
              <MetricBox icon={TrendingUp} label="Getting better" value={data.summary?.improving_count || 0} />
              <MetricBox icon={CheckCircle2} label="Holding steady" value={data.summary?.stable_count || 0} />
              <MetricBox icon={TrendingDown} label="Slipping" value={data.summary?.declining_count || 0} />
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Every Session, Plotted" icon={LineChart}>
          <ProgressTrendVisualization trends={data.trends || []} labelFor={labelFor} />
        </Panel>
        <Panel title="The Skill You Picked" icon={Activity}>
          <SelectedTrendCard item={selectedTrend} selectedSkill={selectedSkill} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Your Biggest Win" icon={TrendingUp}>
          <TrendHighlight item={data.summary?.strongest_improvement} emptyText="Nothing is climbing yet — keep going" />
        </Panel>
        <Panel title="Slipping The Most" icon={TrendingDown}>
          <TrendHighlight item={data.summary?.strongest_decline} emptyText="Nothing is slipping. Good." />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Panel title="All Four Skills" icon={BarChart3}>
          <TrendTable trends={sortedTrends} />
        </Panel>
      </motion.div>
    </motion.div>
  )
}

function SelectedTrendCard({ item, selectedSkill }) {
  if (!item) return <EmptyMsg text={`No sessions have measured your ${labelFor(selectedSkill).toLowerCase()} yet`} />

  const sessionCount = trendSessionCount(item)
  const hasTrend = hasTrendEvidence(item)
  const emptyTrendValue = sessionCount > 0 ? 'Need one more session' : 'Nothing yet'

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
        {/* "Delta" and "slope" are what these are called in the code, and both
            needed renaming — but "change so far" was worse than jargon, it was
            wrong. It compares two single sessions out of dozens. On a skill
            varying by 16 points between sessions those two endpoints can differ
            by 26 while the line through all 68 is flat, which is exactly why the
            badge above can read "holding steady" beside a number like -26. Both
            are true; only one is a summary. Saying which sessions the number
            comes from is what stops it being read as a verdict. */}
        <InfoBox label="First vs latest session" value={hasTrend ? formatDelta(item.delta) : emptyTrendValue} />
        <InfoBox label="Trend per session" value={hasTrend ? formatDelta(item.slope) : emptyTrendValue} />
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
  if (!trends.length) return <EmptyMsg text="Finish a couple of sessions and your lines will appear here" />
  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 880 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.7fr 0.6fr 0.9fr 0.7fr 2.4fr', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
          {/* Same renaming as the cards. "Delta" in particular compares two
              single sessions, so it is named after what it compares. */}
          {['Skill', 'Direction', 'Started at', 'Now', 'First vs latest', 'Sessions', 'What to do'].map((h) => (
            <span key={h} className="t-cap" style={{ fontWeight: 500 }}>{h}</span>
          ))}
        </div>
        {trends.map((item) => {
          const sessionCount = trendSessionCount(item)
          const hasTrend = hasTrendEvidence(item)
          const emptyTrendValue = sessionCount > 0 ? 'One more' : 'Nothing yet'
          return (
            <div key={item.skill_area} style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.7fr 0.6fr 0.9fr 0.7fr 2.4fr', gap: 8, padding: '12px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13, alignItems: 'start' }}>
              <span className="fg" style={{ fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
              <span className="t-cap">{readableTrendLabel(item.trend_label)}</span>
              <span className="fg">{formatScore(item.first_score)}</span>
              <span className="fg">{formatScore(item.latest_score)}</span>
              <span className="fg">{hasTrend ? formatDelta(item.delta) : emptyTrendValue}</span>
              <span className="fg">{sessionCount}</span>
              {/* Was clipped to one line with an ellipsis, so the sentence telling
                  the learner what to do about this skill ended mid-word. It is
                  the only column here worth reading in full; the numbers beside
                  it are all two or three characters. */}
              <span className="t-cap" style={{ lineHeight: 1.5, whiteSpace: 'normal' }}>{item.recommendation}</span>
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
      <ScoreBar label="When you started" value={first} />
      <ScoreBar label="Where you are now" value={latest} />
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

// The service's words, in the reader's. "insufficient_data" in particular is a
// statement about our records, not about them, and reads like a verdict.
const TREND_WORDS = {
  improving: 'getting better',
  declining: 'slipping',
  stable: 'holding steady',
  insufficient_data: 'need more sessions',
}

function readableTrendLabel(label) {
  if (!label) return 'nothing yet'
  return TREND_WORDS[label] || label.replaceAll('_', ' ')
}
