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

// The service's words in the learner's: a badge should say what to do, not rank.
const PRIORITY_WORDS = { high: 'do this first', medium: 'worth doing', low: 'when you have time' }
const priorityWords = (value) => PRIORITY_WORDS[value] || value || ''

const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
}

// The four the radar has an axis for. Anything else on a session - the written
// reflection, which names no skill, or the whole-session self-rating an older
// form filed under "overall" - is not one of them and has no axis to sit on.
const MCA_SKILLS = ['vocal_command', 'speech_fluency', 'presence_engagement', 'emotional_intelligence']

// Empty shape, never sample values: a failed load must show nothing rather than
// someone else's report, and every render path below stays valid.
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

// The same three states as a stripe colour: the badge names it, the stripe
// lets the eye find it without reading.
const PRIORITY_TONE = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--success)' }

/** One fact on the hero's footer rule: label and number inline, divider between. */
function HeroStat({ label, value, mark, last = false }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 8,
        paddingRight: last ? 0 : 18,
        marginRight: last ? 0 : 18,
        borderRight: last ? 'none' : '1px solid var(--border-subtle)',
      }}
    >
      <span className="t-cap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {mark && <span style={{ width: 7, height: 7, borderRadius: '50%', background: mark, flex: '0 0 auto' }} />}
        {label}
      </span>
      <span className="fg" style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </span>
  )
}

/**
 * A labelled number, sized to be read at a glance.
 *
 * The value stays text-primary: --warning is ~1.8:1 on a light card, under the
 * 3:1 large text needs. Meaning goes on the mark beside it, never the number.
 */
function Figure({ label, value, mark }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, flex: '0 0 auto' }}>
      <span className="t-cap" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {mark && <span style={{ width: 7, height: 7, borderRadius: '50%', background: mark, flex: '0 0 auto' }} />}
        {label}
      </span>
      <span className="fg" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </span>
  )
}

/**
 * A panel row, striped down its leading edge.
 *
 * The stripe is where semantic colour belongs: beside text, not in it, so it
 * carries no contrast requirement and survives either theme.
 */
function ListRow({ tone, children }) {
  return (
    <div className="report-row" style={tone ? { '--row-tone': tone } : undefined}>
      {children}
    </div>
  )
}

/** The title-and-badge line every row starts with. */
function RowHead({ title, badge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
      <span className="fg" style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
      {badge}
    </div>
  )
}

// The service says "overestimation"; nobody says that about themselves.
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

/**
 * A skill name that will not break mid-name.
 *
 * Running text only — "Emotional Intelligence" wrapping after "Emotional" reads
 * as two things. Headings and cells keep labelFor and may wrap freely.
 */
function labelNoBreak(value) {
  return labelFor(value).replaceAll(' ', ' ')
}

