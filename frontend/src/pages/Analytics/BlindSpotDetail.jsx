import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Target,
  UserCircle,
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

const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
}

const DEMO_DATA = {
  blindSpots: {
    scope: 'user',
    user_id: 'demo-user',
    session_id: null,
    summary: {
      total_count: 2,
      high_count: 1,
      medium_count: 1,
      low_count: 0,
      strongest_blind_spot: {
        skill_area: 'presence_engagement',
        blind_spot_type: 'overestimation',
        severity: 'high',
        self_rating: 92,
        comparison_score: 55,
        comparison_source: 'observed',
        gap: 37,
        confidence: 0.92,
        recommendation: 'Review Presence & Engagement evidence and set one measurable improvement target.',
      },
    },
    blind_spots: [
      {
        skill_area: 'presence_engagement',
        blind_spot_type: 'overestimation',
        severity: 'high',
        self_rating: 92,
        comparison_score: 55,
        comparison_source: 'observed',
        gap: 37,
        confidence: 0.92,
        recommendation: 'Review Presence & Engagement evidence and set one measurable improvement target.',
      },
      {
        skill_area: 'emotional_intelligence',
        blind_spot_type: 'underestimation',
        severity: 'medium',
        self_rating: 64,
        comparison_score: 90,
        comparison_source: 'observed',
        gap: 26,
        confidence: 0.81,
        recommendation: 'Your Emotional Intelligence performance appears stronger than your self-rating. Build confidence with evidence.',
      },
    ],
  },
  feedbackAnalysis: {
    summary: {
      self_feedback_count: 3,
      peer_feedback_count: 0,
      analyzed_skill_count: 4,
      aligned_count: 2,
      blind_spot_count: 2,
      average_self_rating: 78,
      average_observed_score: 72,
    },
    items: [
      alignment('presence_engagement', 92, 55, 'self_overestimation', 'high'),
      alignment('emotional_intelligence', 64, 90, 'self_underestimation', 'medium'),
      alignment('vocal_command', 78, 76, 'aligned', 'none'),
    ],
  },
}

