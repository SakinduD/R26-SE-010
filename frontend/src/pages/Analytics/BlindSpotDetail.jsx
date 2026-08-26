import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  MessageSquare,
  ShieldAlert,
  Target,
  UserCircle,
} from 'lucide-react'
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

const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
}

const EMPTY_DATA = {
  recurring: { items: [] },
  blindSpots: {
    scope: 'user',
    user_id: '',
    session_id: null,
    summary: {
      total_count: 0,
      high_count: 0,
      medium_count: 0,
      low_count: 0,
      strongest_blind_spot: null,
      sentiment_gap_count: 0,
    },
    blind_spots: [],
    sentiment_gaps: [],
  },
  feedbackAnalysis: {
    summary: {
      self_feedback_count: 0,
      analyzed_skill_count: 0,
      aligned_count: 0,
      blind_spot_count: 0,
      average_self_rating: null,
      average_observed_score: null,
    },
    items: [],
  },
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
  const [data, setData] = useState(EMPTY_DATA)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const currentId = scope === 'session' ? sessionId : userId
  const blindSpots = data.blindSpots?.blind_spots || []
  const sentimentGaps = data.blindSpots?.sentiment_gaps || []
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
      // Recurring patterns only make sense across a history, so they are not
      // fetched for a single session. The overview shows a bar and a count; the
      // sentence explaining what to do about each one belongs here, where there
      // is room for all four.
      const [blindSpotResult, analysisResult, recurringResult] =
        nextScope === 'session'
          ? await Promise.all([
              analyticsService.getBlindSpotsBySession(targetId),
              analyticsService.getFeedbackAnalysisBySession(targetId),
              Promise.resolve(null),
            ])
          : await Promise.all([
              analyticsService.getBlindSpotsByUser(targetId),
              analyticsService.getFeedbackAnalysisByUser(targetId),
              analyticsService.getRecurringBlindSpots(targetId).catch(() => null),
            ])
      setData({ blindSpots: blindSpotResult, feedbackAnalysis: analysisResult, recurring: recurringResult })
      setStatus('live')
    } catch {
      setData(EMPTY_DATA); setStatus('error')
      setError('Your blind spot analysis could not be loaded. Nothing is shown rather than a guess — try again in a moment.')
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
  }, [params.sessionId, sessionId])

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page page-wide">
      <PageHead
        eyebrow="Feedback System & Predictive Analytics"
        title="How Well Do You Know Yourself?"
        sub="You rate yourself after each session. Here is how those ratings compared with what was actually measured."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <SelectInput
          label="Looking at"
          value={scope}
          onChange={handleScopeChange}
          options={[{ value: 'user', label: 'User' }, { value: 'session', label: 'Session' }]}
        />
        {scope === 'session' && (
          <AnalyticsSessionSelect value={sessionId} options={sessionOptions} onChange={setSessionId} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <AnalyticsLoadButton loading={status === 'loading'} onClick={() => loadBlindSpots()} />
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant="neutral">
          {status === 'live' ? 'Live blind spots' : status === 'loading' ? 'Loading…' : status === 'error' ? 'Unavailable' : 'Not loaded'}
        </Badge>
        {error && <span className="t-cap" style={{ color: 'var(--warning)' }}>{error}</span>}
      </motion.div>

      {!hasLiveData && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid color-mix(in oklch, var(--warning) 40%, transparent)', background: 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
            <span className="t-cap" style={{ color: 'var(--warning)' }}>
              You're connected, but there's nothing here yet for this {scope}.
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
              <div className="t-h3">Your rating vs what was measured</div>
              <p className="t-cap" style={{ maxWidth: 520, marginTop: 6, lineHeight: 1.6 }}>
                A gap is not a mark against you. It just means one thing is easier to see
                from the outside than from where you are standing.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, minWidth: 260 }}>
              <MetricBox icon={ShieldAlert} label="Gaps found" value={data.blindSpots?.summary?.total_count || 0} />
              <MetricBox icon={AlertTriangle} label="Big ones" value={data.blindSpots?.summary?.high_count || 0} />
              <MetricBox icon={Target} label="Smaller" value={data.blindSpots?.summary?.medium_count || 0} />
              <MetricBox icon={CheckCircle2} label="Spot on" value={data.feedbackAnalysis?.summary?.aligned_count || 0} />
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="The Biggest Gap" icon={ShieldAlert}>
          {strongest ? <BlindSpotCard item={strongest} featured /> : <EmptyMsg text="Your rating matched what was measured" />}
        </Panel>
        <Panel title="How Close You Were" icon={BarChart3}>
          <AlignmentSummary summary={data.feedbackAnalysis?.summary} />
        </Panel>
      </motion.div>

      {scope === 'user' && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <Panel title="Patterns Across All Your Sessions" icon={Target}>
            <p className="t-cap" style={{ marginBottom: 14, lineHeight: 1.6 }}>
              One session can go either way. These are the ones that keep happening.
            </p>
            <RecurringPatternList items={data.recurring?.items} />
          </Panel>
        </motion.div>
      )}

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Panel title="Every Gap We Found" icon={AlertTriangle}>
          <BlindSpotList items={blindSpots} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Panel
          title={`What Your Own Words Said — ${sentimentGaps.length} gap${sentimentGaps.length === 1 ? '' : 's'}`}
          icon={MessageSquare}
        >
          <SentimentGapList items={sentimentGaps} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Panel title="Skill by Skill" icon={BarChart3}>
          <AlignmentTable items={analysisItems} />
        </Panel>
      </motion.div>
    </motion.div>
  )
}

