import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  ShieldAlert,
  Target,
} from 'lucide-react'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
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

// The service's words in the learner's. "medium" ranks an item; "keep an eye on
// it" tells them what to do with it, which is what a badge is for.
const PRIORITY_WORDS = { high: 'do this first', medium: 'worth doing', low: 'when you have time' }
const priorityWords = (value) => PRIORITY_WORDS[value] || value || ''

const SOURCE_WORDS = { self: 'your rating', system: 'measured', mentor: 'system note', peer: 'peer' }
const sourceWords = (value) => SOURCE_WORDS[value] || value || ''

const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
}

// Empty shape, never sample values: a failed load must show nothing rather than
// someone else's report. Keeping the shape means every render path below stays
// valid and the existing empty states do the work.
const EMPTY_REPORT = {
  session_id: '',
  user_id: null,
  summary: {
    headline: '',
    strengths: [],
    improvement_areas: [],
    completion_status: 'empty',
  },
  aggregate: {
    scores: { metric_count: 0, averages: {} },
    feedback: {
      total_count: 0,
      average_rating: null,
      by_type: {},
      skill_rating_averages: {},
      self_rating_averages: {},
      latest_entries: [],
    },
    predictions: { total_count: 0, latest_predictions: [] },
  },
  skill_scores: { skill_scores: {}, overall_score: null, breakdown: {}, completeness: 0 },
  feedback_analysis: { summary: {}, items: [] },
  blind_spots: {
    summary: { total_count: 0, high_count: 0, medium_count: 0, low_count: 0, sentiment_gap_count: 0 },
    blind_spots: [],
    sentiment_gaps: [],
  },
  action_items: [],
  computed_predictions: [],
  generated_at: null,
  report_version: 'rule-based-v1',
}
const RAW_TO_COMPOSITE = {
  confidence: 'Presence & Engagement',
  eye_contact: 'Presence & Engagement',
  confidence_score: 'Presence & Engagement',
  speech_pace: 'Speech Fluency',
  clarity: 'Speech Fluency',
  communication_clarity: 'Speech Fluency',
  speech_volume: 'Vocal Command',
  professionalism: 'Vocal Command',
  empathy: 'Emotional Intelligence',
  emotional_control: 'Emotional Intelligence',
  listening: 'Emotional Intelligence',
  active_listening: 'Emotional Intelligence',
  adaptability: 'Emotional Intelligence',
}

const PRIORITY_VARIANT = { high: 'danger', medium: 'warning', low: 'success' }

// How a gap reads to the person who has it. The service calls these
// "overestimation" and "underestimation"; neither is a word anybody uses about
// themselves, and both sound like an accusation.
const GAP_WORDS = {
  overestimation: 'You rated this higher than it measured',
  underestimation: 'You rated this lower than it measured',
}
const gapWords = (value) => GAP_WORDS[value] || String(value || '').replaceAll('_', ' ')

// "high" alone is a ranking. What a reader needs is what to do about it.
const RISK_WORDS = { high: 'needs work now', medium: 'keep an eye on it', low: 'going fine' }
const riskWords = (value) => RISK_WORDS[value] || value || 'unknown'

const SEVERITY_WORDS = { high: 'big gap', medium: 'noticeable', low: 'small', none: 'none' }
const severityWords = (value) => SEVERITY_WORDS[value] || value || ''