export default function PostSessionReport() {
  const params = useParams()
  // The session list is per learner, so this page needs the user, not just a
  // session id.
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

  // The learner's own rows only - see FeedbackList for why the rest do not
  // belong under "What You Said".
  const ownSelf = useMemo(
    () => (report.aggregate?.feedback?.latest_entries || []).filter((e) => e.feedback_type === 'self'),
    [report.aggregate],
  )

  // The four skill ratings, and only those. A row needs both a rating and one of
  // the four skills: the reflection has no rating, and one session still carries
  // a whole-session self-rating filed under "overall" from an older form, which
  // is not a skill and has no axis to sit on.
  const ownEntries = useMemo(
    () => ownSelf.filter((e) => hasScore(e.rating) && MCA_SKILLS.includes(e.skill_area)),
    [ownSelf],
  )

  // The reflection is about the session, not a skill, and is shown as its own
  // block above the ratings.
  const reflection = useMemo(
    () => ownSelf.find((e) => e.comment && e.comment.trim()) || null,
    [ownSelf],
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
        {/* The full session code is clipped at the 220px default. Same width as
            the trends and prediction pages. */}
        <AnalyticsSessionSelect
          value={sessionId}
          options={sessionOptions}
          onChange={setSessionId}
          minWidthClass="min-w-[260px]"
        />
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
        {/* The score is the news; the counts only point further down the page,
            so they are not sized to match it. */}
        <Card
          variant="accent"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 32,
            alignItems: 'center',
            background: 'linear-gradient(120deg, color-mix(in oklch, var(--accent) 9%, var(--bg-surface)) 0%, var(--bg-surface) 55%)',
          }}
        >
          <ScoreRing value={overallScore} tone={contextTone(report.context?.overall_delta)} />
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <FileText size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
              <span className="t-cap">
                {sessionOptions.find((o) => o.id === sessionId)?.label || 'Session Report'}
              </span>
            </div>
            {/* Not a 560px reading measure: this is one sentence in a wide card.
                `balance` keeps it even where it still has to wrap. */}
            <div className="t-h3" style={{ maxWidth: 900, marginBottom: 8, textWrap: 'balance' }}>
              {report.summary?.headline}
            </div>
            <SessionInContext context={report.context} />
            {/* Ruled off from the verdict: these count what is further down the
                page, and the rule says so without shrinking them. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                marginTop: 18,
                paddingTop: 14,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              {/* Rated rows, not every row: the session also holds engine cues and
                  the learner's written reflection, and counting those told someone
                  who rated four skills that they had rated nine. Amber marks the
                  learner's answer here as on the radar; the other two are the
                  engine's and take no dot. */}
              <HeroStat label="Skills you rated" value={ownEntries.length} mark="var(--warning)" />
              <HeroStat label="Gaps found" value={report.blind_spots?.summary?.total_count || 0} />
              <HeroStat label="Things to try" value={report.action_items?.length || 0} last />
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
          <FeedbackList entries={ownEntries} reflection={reflection} />
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
        <ListRow key={`${item.title}-${index}`} tone={PRIORITY_TONE[item.priority]}>
          <RowHead
            title={item.title}
            badge={<Badge variant={PRIORITY_VARIANT[item.priority] ?? 'neutral'}>{priorityWords(item.priority)}</Badge>}
          />
          <p className="t-cap" style={{ margin: 0, lineHeight: 1.65 }}>{item.detail}</p>
        </ListRow>
      ))}
    </div>
  )
}

function BlindSpotList({ blindSpots }) {
  if (!blindSpots.length) return <EmptyMsg text="No blind spots detected" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blindSpots.map((item) => (
        <ListRow key={item.skill_area} tone={PRIORITY_TONE[item.severity]}>
          <RowHead
            title={labelFor(item.skill_area)}
            badge={<Badge variant={PRIORITY_VARIANT[item.severity] ?? 'neutral'}>{severityWords(item.severity)}</Badge>}
          />
          {/* The finding is the distance between these two, so they sit together. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Figure label="You said" value={formatScore(item.self_rating)} mark="var(--warning)" />
            <span className="t-cap" style={{ flex: '0 0 auto' }}>vs</span>
            <Figure label="Measured" value={formatScore(item.comparison_score)} mark="var(--accent)" />
            {/* Badge, not a hand-rolled pill: the badge classes are where a light
                theme will be made to work. */}
            <span style={{ marginLeft: 'auto' }}>
              <Badge variant={PRIORITY_VARIANT[item.severity] ?? 'neutral'}>
                {formatScore(item.gap)} apart
              </Badge>
            </span>
          </div>
          <p className="t-cap" style={{ margin: '0 0 6px', lineHeight: 1.6 }}>
            <span className="fg">{gapWords(item.blind_spot_type)}.</span>
          </p>
          <p className="t-cap" style={{ margin: 0, lineHeight: 1.65 }}>{item.recommendation}</p>
        </ListRow>
      ))}
    </div>
  )
}

/**
 * How the sentiment model read the words, beside how the learner marked them.
 *
 * The model runs on every reflection and its reading was stored but never shown
 * here, so a learner who marked a session positive and wrote something negative
 * saw only their own label. The disagreement is the interesting part, and it is
 * the same evidence the Blind Spots page reasons from - so it uses that page's
 * wording rather than inventing a second vocabulary for one thing.
 *
 * Only a reading the model actually produced is shown. `sentiment_source` is
 * "declared" when the model could not run, and the stored sentiment is then a
 * copy of the learner's own label: printing that as agreement would be the page
 * agreeing with itself.
 */