const PATTERN_COPY = {
  consistent_overestimation: {
    headline: 'You rate this higher than it measures',
    tone: 'var(--danger)',
  },
  consistent_underestimation: {
    headline: 'You rate this lower than it measures',
    tone: 'var(--warning, #d99a2b)',
  },
  inconsistent: {
    headline: 'Sometimes high, sometimes low',
    tone: 'var(--warning, #d99a2b)',
  },
  aligned: {
    headline: 'You read this one well',
    tone: 'var(--success)',
  },
}

/**
 * Patterns counted across sessions, with the advice that goes with each.
 *
 * The overview shows the count and a bar - enough to know a pattern exists. The
 * sentence about what to do lands here, where four of them can sit together
 * without turning a summary panel into a wall of text.
 *
 * A count, not an average, for the reason the "inconsistent" case makes obvious:
 * being 20 points high one session and 20 low the next averages to zero and
 * reads as flawless self-knowledge, when the learner was wrong both times.
 */
function RecurringPatternList({ items }) {
  if (!items?.length) {
    return <EmptyMsg text="Rate yourself after three or more sessions and patterns will show up here" />
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((item) => {
        const copy = PATTERN_COPY[item.pattern] || PATTERN_COPY.inconsistent
        const pct = Math.round((item.gap_rate || 0) * 100)
        return (
          <Card key={item.skill_area}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <div className="t-h3">{labelFor(item.skill_area)}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: copy.tone }}>
                {item.sessions_with_gap} of {item.sessions_rated} sessions
              </div>
            </div>

            <div style={{ fontSize: 12, color: copy.tone, marginTop: 4 }}>{copy.headline}</div>

            <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-3, rgba(255,255,255,0.08))', overflow: 'hidden', margin: '10px 0' }}>
              <div style={{ height: '100%', width: pct + '%', background: copy.tone, borderRadius: 999 }} />
            </div>

            <p className="t-cap" style={{ lineHeight: 1.65, margin: 0 }}>{item.recommendation}</p>
          </Card>
        )
      })}
    </div>
  )
}

// How a gap reads to the person who has it. The service calls these
// "overestimation" and "underestimation"; neither is a word anybody uses about
// themselves, and both sound like an accusation.
const GAP_WORDS = {
  overestimation: 'You rated this higher than it measured',
  underestimation: 'You rated this lower than it measured',
}
const gapWords = (value) => GAP_WORDS[value] || String(value || '').replaceAll('_', ' ')

const SEVERITY_WORDS = { high: 'big gap', medium: 'noticeable', low: 'small', none: 'none' }
const severityWords = (value) => SEVERITY_WORDS[value] || value || ''

function BlindSpotList({ items }) {
  if (!items.length) return <EmptyMsg text="No gaps this time — your ratings matched" />
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
          <div className="t-cap" style={{ marginTop: 2 }}>{gapWords(item.blind_spot_type)}</div>
        </div>
        <Badge variant={SEV_VARIANT[item.severity] ?? 'neutral'}>{severityWords(item.severity)}</Badge>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <ScoreBar label="You said" value={item.self_rating} />
        {/* The field says "observed", which is what the code calls it. What the
            reader needs to know is that a machine measured it, not a person. */}
        <ScoreBar label="Measured" value={item.comparison_score} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <InfoBox label="Difference" value={formatScore(item.gap)} />
        <InfoBox label="How sure" value={`${Math.round(Number(item.confidence || 0) * 100)}%`} />
      </div>
      <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.recommendation}</p>
    </div>
  )
}