function alignment(skillArea, selfRating, observedScore, alignmentLabel, severity) {
  return {
    skill_area: skillArea,
    self_rating: selfRating,
    observed_score: observedScore,
    self_observed_gap: selfRating - observedScore,
    alignment: alignmentLabel,
    severity,
    recommendation: `${labelFor(skillArea)} feedback should be reviewed with evidence from the session.`,
  }
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

const SEV_VARIANT = { high: 'danger', medium: 'warning', low: 'success', none: 'neutral' }

export default function BlindSpotDetail() {
  const params = useParams()
  const {
    userId: connectedUserId,
    userLabel,
    isAuthLoading,
    isAuthenticated,
  } = useAnalyticsIdentity(params.userId)
  const [scope, setScope] = useState(params.sessionId ? 'session' : 'user')
  const [userId, setUserId] = useState(connectedUserId)
  const [sessionId, setSessionId] = useState(params.sessionId || '')
  const [sessionOptions, setSessionOptions] = useState([])
  const [data, setData] = useState(DEMO_DATA)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const currentId = scope === 'session' ? sessionId : userId
  const blindSpots = data.blindSpots?.blind_spots || []
  const analysisItems = data.feedbackAnalysis?.items || []
  const strongest = data.blindSpots?.summary?.strongest_blind_spot || blindSpots[0]

  const hasLiveData = useMemo(() => {
    if (status !== 'live') return true
    return Boolean(blindSpots.length || analysisItems.length)
  }, [analysisItems.length, blindSpots.length, status])

  const loadBlindSpots = async (nextScope = scope, nextUserId = userId, nextSessionId = sessionId) => {
    const targetId = nextScope === 'session' ? nextSessionId.trim() : nextUserId.trim()
    if (!targetId) { setError(`Enter a ${nextScope} id`); return }
    setStatus('loading'); setError('')
    try {
      const [blindSpotResult, analysisResult] =
        nextScope === 'session'
          ? await Promise.all([analyticsService.getBlindSpotsBySession(targetId), analyticsService.getFeedbackAnalysisBySession(targetId)])
          : await Promise.all([analyticsService.getBlindSpotsByUser(targetId), analyticsService.getFeedbackAnalysisByUser(targetId)])
      setData({ blindSpots: blindSpotResult, feedbackAnalysis: analysisResult })
      setStatus('live')
    } catch {
      setData(DEMO_DATA); setStatus('demo')
      setError('Backend blind spot data unavailable. Showing demo analysis.')
    }
  }

  const handleScopeChange = (nextScope) => {
    setScope(nextScope)
    if (nextScope === 'session' && !sessionId) {
      const preferred = selectPreferredComponentSession(sessionOptions)
      if (preferred) setSessionId(preferred.id)
    }
  }

  useEffect(() => { if (scope === 'user') setUserId(connectedUserId) }, [connectedUserId, scope])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId && scope === 'user') {
      loadBlindSpots('user', connectedUserId, sessionId)
    }
  }, [connectedUserId, isAuthLoading, isAuthenticated, scope])

  useEffect(() => {
    let isActive = true
    async function loadSessions() {
      const options = await loadComponentSessionOptions(analyticsService)
      if (!isActive) return
      setSessionOptions(options)
      if (!params.sessionId && !sessionId) {
        const preferred = selectPreferredComponentSession(options)
        if (preferred) setSessionId(preferred.id)
      }
    }
    loadSessions()
    return () => { isActive = false }
  }, [params.sessionId, sessionId])

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page page-wide">
      <PageHead
        eyebrow="Feedback System & Predictive Analytics"
        title="Blind Spot Detection"
        sub="Compare self-reported ratings with observed performance to surface perception gaps."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <AnalyticsNav />
        <SelectInput
          label="Scope"
          value={scope}
          onChange={handleScopeChange}
          options={[{ value: 'user', label: 'User' }, { value: 'session', label: 'Session' }]}
        />
        {scope === 'session' && (
          <AnalyticsSessionSelect value={sessionId} options={sessionOptions} onChange={setSessionId} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <Button onClick={() => loadBlindSpots()} variant="secondary" size="sm" loading={status === 'loading'}>
            {status !== 'loading' && <RefreshCw size={12} strokeWidth={1.8} />}
            Load
          </Button>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant="neutral">
          {status === 'live' ? 'Live API blind spots' : status === 'loading' ? 'Loading…' : 'Demo blind spots'}
        </Badge>
        {error && <span className="t-cap" style={{ color: 'var(--warning)' }}>{error}</span>}
      </motion.div>

      {!hasLiveData && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid color-mix(in oklch, var(--warning) 40%, transparent)', background: 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
            <span className="t-cap" style={{ color: 'var(--warning)' }}>
              Live API is connected, but no blind spot records were found for this {scope}.
            </span>
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                {scope === 'session'
                  ? <BarChart3 size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
                  : <UserCircle size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />}
                <span className="t-cap">{scope === 'user' && isAuthenticated ? userLabel : currentId}</span>
              </div>
              <div className="t-h3">Self-perception gap analysis</div>
              <p className="t-cap" style={{ maxWidth: 520, marginTop: 6, lineHeight: 1.6 }}>
                Blind spots compare self feedback against observed performance evidence from role-play, adaptive pedagogy, and multimodal analysis.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, minWidth: 260 }}>
              <MetricBox icon={ShieldAlert} label="Total" value={data.blindSpots?.summary?.total_count || 0} />
              <MetricBox icon={AlertTriangle} label="High" value={data.blindSpots?.summary?.high_count || 0} />
              <MetricBox icon={Target} label="Medium" value={data.blindSpots?.summary?.medium_count || 0} />
              <MetricBox icon={CheckCircle2} label="Aligned" value={data.feedbackAnalysis?.summary?.aligned_count || 0} />
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Strongest Blind Spot" icon={ShieldAlert}>
          {strongest ? <BlindSpotCard item={strongest} featured /> : <EmptyMsg text="No blind spot detected" />}
        </Panel>
        <Panel title="Evidence Alignment Summary" icon={BarChart3}>
          <AlignmentSummary summary={data.feedbackAnalysis?.summary} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Panel title="Detected Blind Spots" icon={AlertTriangle}>
          <BlindSpotList items={blindSpots} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Panel title="Self / Observed Alignment" icon={BarChart3}>
          <AlignmentTable items={analysisItems} />
        </Panel>
      </motion.div>
    </motion.div>
  )
}