function SentimentReading({ entry }) {
  if (entry.sentiment_source !== 'model' || !entry.sentiment || !entry.declared_sentiment) return null

  const agrees = entry.sentiment === entry.declared_sentiment
  const confidence = hasScore(entry.sentiment_confidence)
    ? Math.floor(Number(entry.sentiment_confidence) * 100)
    : null

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 7,
        marginTop: 12,
        paddingTop: 10,
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <span className="t-cap">You marked it</span>
      <strong className="fg" style={{ fontSize: 12, textTransform: 'capitalize' }}>
        {entry.declared_sentiment}
      </strong>
      {agrees ? (
        <span className="t-cap">
          · read the same way{confidence != null && ` (${confidence}% confidence)`}
        </span>
      ) : (
        <>
          <span className="t-cap">· your words read as</span>
          {/* Warning, not danger: a disagreement is something to look at, not a
              verdict. The Blind Spots page carries how far it can be trusted. */}
          <strong style={{ fontSize: 12, textTransform: 'capitalize', color: 'var(--warning)' }}>
            {entry.sentiment}
          </strong>
          {confidence != null && <span className="t-cap">({confidence}% confidence)</span>}
        </>
      )}
    </div>
  )
}

/**
 * The learner's own ratings for this session — and only those.
 *
 * A session also carries engine cues and mentor rows titled with raw column
 * names ("speech_volume", "system"). Those are inputs to a score, not things
 * the learner said, so filtering to `self` is what makes the heading true.
 */
// Above this the two figures are the same score to a reader.
const CONTEXT_MEANINGFUL_DELTA = 5

/**
 * One sentence placing this session among the learner's others.
 *
 * A score out of 100 cannot be read alone: 67 is good for someone who usually
 * scores 60 and poor for someone who usually scores 82. A sentence, not a
 * table - every number is already on the page; the comparison was what was not.
 */
function SessionInContext({ context }) {
  if (!context || context.overall_delta == null) return null

  const delta = context.overall_delta
  const usual = Math.round(context.previous_overall_average)
  const best = context.skills.filter((s) => s.is_personal_best)
  const furthest = [...context.skills].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0]

  // Emphasise the comparison; where it came from follows unemphasised.
  let lead
  let rest
  if (Math.abs(delta) < CONTEXT_MEANINGFUL_DELTA) {
    lead = 'About where you usually land'
    rest = ` — your average across ${context.sessions_compared} other sessions is ${usual}`
  } else if (delta < 0) {
    lead = `${Math.round(Math.abs(delta))} points below your usual ${usual}`
    rest = ` — measured across ${context.sessions_compared} other sessions`
  } else {
    lead = `${Math.round(delta)} points above your usual ${usual}`
    rest = ` — measured across ${context.sessions_compared} other sessions`
  }

  // Only ever one follow-up: a personal best if there is one, otherwise where
  // the session dipped most. A continuation, not a second sentence.
  let tail = null
  if (best.length) {
    tail = `, and ${best.map((s) => labelNoBreak(s.skill_area)).join(' and ')} ${best.length === 1 ? 'was a personal best' : 'were personal bests'}`
  } else if (delta <= -CONTEXT_MEANINGFUL_DELTA && furthest && furthest.delta <= -CONTEXT_MEANINGFUL_DELTA) {
    tail = `, with ${labelNoBreak(furthest.skill_area)} falling furthest at ${Math.round(furthest.delta)}`
  }

  return (
    <p className="t-body" style={{ maxWidth: 900, margin: 0, lineHeight: 1.65, textWrap: 'pretty' }}>
      {/* One colour: the ring already carries the comparison as a hue. */}
      <strong className="fg">{lead}</strong>
      <span className="fg" style={{ fontWeight: 400 }}>{rest}{tail}.</span>
    </p>
  )
}

