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

  // What the learner themselves wrote and rated. See FeedbackList for why the
  // rest of the rows on a session do not belong under "What You Said".
  const ownEntries = useMemo(
    () => (report.aggregate?.feedback?.latest_entries || []).filter((e) => e.feedback_type === 'self'),
    [report.aggregate],
  )

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
              <SessionInContext context={report.context} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, minWidth: 240 }}>
              <MetricBox label="Overall" value={formatScore(overallScore)} />
              {/* Self rows only. total_count is every row on the session -
                  four cues this codebase wrote from the multimodal engine, a
                  survey note, and the learner's four ratings - so a learner who
                  rated four skills was told they had rated nine. */}
              <MetricBox label="Skills you rated" value={report.aggregate?.feedback?.by_type?.self || 0} />
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
          <FeedbackList entries={ownEntries} />
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

/**
 * The learner's own ratings for this session — and only those.
 *
 * The panel is headed "What You Said" and used to render every feedback row on
 * the session: four cues this codebase writes from the multimodal engine, a
 * survey note stored as mentor feedback, then the four ratings the learner
 * actually gave. Five of the nine were not said by them, and they arrived
 * carrying raw column names as titles — "emotional_control", "speech_volume",
 * and twice just "system" — with bodies like "Multimodal Avg Mar average was
 * 0.06", where MAR is a mouth aspect ratio.
 *
 * Those rows are inputs to a score, not messages to a person, and there is no
 * screen where a learner reads them as feedback. Filtering to `self` is what
 * makes the heading true.
 */
// Above this the two figures are the same score to a reader.
const CONTEXT_MEANINGFUL_DELTA = 5

/**
 * One sentence placing this session among the learner's others.
 *
 * The report gave a score out of 100 and no way to read it. 67 is a good session
 * for somebody who usually scores 60 and a poor one for somebody who usually
 * scores 82 — this learner is the second, and the page opened on "Vocal Command
 * held up" over their worst result in weeks.
 *
 * A sentence rather than another table: every number here is already on the page
 * below, and repeating them in a grid would add a panel without adding anything
 * to read. What was missing was the comparison, not the data.
 */
function SessionInContext({ context }) {
  if (!context || context.overall_delta == null) return null

  const delta = context.overall_delta
  const usual = Math.round(context.previous_overall_average)
  const best = context.skills.filter((s) => s.is_personal_best)
  const furthest = [...context.skills].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0]

  let lead
  if (Math.abs(delta) < CONTEXT_MEANINGFUL_DELTA) {
    lead = `About where you usually land — your average across ${context.sessions_compared} other sessions is ${usual}.`
  } else if (delta < 0) {
    lead = `${Math.round(Math.abs(delta))} points below your usual ${usual}, measured across ${context.sessions_compared} other sessions.`
  } else {
    lead = `${Math.round(delta)} points above your usual ${usual}, measured across ${context.sessions_compared} other sessions.`
  }

  // Only ever one follow-up. A personal best is the better thing to say when
  // there is one; otherwise, if the session dipped, name where it dipped most.
  let tail = null
  if (best.length) {
    tail = `${best.map((s) => labelFor(s.skill_area)).join(' and ')} ${best.length === 1 ? 'was a' : 'were'} personal best.`
  } else if (delta <= -CONTEXT_MEANINGFUL_DELTA && furthest && furthest.delta <= -CONTEXT_MEANINGFUL_DELTA) {
    tail = `${labelFor(furthest.skill_area)} fell furthest (${Math.round(furthest.delta)}).`
  }

  const tone = Math.abs(delta) < CONTEXT_MEANINGFUL_DELTA
    ? 'var(--text-secondary)'
    : delta < 0 ? 'var(--warning)' : 'var(--success)'

  return (
    <p className="t-cap" style={{ maxWidth: 520, marginTop: 8, lineHeight: 1.6 }}>
      <strong style={{ color: tone }}>{lead}</strong>
      {tail && <> {tail}</>}
    </p>
  )
}

function FeedbackList({ entries }) {
  if (!entries.length) {
    return <EmptyMsg text="You have not rated this session yet. Rate yourself and your answers will appear here beside what was measured." />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((item) => (
        <div key={item.id} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
            {/* Every row here is theirs, so a "Your rating" badge on each one
                said nothing. The number they gave is the useful thing. */}
            <span className="fg" style={{ fontSize: 15, fontWeight: 600 }}>{formatScore(item.rating)}</span>
          </div>
          <p className="t-cap" style={{ lineHeight: 1.55, fontStyle: item.comment ? 'italic' : 'normal' }}>
            {item.comment ? `“${item.comment}”` : 'Rated without a written note.'}
          </p>
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