function BlindSpotList({ items }) {
  if (!items.length) return <EmptyMsg text="No blind spots detected" />
  return (
    <div className="grid-2">
      {items.map((item) => (
        <BlindSpotCard key={`${item.skill_area}-${item.blind_spot_type}`} item={item} />
      ))}
    </div>
  )
}

function BlindSpotCard({ item, featured = false }) {
  return (
    <div style={{
      padding: 16,
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border-subtle)',
      background: 'color-mix(in oklch, var(--bg-input) 60%, transparent)',
      minHeight: featured ? 240 : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <div className="fg" style={{ fontWeight: 500, fontSize: 14 }}>{labelFor(item.skill_area)}</div>
          <div className="t-cap" style={{ marginTop: 2 }}>{item.blind_spot_type} vs {item.comparison_source}</div>
        </div>
        <Badge variant={SEV_VARIANT[item.severity] ?? 'neutral'}>{item.severity}</Badge>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <ScoreBar label="Self rating" value={item.self_rating} />
        <ScoreBar label={`${item.comparison_source} score`} value={item.comparison_score} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <InfoBox label="Gap" value={formatScore(item.gap)} />
        <InfoBox label="Confidence" value={`${Math.round(Number(item.confidence || 0) * 100)}%`} />
      </div>
      <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.recommendation}</p>
    </div>
  )
}

function AlignmentSummary({ summary }) {
  if (!summary) return <EmptyMsg text="No feedback analysis summary yet" />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <MetricBox icon={UserCircle} label="Self Feedback" value={summary.self_feedback_count || 0} compact />
      <MetricBox icon={BarChart3} label="Skills Analyzed" value={summary.analyzed_skill_count || 0} compact />
      <MetricBox icon={Target} label="Self Avg" value={formatScore(summary.average_self_rating)} compact />
      <MetricBox icon={BarChart3} label="Observed Avg" value={formatScore(summary.average_observed_score)} compact />
      <MetricBox icon={CheckCircle2} label="Aligned" value={summary.aligned_count || 0} compact />
      <MetricBox icon={ShieldAlert} label="Blind Spots" value={summary.blind_spot_count || 0} compact />
    </div>
  )
}

function AlignmentTable({ items }) {
  if (!items.length) return <EmptyMsg text="No alignment analysis yet" />
  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 720 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr repeat(3, 0.8fr) 1fr', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
          {['Skill', 'Self', 'Observed', 'Gap', 'Alignment'].map((h) => (
            <span key={h} className="t-cap" style={{ fontWeight: 500 }}>{h}</span>
          ))}
        </div>
        {items.map((item) => (
          <div key={item.skill_area} style={{ display: 'grid', gridTemplateColumns: '1.2fr repeat(3, 0.8fr) 1fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
            <span className="fg" style={{ fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
            <span className="fg">{formatScore(item.self_rating)}</span>
            <span className="fg">{formatScore(item.observed_score)}</span>
            <span className="fg">{formatGap(item.self_observed_gap)}</span>
            <span className="t-cap" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.alignment}</span>
          </div>
        ))}
      </div>
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

function MetricBox({ icon: Icon, label, value, compact = false }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <Icon size={13} strokeWidth={1.8} style={{ color: 'var(--accent)', marginBottom: 6 }} />
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: compact ? 16 : 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
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

function formatGap(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  const rounded = Math.round(Number(value))
  return `${rounded > 0 ? '+' : ''}${rounded}`
}