function FeedbackList({ entries, reflection }) {
  if (!entries.length) {
    return <EmptyMsg text="You have not rated this session yet. Rate yourself and your answers will appear here beside what was measured." />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* About the session, so above the four ratings rather than inside one. */}
      {reflection && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-input)',
          }}
        >
          <div className="t-cap" style={{ marginBottom: 6 }}>Your reflection on the session</div>
          <p className="t-body" style={{ margin: 0, lineHeight: 1.65, fontStyle: 'italic' }}>
            “{reflection.comment.trim()}”
          </p>
          <SentimentReading entry={reflection} />
        </div>
      )}
      {entries.map((item) => (
        <ListRow key={item.id} tone="var(--warning)">
          {/* Every row here is theirs, so a "Your rating" badge said nothing. */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <span className="fg" style={{ fontSize: 14, fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
            <span className="fg" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {formatScore(item.rating)}
            </span>
          </div>
        </ListRow>
      ))}
    </div>
  )
}

function PredictionList({ predictions }) {
  if (!predictions.length) return <EmptyMsg text="No prediction evidence yet" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {predictions.map((item) => (
        <ListRow key={item.id || item.predicted_skill} tone={PRIORITY_TONE[item.risk_level]}>
          <RowHead
            title={labelFor(item.predicted_skill)}
            badge={<Badge variant={PRIORITY_VARIANT[item.risk_level] ?? 'neutral'}>{riskWords(item.risk_level)}</Badge>}
          />
          {/* Name the move: otherwise the reader does the subtraction that is
              the whole forecast. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Figure label="Now" value={formatScore(item.current_score)} mark="var(--accent)" />
            <span className="t-cap" style={{ flex: '0 0 auto' }}>→</span>
            <Figure label="Next" value={formatScore(item.predicted_score)} mark={PRIORITY_TONE[item.risk_level]} />
            {hasScore(item.predicted_score) && hasScore(item.current_score) && (
              <span style={{ marginLeft: 'auto' }}>
                <Badge variant={PRIORITY_VARIANT[item.risk_level] ?? 'neutral'}>
                  {Number(item.predicted_score) > Number(item.current_score) ? '+' : ''}
                  {Math.round(Number(item.predicted_score) - Number(item.current_score))}
                </Badge>
              </span>
            )}
          </div>
          <p className="t-cap" style={{ margin: 0, lineHeight: 1.65 }}>{item.recommendation}</p>
        </ListRow>
      ))}
    </div>
  )
}


/** The overall score drawn as an arc of a circle. */
function ScoreRing({ value, tone }) {
  const score = hasScore(value) ? Math.max(0, Math.min(100, Number(value))) : null
  const radius = 58
  const circumference = 2 * Math.PI * radius
  // Full circle at 100 from twelve o'clock, so two rings compare at a glance.
  const dash = score == null ? 0 : (score / 100) * circumference

  return (
    <div style={{ position: 'relative', width: 150, height: 150, flex: '0 0 auto' }}>
      <svg width="150" height="150" viewBox="0 0 150 150" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="var(--bg-input)" strokeWidth="11" />
        <circle
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 800ms var(--ease)' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <span className="fg" style={{ fontSize: 42, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {formatScore(score)}
        </span>
        <span className="t-cap" style={{ fontSize: 10 }}>out of 100</span>
      </div>
    </div>
  )
}

/** Worse than usual is a warning, better a success, level neither. The ring and
 *  the sentence say one thing, so they take their colour from one place. */
function contextTone(delta) {
  if (delta == null || Math.abs(delta) < CONTEXT_MEANINGFUL_DELTA) return 'var(--accent)'
  return delta < 0 ? 'var(--warning)' : 'var(--success)'
}

function Panel({ title, icon: Icon, children }) {
  return (
    <Card>
      {/* A tinted disc, not a loose glyph: six panels need a findable mark. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-soft)',
            display: 'grid',
            placeItems: 'center',
            flex: '0 0 auto',
          }}
        >
          <Icon size={15} strokeWidth={1.9} style={{ color: 'var(--accent)' }} />
        </span>
        <h2 className="fg" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
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

/**
 * Is this a score, or the absence of one?
 *
 * Number(null) is 0 and Number.isFinite(0) is true, so `Number.isFinite(Number(x))`
 * accepts null as a genuine zero - which is how an unscored session came to read
 * as 0 out of 100.
 */
function hasScore(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function formatScore(value) {
  if (!hasScore(value)) return 'N/A'
  return Math.round(Number(value))
}