function labelFor(value) {
  return SKILL_LABELS[value] || RAW_TO_COMPOSITE[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function PostSessionReport() {
  const params = useParams()
  // The session list is per learner, so this page needs to know who it is
  // looking at - it previously only ever knew a session id.
  const { userId: connectedUserId } = useAnalyticsIdentity(params.userId)
  const [sessionId, setSessionId] = useState(params.sessionId || '')
  const [sessionOptions, setSessionOptions] = useState([])
  const [report, setReport] = useState(EMPTY_REPORT)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const loadedSessionRef = useRef(null)

  const radarScores = useMemo(() => {
    const scores = report.skill_scores?.skill_scores || {}
    return Object.entries(SKILL_LABELS)
      .filter(([key]) => key !== 'overall')
      .map(([key, label]) => ({ key, label, value: scores[key] ?? undefined }))
  }, [report])

  const selfScores = useMemo(() => {
    const selfRatings = report.aggregate?.feedback?.self_rating_averages || {}
    return Object.entries(SKILL_LABELS)
      .filter(([key]) => key !== 'overall')
      .map(([key, label]) => ({ key, label, value: selfRatings[key] ?? undefined }))
  }, [report])

  const overallScore = report.skill_scores?.overall_score ?? null

  const loadReport = async (nextSessionId = sessionId) => {
    const targetSessionId = String(nextSessionId || '').trim()
    if (!targetSessionId) { setError('Select a session before loading the report.'); return }
    setStatus('loading'); setError('')
    try {
      const nextReport = await analyticsService.getPostSessionReport(targetSessionId)
      setReport(nextReport); setStatus('live')
    } catch {
      setReport(EMPTY_REPORT); setStatus('error')
      setError('This session report could not be loaded. Nothing is shown rather than a guess — check the backend and try again.')
    }
  }

  useEffect(() => {
    let isActive = true
    async function loadSessions() {
      const options = await loadComponentSessionOptions(analyticsService, connectedUserId)
      if (!isActive) return
      setSessionOptions(options)
      if (!params.sessionId && !sessionId) {
        const preferred = selectPreferredComponentSession(options)
        if (preferred) setSessionId(preferred.id)
      }
    }
    loadSessions()
    return () => { isActive = false }
  }, [params.sessionId])

  useEffect(() => {
    if (sessionId && sessionId !== loadedSessionRef.current) {
      loadedSessionRef.current = sessionId
      loadReport(sessionId)
    }
  }, [sessionId])

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page page-wide">
      <PageHead
        eyebrow="Feedback System & Predictive Analytics"
        title="How That Session Went"
        sub="Everything from one session in one place: what was measured, what you thought, and what to do next."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <AnalyticsSessionSelect value={sessionId} options={sessionOptions} onChange={setSessionId} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <AnalyticsLoadButton loading={status === 'loading'} onClick={() => loadReport()} />
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant="neutral">
          {status === 'live' ? 'Live report' : status === 'loading' ? 'Loading…' : status === 'error' ? 'Unavailable' : 'Not loaded'}
        </Badge>
        {error && <span className="t-cap" style={{ color: 'var(--warning)' }}>{error}</span>}
      </motion.div>

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <FileText size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
                <span className="t-cap">
                  {sessionOptions.find((o) => o.id === sessionId)?.label || 'Session Report'}
                </span>
              </div>
              <div className="t-h3" style={{ maxWidth: 520 }}>{report.summary?.headline}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, minWidth: 240 }}>
              <MetricBox label="Overall" value={formatScore(overallScore)} />
              <MetricBox label="Skills you rated" value={report.aggregate?.feedback?.total_count || 0} />
              <MetricBox label="Things to try" value={report.action_items?.length || 0} />
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="All Four Skills" icon={Target}>
          <SkillTwinRadar scores={radarScores} selfScores={selfScores} overallScore={overallScore} />
        </Panel>
        <Panel title="The Short Version" icon={CheckCircle2}>
          <SummaryList title="Held up well" items={report.summary?.strengths || []} emptyText="Nothing scored high enough to call a strength this time" />
          <div style={{ marginTop: 16 }}>
            <SummaryList title="Worth working on" items={report.summary?.improvement_areas || []} emptyText="Nothing stood out as weak" />
          </div>
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="What To Try Next" icon={ClipboardList}>
          <ActionList actions={report.action_items || []} />
        </Panel>
        <Panel title="Where Your Rating Missed" icon={ShieldAlert}>
          <BlindSpotList blindSpots={report.blind_spots?.blind_spots || []} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2">
        <Panel title="What You Said" icon={FileText}>
          <FeedbackList entries={report.aggregate?.feedback?.latest_entries || []} />
        </Panel>
        <Panel title="If Nothing Changes" icon={AlertTriangle}>
          <PredictionList predictions={report.computed_predictions?.length ? report.computed_predictions : (report.aggregate?.predictions?.latest_predictions || [])} />
        </Panel>
      </motion.div>
    </motion.div>
  )
}

function SummaryList({ title, items, emptyText }) {
  return (
    <div>
      <div className="t-cap" style={{ fontWeight: 500, marginBottom: 10 }}>{title}</div>
      {items.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {items.map((item) => (
            <Badge key={item} variant="neutral">{item}</Badge>
          ))}
        </div>
      ) : (
        <EmptyMsg text={emptyText} />
      )}
    </div>
  )
}

function ActionList({ actions }) {
  if (!actions.length) return <EmptyMsg text="No action items yet" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {actions.map((item, index) => (
        <div key={`${item.title}-${index}`} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
            <Badge variant={PRIORITY_VARIANT[item.priority] ?? 'neutral'}>{priorityWords(item.priority)}</Badge>
          </div>
          <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.detail}</p>
        </div>
      ))}
    </div>
  )
}

function BlindSpotList({ blindSpots }) {
  if (!blindSpots.length) return <EmptyMsg text="No blind spots detected" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blindSpots.map((item) => (
        <div key={item.skill_area} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
            <Badge variant={PRIORITY_VARIANT[item.severity] ?? 'neutral'}>{severityWords(item.severity)}</Badge>
          </div>
          <p className="t-cap" style={{ marginBottom: 4 }}>{gapWords(item.blind_spot_type)} — by {formatScore(item.gap)} points</p>
          <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function FeedbackList({ entries }) {
  if (!entries.length) return <EmptyMsg text="No feedback entries yet" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((item) => (
        <div key={item.id} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(item.skill_area || item.feedback_type)}</span>
            {/* "self" is how the row is stored. The learner knows they wrote it;
                what the badge should say is that this is their own rating. */}
            <Badge variant="neutral">{sourceWords(item.feedback_type)}</Badge>
          </div>
                      <p className="t-cap" style={{ marginBottom: 4, lineHeight: 1.55 }}>
              {item.comment || 'You rated this one without writing anything.'}
            </p>
          <p className="t-cap">Rating {formatScore(item.rating)}</p>
        </div>
      ))}
    </div>
  )
}

function PredictionList({ predictions }) {
  if (!predictions.length) return <EmptyMsg text="No prediction evidence yet" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {predictions.map((item) => (
        <div key={item.id || item.predicted_skill} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(item.predicted_skill)}</span>
            <Badge variant={PRIORITY_VARIANT[item.risk_level] ?? 'neutral'}>{riskWords(item.risk_level)}</Badge>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
            <span className="t-cap">Current {formatScore(item.current_score)}</span>
            <span className="t-cap">Next {formatScore(item.predicted_score)}</span>
          </div>
          <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function MetricBox({ label, value }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
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

function EmptyMsg({ text }) {
  return (
    <div style={{ padding: 20, borderRadius: 'var(--radius)', border: '1px dashed var(--border-subtle)', textAlign: 'center' }}>
      <span className="t-cap">{text}</span>
    </div>
  )
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}