function AlignmentSummary({ summary }) {
  if (!summary) return <EmptyMsg text="Rate yourself after a session to see this" />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <MetricBox icon={UserCircle} label="Times you rated yourself" value={summary.self_feedback_count || 0} compact />
      <MetricBox icon={BarChart3} label="Skills checked" value={summary.analyzed_skill_count || 0} compact />
      <MetricBox icon={Target} label="Your average rating" value={formatScore(summary.average_self_rating)} compact />
      <MetricBox icon={BarChart3} label="Measured average" value={formatScore(summary.average_observed_score)} compact />
      <MetricBox icon={CheckCircle2} label="Spot on" value={summary.aligned_count || 0} compact />
      <MetricBox icon={ShieldAlert} label="Gaps" value={summary.blind_spot_count || 0} compact />
    </div>
  )
}

const ALIGNMENT_WORDS = {
  aligned: 'Spot on',
  self_overestimation: 'You rated it higher',
  self_underestimation: 'You rated it lower',
  insufficient_data: 'Not enough sessions',
}
const alignmentWords = (value) =>
  ALIGNMENT_WORDS[value] || String(value || '').replaceAll('_', ' ')

function AlignmentTable({ items }) {
  if (!items.length) return <EmptyMsg text="Rate yourself after a session to see this" />
  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 720 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.8fr 0.8fr 1.6fr', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
          {['Skill', 'You said', 'Measured', 'Difference', 'How it went'].map((h) => (
            <span key={h} className="t-cap" style={{ fontWeight: 500 }}>{h}</span>
          ))}
        </div>
        {items.map((item) => (
          <div key={item.skill_area} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.8fr 0.8fr 1.6fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
            <span className="fg" style={{ fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
            <span className="fg">{formatScore(item.self_rating)}</span>
            <span className="fg">{formatScore(item.observed_score)}</span>
            <span className="fg">{formatGap(item.self_observed_gap)}</span>
            {/* Printed the raw enum, clipped to one line - so a learner read
                "self_overestimatio…". Both halves of that were wrong. */}
            <span className="t-cap" style={{ lineHeight: 1.5, whiteSpace: 'normal' }}>{alignmentWords(item.alignment)}</span>
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

const GAP_TONE = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--info)' }

/**
 * Blind spots found in what the learner wrote, rather than in what they scored.
 *
 * The panel above compares numbers: a self-rating against measured performance.
 * This compares the sentiment the learner selected against the sentiment the NLP
 * model reads in their own reflection — the same self-perception gap, expressed
 * in language. Their words are quoted back so the finding is checkable.
 */
function SentimentGapList({ items }) {
  if (!items.length) {
    return (
      <EmptyMsg text="No gaps between your ratings and your written reflections. Write a reflection after a session to have this checked." />
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((gap, index) => (
        <div
          key={`${gap.session_id}-${index}`}
          style={{
            padding: 16,
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border-subtle)',
            borderLeft: `3px solid ${GAP_TONE[gap.severity] || 'var(--accent)'}`,
            background: 'color-mix(in oklch, var(--bg-input) 60%, transparent)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="t-cap">You marked it</span>
            <strong style={{ textTransform: 'capitalize', color: 'var(--text-primary)' }}>
              {gap.declared_sentiment}
            </strong>
            <span className="t-cap">but your words read as</span>
            <strong style={{ textTransform: 'capitalize', color: GAP_TONE[gap.severity] }}>
              {gap.detected_sentiment}
            </strong>
            <span className="t-cap">({Math.round(gap.confidence * 100)}% confidence)</span>
          </div>

          <blockquote
            style={{
              margin: 0,
              padding: '10px 14px',
              borderLeft: '2px solid var(--border-subtle)',
              fontStyle: 'italic',
              color: 'var(--text-secondary)',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {gap.comment_excerpt}
          </blockquote>

          <p className="t-cap" style={{ marginTop: 10, lineHeight: 1.6 }}>{gap.recommendation}</p>
        </div>
      ))}
    </div>
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

// "N/A" is not a phrase anybody says. A blank cell already means "nothing here".
function formatScoreOrBlank(value) {
  const score = formatScore(value)
  return score === 'N/A' ? '—' : score
}

function formatGap(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  const gap = Number(value)
  // Rounded to whole numbers this column stopped agreeing with the two beside
  // it: a self-rating of 77.19 against a measured 77.50 showed as "77", "78"
  // and a difference of "0", which reads as an arithmetic mistake. Under a
  // point, the decimal is the only thing that makes the row add up.
  const rounded = Math.abs(gap) < 1 ? gap.toFixed(1) : String(Math.round(gap))
  return `${gap > 0 ? '+' : ''}${rounded}`
}
