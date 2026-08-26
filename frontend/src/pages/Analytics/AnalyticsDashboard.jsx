import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity, AlertTriangle, BarChart3, LineChart,
  ShieldAlert, Target,
  TrendingUp, TrendingDown, CheckCircle,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '../../components/ui/Button'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsLoadButton from './AnalyticsLoadButton'
// REDESIGN: AnalyticsNav removed — sidebar Progress section now handles navigation
import AnalyticsSessionSelect from './AnalyticsSessionSelect'
import AnalyticsUserBadge from './AnalyticsUserBadge'
import { useAnalyticsIdentity } from './analyticsAuth'
import {
  hasPulledComponentData, loadComponentSessionOptions,
  normalizeAdaptivePlan, normalizeMcaNudges, normalizeMcaOverallScore,
  normalizeMcaSessionNudges, normalizeMcaSkillScores,
  normalizeSurveyProfile,
  integrateOnce, optionalRequest, scenarioIdOf, selectMcaSession,
} from './analyticsIntegrationUtils'

const TREND_MARK = {
  improving: '↗ improving',
  declining: '↘ declining',
  stable: '→ stable',
  insufficient_data: '',
}

const TREND_TONE = {
  improving: 'var(--success)',
  declining: 'var(--danger)',
  stable: 'var(--text-secondary)',
  insufficient_data: 'var(--text-quaternary)',
}

// How a recurring self-assessment gap is described. The wording matters: these
// are patterns across many sessions, not a verdict on one, and the third is the
// finding an average destroys — wrong in both directions, cancelling to a mean
// near zero that reads as accuracy.
const PATTERN_COPY = {
  consistent_overestimation: {
    label: 'Rates higher than measured, almost every time',
    tone: 'var(--danger)',
  },
  consistent_underestimation: {
    label: 'Rates lower than measured, almost every time',
    tone: 'var(--warning, #d99a2b)',
  },
  inconsistent: {
    label: 'Sometimes high, sometimes low',
    tone: 'var(--warning, #d99a2b)',
  },
  aligned: {
    label: 'Reads this one accurately, session after session',
    tone: 'var(--success)',
  },
}

const SKILL_LABELS = {
  vocal_command: { label: 'Vocal Command', sub: 'Speech Volume' },
  speech_fluency: { label: 'Speech Fluency', sub: 'Speech Pace & Clarity' },
  presence_engagement: { label: 'Presence & Engagement', sub: 'Eye Contact & Confidence' },
  emotional_intelligence: { label: 'Emotional Intelligence', sub: 'Empathy & Emotional Control' },
  overall: { label: 'Overall Score', sub: 'Calculated Performance' },

  // Live Data Mappings
  professionalism: 'vocal_command',
  professionalism_score: 'vocal_command',
  speech_volume_score: 'vocal_command',
  communication_clarity: 'speech_fluency',
  clarity_score: 'speech_fluency',
  speech_pace_score: 'speech_fluency',
  confidence: 'presence_engagement',
  confidence_score: 'presence_engagement',
  eye_contact_score: 'presence_engagement',
  eye_contact: 'presence_engagement',
  empathy: 'emotional_intelligence',
  empathy_score: 'emotional_intelligence',
  emotional_control: 'emotional_intelligence',
  emotional_control_score: 'emotional_intelligence',
  active_listening: 'emotional_intelligence',
  adaptability: 'presence_engagement',
  overall_score: 'overall',
}

const getInfo = (v) => {
  const item = SKILL_LABELS[v]
  if (!item) return { key: v, label: String(v || '').replace(/_/g, ' '), sub: '' }
  if (typeof item === 'string') {
    const res = getInfo(item)
    return { ...res, key: item } // Return the target key
  }
  return { ...item, key: v }
}

const labelFor = (v) => getInfo(v).label
const subFor = (v) => getInfo(v).sub
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
// Average of the valid numbers only — mirrors the Skill Twin radar / Post-Session
// Report so a skill shows the SAME value everywhere (e.g. Speech Fluency is the
// mean of speech_pace + clarity, not just whichever field happens to be present).
const avgOf = (...vals) => {
  const nums = vals.map(toNum).filter((n) => n !== null)
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null
}
const fmtScore = (v) => (v == null || isNaN(Number(v))) ? '--' : Math.round(Number(v))

const mkTrend = (skill, label, scores) => ({
  skill_area: skill, trend_label: label, first_score: scores[0],
  latest_score: scores[scores.length - 1], delta: scores[scores.length - 1] - scores[0],
  points: scores.map((s, i) => ({ session_id: 'S'+(i+1), score: s, created_at: '2026-05-0'+(i+1)+'T00:00:00' })),
})
const mkPred = (skill, cur, pred, trend, risk) => ({
  predicted_skill: skill, current_score: cur, predicted_score: pred,
  trend_label: trend, risk_level: risk, confidence: 0.72,
  recommendation: 'Focus on improving ' + labelFor(skill) + ' in your next session.',
})

/**
 * The link out of a summary panel to the page that holds the whole story.
 *
 * Each panel here is a glance: enough to tell whether something needs looking
 * at. The page behind it has room to actually explain, which is why the panel
 * does not have to. Keeping this link small and in the same place on every panel
 * means a reader learns it once.
 */
function MoreLink({ to, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(to)}
      className="text-[11px] font-semibold text-primary hover:underline shrink-0"
    >
      See details →
    </button>
  )
}

/**
 * What this page shows someone who has not practised yet.
 *
 * Previously they got the whole dashboard with every figure at zero or "--", a
 * radar with no shape, and a small banner above it reading "complete a practice
 * session". A grid of empty boxes is not a welcome, and worse, it is not even
 * clear that it is empty rather than broken - a first-time reader has no way to
 * tell "you have no data" from "this is not working".
 *
 * So the page says what it will show, what the four skills mean, and where to
 * start. Nothing is invented to fill the space.
 */
function GettingStarted({ sessionCount, onStart }) {
  const early = sessionCount > 0

  return (
    <div className="rounded-2xl border border-border bg-card p-8">
      <div className="max-w-xl mx-auto text-center">
        <span className="text-4xl">🎯</span>
        <h2 className="text-lg font-bold mt-3 mb-2">
          {early ? 'Your results are starting to build' : 'Nothing to show yet — and that is expected'}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {early
            ? `You have completed ${sessionCount} session${sessionCount === 1 ? '' : 's'}. Scores appear straight away, but the trend line and the forecast need at least three before they mean anything — two points can only ever draw a straight line.`
            : 'This page fills in from your practice sessions. Complete one and your scores appear here immediately.'}
        </p>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 max-w-2xl mx-auto">
        {['vocal_command', 'speech_fluency', 'presence_engagement', 'emotional_intelligence'].map((key) => {
          const info = getInfo(key)
          return (
            <div key={key} className="rounded-xl border border-border p-3">
              <p className="text-sm font-semibold">{info.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{info.sub}</p>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-muted-foreground text-center mt-5 max-w-xl mx-auto leading-relaxed">
        Each session measures these four. You also rate yourself afterwards, and this
        page shows where the two disagree — which is usually the most useful thing on it.
      </p>

      <div className="flex justify-center mt-6">
        <button type="button" className="btn btn-primary" onClick={onStart}>
          Start a practice session
        </button>
      </div>
    </div>
  )
}

/**
 * Self-assessment patterns counted across sessions.
 *
 * Deliberately leads with a count rather than a magnitude. "20 of your 29
 * sessions" tells a learner whether this is a habit; "average gap 15" does not,
 * and worse, an average cancels when someone is wrong in both directions —
 * reporting a learner who is never right as perfectly self-aware.
 */
function RecurringPatterns({ items }) {
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const copy = PATTERN_COPY[item.pattern] || PATTERN_COPY.inconsistent
        const info = getInfo(item.skill_area)
        const pct = Math.round((item.gap_rate || 0) * 100)
        return (
          <div key={item.skill_area} className="rounded-xl border border-border p-3">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <p className="text-sm font-semibold">{info.label}</p>
              <span className="text-[11px] font-semibold" style={{ color: copy.tone }}>
                {item.sessions_with_gap} of {item.sessions_rated} sessions
              </span>
            </div>
            <p className="text-[11px] mb-2" style={{ color: copy.tone }}>{copy.label}</p>
            {/* The bar is the message: how much of this learner's history the
                pattern covers. The sentence explaining what to do about it lives
                on the Blind Spots page, which has room for four of them. */}
            <div className="h-1.5 rounded-full overflow-hidden bg-muted">
              <div className="h-full rounded-full" style={{ width: pct + '%', backgroundColor: copy.tone }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function AnalyticsDashboard() {
  const { userId: cid, userLabel, isAuthLoading, isAuthenticated } = useAnalyticsIdentity()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [userId, setUserId] = useState(cid || '')
  // ?sessionId=… (e.g. the redirect after self-reflection) opens that session's
  // results; without it the dashboard starts on the "All Sessions" overall view.
  const [sessionId, setSessionId] = useState(searchParams.get('sessionId') || '')
  const [sessOpts, setSessOpts] = useState([])
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // Observed scores only — what the session actually measured.
  //
  // These used to fall back to the learner's own rating when no measurement
  // existed. That made a self-rating masquerade as an observed score: the radar
  // drew both layers from the same number, every gap came out as zero, and the
  // page congratulated the learner for matching a performance it had never
  // measured. A skill with no measurement is now simply blank.
  const scores = useMemo(() => {
    const a = data?.aggregate?.scores?.averages || {}
    // Each composite skill is the mean of its underlying fields — identical to the
    // Skill Twin radar and Post-Session Report so the numbers agree across pages.
    return [
      ['vocal_command', toNum(a.speech_volume_score ?? a.professionalism_score)],
      ['speech_fluency', avgOf(a.speech_pace_score, a.clarity_score)],
      ['presence_engagement', avgOf(a.eye_contact_score, a.confidence_score) ?? toNum(a.adaptability_score)],
      ['emotional_intelligence', avgOf(a.empathy_score, a.emotional_control_score) ?? toNum(a.listening_score)],
    ].map(([k, v]) => ({ key: k, label: labelFor(k), value: toNum(v) }))
  }, [data])

  // Without a session selected the page is describing a history, not a moment.
  const isAllSessions = !sessionId

  // Per-skill history, keyed by skill. Absent while loading, or if the endpoint
  // fails — every use falls back to the averaged view rather than blanking.
  const history = useMemo(() => {
    const items = data?.history?.skills || []
    const byArea = Object.fromEntries(items.map((item) => [item.skill_area, item]))
    // Overall arrives separately because it is not one of the tracked skills, but
    // it is the same shape and the cards read it the same way.
    if (data?.history?.overall) byArea.overall = data.history.overall
    return byArea
  }, [data])

  // In history mode the headline figure is the latest session, not the mean of
  // every session. The mean was answering "how have you done", under a heading
  // that asks "how are you doing" — which let four consecutive declines read as
  // "Great job". The mean is still shown, beside it, where it belongs.
  const scoresShown = useMemo(() => {
    if (!isAllSessions || !data?.history) return scores
    return scores.map((s) => {
      const h = history[s.key]
      return h?.latest_score != null ? { ...s, value: h.latest_score } : s
    })
  }, [scores, history, isAllSessions, data])

  // Only patterns with enough sessions behind them; the service already drops
  // anything under three, and "aligned" is kept because a skill someone reads
  // accurately every time is worth telling them about.
  const recurring = useMemo(() => data?.recurring?.items || [], [data])

  // How many sessions this learner actually has. Drives whether the page shows
  // results or explains itself.
  const sessionCount = data?.aggregate?.scores?.metric_count ?? 0
  // Trends and forecasts need three points; below that the page would be drawing
  // conclusions from a line through two dots.
  const tooEarlyForTrends = isAllSessions && sessionCount > 0 && sessionCount < 3
  const showGettingStarted = status === 'live' && isAllSessions && sessionCount < 3

  // The single thing this learner should do next.
  //
  // The page was ending on "Emotional Intelligence is at high risk" and stopping
  // there. Telling someone their weakest skill is falling, and then offering no
  // route out of the page, leaves them with a worry and no action - which is a
  // worse outcome than not having told them.
  //
  // One item, not a list: a page that reports four problems at once is read as
  // four problems and acted on as none.
  const nextAction = useMemo(() => {
    if (!isAllSessions || sessionCount < 3) return null

    // A skill that is both falling and lowest is the clearest call. Failing that,
    // the self-assessment pattern that shows up most often.
    const falling = (data?.history?.skills || [])
      .filter((item) => item.trend_label === 'declining' && item.latest_score != null)
      .sort((a, b) => a.latest_score - b.latest_score)[0]

    if (falling) {
      return {
        tone: 'var(--danger)',
        title: `${labelFor(falling.skill_area)} needs your attention`,
        body: `Down from ${Math.round(falling.first_score ?? 0)} to ${Math.round(falling.latest_score)}. Your best was ${Math.round(falling.best_score ?? 0)}.`,
        cta: 'See what to practise',
        to: '/analytics-recommendations',
      }
    }

    const pattern = (data?.recurring?.items || []).find(
      (item) => item.pattern === 'consistent_overestimation' && item.severity !== 'none'
    )
    if (pattern) {
      return {
        tone: 'var(--warning, #d99a2b)',
        title: `You rate your ${labelFor(pattern.skill_area)} higher than it measures`,
        body: `In ${pattern.sessions_with_gap} of ${pattern.sessions_rated} sessions.`,
        cta: 'See what to practise',
        to: '/analytics-recommendations',
      }
    }

    return {
      tone: 'var(--success)',
      title: 'Nothing is slipping right now',
      body: 'Your skills are holding steady.',
      cta: 'Start another session',
      to: '/multimodal-analysis',
    }
  }, [data, isAllSessions, sessionCount])

  // A gap needs a measurement to compare against, not just a self-rating.
  const hasObserved = useMemo(() => scoresShown.some((s) => s.value !== null), [scoresShown])

  const hasLive = status !== 'live' || Boolean(data?.aggregate?.scores?.metric_count || data?.aggregate?.feedback?.total_count)

  const load = async (uid, sid) => {
    const tu = (uid||'').trim(), ts = (sid||'').trim()
    if (!tu) { setError('Please log in first.'); return }
    try {
      setStatus('loading')
      setError('')
      setMsg('')

      // 1. If a session is selected, trigger integration first to calculate real system scores
      if (ts) {
        const integrated = await integrateOnce(ts, () => pull(tu, ts))
        if (integrated) setMsg('Session data integrated!')
      }

      // 2. Fetch user-level totals
      const ag = await analyticsService.getAggregateByUser(tu).catch(() => null)
      let finalData = {
        aggregate: ag || { scores: { averages: {} }, feedback: { skill_rating_averages: {} } },
        blindSpots: { summary: { total_count: 0 }, blind_spots: [] },
        trends: { trends: [] },
        predictions: { predictions: [] }
      }

      // 3. If a session is selected, fetch the newly calculated session aggregate
      if (ts) {
        const [sessAg, bs, tr, pr] = await Promise.all([
          analyticsService.getAggregateBySession(ts).catch(() => null),
          analyticsService.getBlindSpotsBySession(ts).catch(() => null),
          analyticsService.getProgressTrendsByUser(tu, { session_id: ts }).catch(() => null),
          analyticsService.getPredictedOutcomesByUser(tu, { session_id: ts }).catch(() => null),
        ])

        finalData = {
          aggregate: sessAg || ag || finalData.aggregate,
          blindSpots: bs || { summary: { total_count: 0 }, blind_spots: [] },
          trends: tr || { trends: [] },
          predictions: pr || { predictions: [] }
        }
      } else {
        // "All Sessions" asks different questions from a single session, so it
        // loads different answers: where the learner is now against where they
        // started, and which self-assessment gaps recur rather than what the
        // average gap is. See learner_history_service for why averaging a
        // history is the wrong operation.
        const [bs, tr, pr, hist, recur] = await Promise.all([
          analyticsService.getBlindSpotsByUser(tu).catch(() => null),
          analyticsService.getProgressTrendsByUser(tu).catch(() => null),
          analyticsService.getPredictedOutcomesByUser(tu).catch(() => null),
          analyticsService.getSkillHistory(tu).catch(() => null),
          analyticsService.getRecurringBlindSpots(tu).catch(() => null),
        ])
        finalData.blindSpots = bs || { summary: { total_count: 0 }, blind_spots: [] }
        finalData.trends = tr || { trends: [] }
        finalData.predictions = pr || { predictions: [] }
        finalData.history = hist
        finalData.recurring = recur
      }

      setData(finalData)
      setStatus('live')
    } catch (error) {
      console.error('Load error:', error)
      setData(null)
      setStatus('error')
      setError('Could not connect to the real data API. Please check your backend connection.')
    }
  }

  const pull = async (tu, ts) => {
    try {
      const [sp,ap,ms] = await Promise.all([
        optionalRequest(()=>analyticsService.getComponentSurveyProfile()),
        optionalRequest(()=>analyticsService.getComponentAdaptivePlan()),
        optionalRequest(()=>analyticsService.getComponentMcaSessions()),
      ])
      const mcs = selectMcaSession(ms.data,ts), nudges = normalizeMcaSessionNudges(mcs)
      // Use the MCA-computed skill scores only when the selected session is that MCA session.
      const isSelectedMca = mcs && String(mcs.id) === String(ts)
      const mcaSkillScores = isSelectedMca ? normalizeMcaSkillScores(mcs) : null
      const mcaOverallScore = isSelectedMca ? normalizeMcaOverallScore(mcs) : null
      const src = { surveyProfile:sp, adaptivePlan:ap, mcaNudges:{ok:nudges.length>0||Boolean(mcaSkillScores),data:nudges} }
      if (!hasPulledComponentData(src)) return {integrated:false}
      await analyticsService.integrateCompletedSession({
        user_id:tu, session_id:ts,
        scenario_id: scenarioIdOf(ap.data?.primary_scenario),
        skill_type: ap.data?.skill||'communication',
        survey_profile:normalizeSurveyProfile(sp.data), adaptive_plan:normalizeAdaptivePlan(ap.data),
        mca_nudges:normalizeMcaNudges(nudges),
        mca_skill_scores: mcaSkillScores || undefined,
        mca_overall_score: mcaOverallScore ?? undefined,
      })
      return {integrated:true}
    } catch { return {integrated:false} }
  }

  const loadSess = async () => {
    try {
      const o = await loadComponentSessionOptions(analyticsService, cid)
      setSessOpts(o); return o
    } catch { return [] }
  }

  useEffect(() => { if(!isAuthLoading&&isAuthenticated&&cid) { setUserId(cid); loadSess() } }, [cid,isAuthLoading,isAuthenticated])

  // Load whatever the dropdown points at — '' means "All Sessions" (user-level
  // overall totals), a session id means that session's own results. Runs on mount
  // (honouring ?sessionId=) and again whenever the selection changes.
  useEffect(() => { if(!isAuthLoading&&isAuthenticated&&cid) load(cid,sessionId) }, [cid,isAuthLoading,isAuthenticated,sessionId])

  const preds = Array.isArray(data?.predictions?.predictions) ? data.predictions.predictions : []
  const gaps = Array.isArray(data?.blindSpots?.blind_spots) ? data.blindSpots.blind_spots : []
  const trends = Array.isArray(data?.trends?.trends) ? data.trends.trends : []
  // Only the learner's own self-assessments.
  //
  // This tile used to read "Feedback 316 · Self 41 · System 275". The 275 were
  // internal rows - one per MCA nudge, per adaptive-plan note, per survey
  // profile - and calling them "feedback" invited the obvious question: what
  // feedback did the system give me, and where do I read it? There is no such
  // screen; they are inputs to a score, not messages to a person.
  //
  // Counted by session rather than by row: a self-assessment is stored as four
  // rows, one per skill, so 41 sessions rated would otherwise read as 164.
  const fb = data?.aggregate?.feedback || {}
  const fbSelf = fb.self_session_count || 0
  const fbTotal = fbSelf
  // One sentence telling a first-time reader what the headline number is. The
  // number alone invites the wrong reading: people assume a single score out of
  // 100 is a grade, and act on it accordingly.
  //
  // It no longer says "averaged". The headline is the engine's own overall score
  // for the session, so a caption promising the mean of the four cards below
  // would describe an arithmetic the reader can then fail to reproduce - the two
  // differ by up to 13.5 points on a single session.
  const overallCaption = isAllSessions
    ? 'The overall score from your most recent session'
    : 'The overall score from this session'

  // The multimodal engine's own overall score for the session, not the mean of
  // the four cards beside it.
  //
  // It used to be that mean, which had the appeal of always adding up on screen
  // and the flaw of being a number the session never produced. The engine weights
  // its dimensions its own way; across this account the two disagree on 37 of 99
  // sessions and by as much as 13.5 points on one. Where a teammate's screen and
  // this one both say "overall score" about the same session, they have to be
  // saying it about the same number.
  //
  // Selected session -> that session's stored score. All Sessions -> the stored
  // score of the most recent one, matching the skill cards, which are also the
  // latest rather than an average. The mean survives only as a fallback for a
  // session that stored no overall of its own.
  const overallHistory = data?.history?.overall || null

  const overall = useMemo(() => {
    const stored = isAllSessions
      ? overallHistory?.latest_score
      : data?.aggregate?.scores?.averages?.overall_score
    if (stored != null) return Math.round(Number(stored))
    const vals = scoresShown.map(s => s.value).filter(v => v != null)
    if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
    return fmtScore(data?.aggregate?.feedback?.average_rating)
  }, [scoresShown, data, isAllSessions, overallHistory])

  // The same engine score averaged over every session instead of the most recent
  // one. Same source as `overall`, so the two can be compared and subtracted.
  //
  // It exists because the headline figure is one session, and one session is a
  // day rather than a level. This learner sits at 82 over 114 sessions and at 61
  // in the latest; showing only the 61 reports a bad morning as a standing, and
  // showing only the 82 was the bug that let four consecutive declines read as
  // "Great job". Neither number is the answer on its own.
  const lifetimeOverall = useMemo(() => {
    if (!isAllSessions || overallHistory?.average_score == null) return null
    return Math.round(Number(overallHistory.average_score))
  }, [overallHistory, isAllSessions])

  // Below this the two figures are the same number to a reader, and the
  // comparison is noise rather than news.
  const overallGap = lifetimeOverall == null ? 0 : Number(overall) - lifetimeOverall
  const gapIsWorthSaying = Math.abs(overallGap) >= 5

  // The sentence under the score used to read the headline alone, which is one
  // session. A learner sitting at 82 over a hundred sessions got "Every session
  // makes you better!" for a single bad morning - encouraging, and wrong about
  // them. Where the two figures disagree, the gap is the thing worth saying, and
  // saying it is more use than either cheering or consoling.
  const overallMessage = useMemo(() => {
    const latest = Number(overall)
    if (lifetimeOverall != null && gapIsWorthSaying) {
      return overallGap < 0
        ? `This session came in ${Math.abs(overallGap)} points below your usual ${lifetimeOverall}. One session is a day, not a level.`
        : `This session ran ${overallGap} points above your usual ${lifetimeOverall}. Worth knowing what you did differently.`
    }
    if (lifetimeOverall != null) {
      return `Right about where you usually land. Steady is its own result.`
    }
    if (latest >= 75) return 'Great job! Keep it up!'
    if (latest >= 50) return 'Good progress. Keep practising!'
    return 'Every session makes you better!'
  }, [overall, lifetimeOverall, overallGap, gapIsWorthSaying])

  // Build self-rating scores from feedback averages + blind spot data for dual-layer radar.
  //
  // These are means of every self-rating the learner has given. For one session
  // that is exactly right. Across a whole history it is not: this learner rates
  // themselves high in some sessions and low in others for three of four skills,
  // so the mean lands near the middle and draws a steady self-perception that
  // does not exist. The honest version of self-versus-observed over a history is
  // the recurring-patterns panel, which counts rather than averages, so the
  // second radar layer is dropped in that mode rather than faked.
  const selfScores = useMemo(() => {
    const f = data?.aggregate?.feedback?.skill_rating_averages || {}
    const b = data?.blindSpots?.blind_spots || []
    
    // Normalize self-ratings to the primary keys
    return [
      ['vocal_command', f.vocal_command ?? f.speech_volume_score ?? f.professionalism_score ?? (b.find(x=>getInfo(x.skill_area).key==='vocal_command')?.self_rating)],
      ['speech_fluency', f.speech_fluency ?? f.speech_pace_score ?? f.clarity_score ?? (b.find(x=>getInfo(x.skill_area).key==='speech_fluency')?.self_rating)],
      ['presence_engagement', f.presence_engagement ?? f.eye_contact_score ?? f.confidence_score ?? (b.find(x=>getInfo(x.skill_area).key==='presence_engagement')?.self_rating)],
      ['emotional_intelligence', f.emotional_intelligence ?? f.empathy_score ?? f.emotional_control_score ?? (b.find(x=>getInfo(x.skill_area).key==='emotional_intelligence')?.self_rating)],
    ].map(([k, v]) => ({ key: k, label: labelFor(k), value: toNum(v) }))
     .filter(s => s.value !== null)
  }, [data])

  // Whether the learner rated themselves at all. Without this, "no gaps found"
  // and "nothing to compare" look identical on screen, and the dashboard ends up
  // congratulating people on self-awareness they never demonstrated.
  const hasSelfRating = selfScores.length > 0

  // What the radar draws. In history mode the observed layer is the latest
  // session, matching the cards above it, and the averaged self layer is left
  // off — see the note on selfScores.
  const radarSelfScores = isAllSessions ? [] : selfScores

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">Feedback System & Predictive Analytics</p>
            <h1 className="text-lg font-bold">My Skills Dashboard</h1>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <AnalyticsSessionSelect
              value={sessionId}
              options={sessOpts}
              onChange={setSessionId}
              minWidthClass="min-w-72"
              allOptionLabel="All Sessions"
            />
            <AnalyticsLoadButton
              loading={status==='loading'}
              onClick={()=>load(userId,sessionId)}
            />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border border-border bg-muted">
            <span className={'h-2 w-2 rounded-full '+(status==='live'?'bg-success':status==='loading'?'bg-info animate-pulse':'bg-muted-foreground')}/>
            {status==='live'?'Live Data':status==='loading'?'Loading…':status==='error'?'Unavailable':'Not loaded'}
          </span>
          {/* REDESIGN: text-red-400/bg-red-400 → danger tokens; text-green-400/bg-green-400 → success tokens */}
          {error && <span className="text-xs text-danger bg-danger/10 border border-danger/20 px-3 py-1 rounded-full">{error}</span>}
          {msg && <span className="text-xs text-success bg-success/10 border border-success/20 px-3 py-1 rounded-full">{msg}</span>}
        </div>

        {/* REDESIGN: yellow-500 banner replaced with Banner warning */}
        {!hasLive && !showGettingStarted && (
          <div className="banner banner-warning" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }}/>
            <span>Complete a practice session to see your real results here.</span>
          </div>
        )}

        {/* With fewer than three sessions the panels below would be mostly empty
            boxes and a two-point trend line. The page explains itself instead. */}
        {showGettingStarted ? (
          <GettingStarted sessionCount={sessionCount} onStart={() => navigate('/multimodal-analysis')} />
        ) : (
        <>

        {/* REDESIGN: big score banner replaced hex gradient (#4f46e5/#7c3aed) + text-white
            with var(--gradient-accent) + tokenised text colors */}
        <div
          className="rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6"
          style={{ background: 'var(--gradient-accent)' }}
        >
          <div className="flex-1" style={{ color: 'white' }}>
            <p style={{ color: 'rgba(255,255,255,0.85)' }} className="text-sm font-medium mb-1">Your Overall Score</p>
            <div className="flex items-end gap-2">
              <span className="score-num" style={{ fontSize: 60, fontWeight: 600, lineHeight: 1 }}>{overall}</span>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 20, marginBottom: 6 }}>/100</span>
            </div>
            {/* Where the number came from, before any encouragement about it. A
                score out of 100 with no source reads as a grade, and a first-time
                reader has no way to tell whether it is one session or a year. */}
            <p style={{ color: 'rgba(255,255,255,0.75)' }} className="text-xs mt-1">{overallCaption}</p>

            {/* The lifetime figure sits beside the headline rather than under the
                skill cards, because the headline is the number people quote and
                one session is not a standing. Shown whenever all four skills have
                a history to average; the size of the gap decides what the
                sentence below says, not whether this appears. */}
            {lifetimeOverall != null && (
              <div
                className="flex items-center gap-2 mt-3 rounded-lg px-3 py-2"
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.18)' }}
              >
                <span className="score-num" style={{ fontSize: 22, fontWeight: 600 }}>{lifetimeOverall}</span>
                {/* The count can be named here, and only here. Every session
                    stores an overall score, so this average really does cover all
                    of them. The four skill averages do not: a channel that
                    recorded nothing leaves the session out of that skill rather
                    than scoring it zero, and on this account they run 93, 76, 99
                    and 99 out of 114. Each card carries its own count. */}
                <span style={{ color: 'rgba(255,255,255,0.8)' }} className="text-xs">
                  your average across {overallHistory?.session_count ?? sessionCount} sessions
                </span>
              </div>
            )}

            <p style={{ color: 'rgba(255,255,255,0.85)' }} className="text-sm mt-2">
              {overallMessage}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center" style={{ color: 'white' }}>
            {[
              // Sessions = user's lifetime total when no session is selected, or the
              // selected session's count when one is chosen (aggregate scope follows the selection).
              { l: 'Sessions', v: data?.aggregate?.scores?.metric_count || 0 },
              {
                l: 'Self-Assessments',
                v: fbTotal,
                sub: sessionCount ? `of ${sessionCount} sessions` : null,
              },
              { l: 'Insights', v: preds.length },
            ].map(x =>
              <div
                key={x.l}
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.18)' }}
              >
                <div className="score-num" style={{ fontSize: 22, fontWeight: 600 }}>{x.v}</div>
                <div className="t-cap" style={{ color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>{x.l}</div>
                {x.sub && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 3, lineHeight: 1.3 }}>{x.sub}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* What to do about all this. Sits directly under the score, before the
            detail: someone who reads one thing on this page should read this. */}
        {nextAction && (
          <div
            className="rounded-2xl border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-4"
            style={{ borderColor: nextAction.tone }}
          >
            <div className="flex-1">
              <p className="text-sm font-bold mb-1" style={{ color: nextAction.tone }}>
                {nextAction.title}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{nextAction.body}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary shrink-0"
              onClick={() => navigate(nextAction.to)}
            >
              {nextAction.cta}
            </button>
          </div>
        )}

        {/* Skill Score Cards */}
        <div>
          <h2 className="text-base font-bold mb-3">
            📊 Your Skill Scores
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            {isAllSessions ? 'Your latest session, out of 100' : 'This session, out of 100'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[...scoresShown, { key:'overall', label:'Overall Score', value: Number(overall) || 0 }].map((s,i) => {
              const h = isAllSessions ? history[s.key] : null
              // A measured zero and nothing measured are different facts, and
              // this card used to state both as "--". Scoring is by penalty, so
              // zero is a real and reachable result - a session that produced no
              // usable audio at all lands there - and showing it as the
              // no-data dash tells a learner their worst session was never
              // recorded. Everything below keys off `measured`, not off `v > 0`.
              const measured = s.value != null
              const v = measured ? Math.round(s.value) : null
              const isOverall = s.key === 'overall'
              const emoji = isOverall ? '🎯' : !measured ? '❓' : v >= 75 ? '🌟' : v >= 50 ? '👍' : '💪'
              const barColor = isOverall ? '#8b5cf6' : !measured ? '#6b7280' : v >= 75 ? '#10b981' : v >= 50 ? '#6366f1' : '#f59e0b'
              return (
                <div key={s.key} className={`rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors ${isOverall ? 'ring-2 ring-primary/20' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg">{emoji}</span>
                    <span className="text-xl font-bold" style={{color: barColor}}>{measured ? v : '--'}</span>
                  </div>
                  <div className="mb-2">
                    <p className="text-sm font-semibold">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground italic leading-none">{subFor(s.key)}</p>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-muted">
                    <motion.div initial={{width:0}} animate={{width:(measured ? v : 0)+'%'}} transition={{duration:0.8,delay:i*0.05}}
                      className="h-full rounded-full" style={{backgroundColor: barColor}}/>
                  </div>
                  {/* The number above is one session. Without the average and the
                      best beside it, a good day reads as a level and a bad one
                      reads as a collapse. */}
                  {h ? (
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>best {Math.round(h.best_score ?? 0)}</span>
                      <span>avg {Math.round(h.average_score ?? 0)}</span>
                      <span style={{ color: TREND_TONE[h.trend_label] }}>{TREND_MARK[h.trend_label]}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        {/* Radar + Blind Spots */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-base font-bold">🕸️ Skill Overview Chart</h2>
              <MoreLink to="/analytics-skill-twin" onOpen={(path) => navigate(path)} />
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {radarSelfScores.length > 0
                ? 'Teal = measured · Amber = your rating'
                : 'All four skills in one shape'}
            </p>
            <SkillTwinRadar
              scores={scoresShown}
              selfScores={radarSelfScores}
              overallScore={overall}
            />
            {isAllSessions && selfScores.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Your ratings are in the panel beside this one, counted per session.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-base font-bold">🔍 Things to Know About Yourself</h2>
              <MoreLink to="/analytics-blind-spots" onOpen={(path) => navigate(path)} />
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {isAllSessions
                ? 'How often your rating missed the mark'
                : 'Your rating vs what was measured'}
            </p>
            {/* A gap needs two sides. With no self-assessment there is nothing to
                compare, and saying "your self-view matches" would be claiming a
                finding the data cannot support.

                The three empty states below are reached in both modes. Recurring
                patterns need three sessions, so a learner with fewer falls
                through to them with "All Sessions" selected - and was then told
                about "this session", which is not what they are looking at. */}
            {isAllSessions && recurring.length > 0 ? (
              <RecurringPatterns items={recurring} />
            ) : !hasObserved ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="text-4xl mb-3">📊</span>
                <p className="font-semibold fg">
                  {isAllSessions ? 'No measured scores yet' : 'This session has no measured scores yet'}
                </p>
                <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                  {isAllSessions
                    ? 'A gap is your rating measured against what a session recorded. Without a measurement there is nothing to compare your ratings with.'
                    : 'A gap is your rating measured against what the session recorded. Without the measurement there is nothing to compare your rating with.'}
                </p>
              </div>
            ) : !hasSelfRating ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="text-4xl mb-3">📝</span>
                <p className="font-semibold fg">
                  {isAllSessions ? 'No self-assessments yet' : 'No self-assessment for this session yet'}
                </p>
                <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                  {isAllSessions
                    ? 'Rate yourself after a session and your ratings will be compared with what was measured, to show where the two disagree.'
                    : 'Rate yourself on this session and your ratings will be compared with what was measured, to show where the two disagree.'}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary mt-4"
                  onClick={() => navigate(
                    sessionId
                      ? `/analytics/sessions/${encodeURIComponent(sessionId)}/feedback`
                      : '/analytics-feedback'
                  )}
                >
                  Add your self-assessment
                </button>
              </div>
            ) : gaps.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="text-4xl mb-3">🎯</span>
                <p className="font-semibold fg">Your self-view matches your performance!</p>
                <p className="text-muted-foreground text-sm mt-1">
                  {isAllSessions
                    ? 'No gaps found across your sessions so far. Great self-awareness!'
                    : 'No gaps detected for this session. Great self-awareness!'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {gaps.map((b, i) => {
                  const isOver = b.blind_spot_type === 'overestimation'
                  // `??`, not `||`: a self-rating of 0 is a rating, and with `||`
                  // it fell through to the entry's own copy of the number - or to
                  // nothing, printing "--" beside a gap that was calculated from
                  // the very value being hidden.
                  const selfVal = selfScores.find(s => getInfo(s.key).key === getInfo(b.skill_area).key)?.value ?? b.self_rating
                  return (
                    <div key={i} className="rounded-xl p-4 border" style={{
                      borderColor: isOver ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)',
                      background: isOver ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.08)',
                    }}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-bold text-sm fg">{isOver ? '⬇️' : '⬆️'} {labelFor(b.skill_area)}</span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-tight" style={{
                          background: isOver ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)',
                          color: isOver ? '#fca5a5' : '#93c5fd',
                        }}>
                          {isOver ? 'Overestimated' : 'Underestimated'}
                        </span>
                      </div>
                      <div className="flex gap-3 mb-3">
                        <div className="flex-1 rounded-lg p-3 text-center border border-border bg-background/50">
                          <p className="text-[10px] text-muted-foreground uppercase mb-1">Your Rating</p>
                          <p className="text-2xl font-bold text-warning">{fmtScore(selfVal)}</p>
                        </div>
                        <div className="flex-1 rounded-lg p-3 text-center border border-border bg-background/50">
                          <p className="text-[10px] text-muted-foreground uppercase mb-1">AI Observed</p>
                          <p className="text-2xl font-bold text-info">{fmtScore(b.comparison_score)}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed italic">" {b.recommendation} "</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Progress Trends */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-base font-bold">📈 How You Are Improving Over Time</h2>
              <MoreLink to="/analytics-progress-trends" onOpen={(path) => navigate(path)} />
            </div>
          <p className="text-xs text-muted-foreground mb-4">Every session, oldest first. Up is better.</p>
          <div className="min-h-[280px]">
            <ProgressTrendVisualization trends={trends} labelFor={labelFor} />
          </div>
        </div>

        {/* Predictions */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-base font-bold">🔮 What to Expect Next</h2>
              <MoreLink to="/analytics-predictions" onOpen={(path) => navigate(path)} />
            </div>
          <p className="text-xs text-muted-foreground mb-4">Where each skill lands if nothing changes.</p>
          {preds.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-4xl block mb-2">🤖</span>
              <p className="text-muted-foreground text-sm">Complete more sessions to get predictions</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {preds.slice(0, 4).map((p, i) => {
                // Direction comes from the two numbers on the card, not from
                // trend_label. Those disagree: the label describes the history,
                // the forecast describes what comes next, and a rising history
                // can still be forecast to fall. Read from the label, a card
                // showing 100 → 85 came out green, headed "Looking good!", with
                // an upward arrow over a fifteen-point drop.
                const now = toNum(p.current_score)
                const next = toNum(p.predicted_score)
                const delta = now != null && next != null ? next - now : null
                // Half a point is rounding, not a direction.
                const dir = delta == null
                  ? (p.trend_label === 'improving' ? 'up' : 'down')
                  : delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat'
                const up = dir === 'up'
                const tone = up ? '16,185,129' : dir === 'flat' ? '99,102,241' : p.risk_level === 'high' ? '239,68,68' : '245,158,11'
                const borderColor = `rgba(${tone},0.3)`
                const bgColor = `rgba(${tone},0.08)`
                const headline = up ? 'Looking good!' : dir === 'flat' ? 'Holding steady' : 'Needs attention'
                return (
                  <div key={i} className="rounded-xl p-4 border" style={{borderColor, background: bgColor}}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">{up ? '📈' : dir === 'flat' ? '➡️' : '⚠️'}</span>
                      <div>
                        <p className="font-bold text-sm">{labelFor(p.predicted_skill)}</p>
                        <p className="text-xs text-muted-foreground">{headline}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-1 text-center rounded-lg py-2 border border-border bg-muted/50">
                        <p className="text-[10px] text-muted-foreground uppercase">Now</p>
                        <p className="text-lg font-bold">{fmtScore(p.current_score)}</p>
                      </div>
                      <span className="text-muted-foreground font-bold">→</span>
                      <div className="flex-1 text-center rounded-lg py-2 border border-border bg-muted/50">
                        <p className="text-[10px] text-muted-foreground uppercase">Predicted</p>
                        <p className="text-lg font-bold" style={{color: up ? '#10b981' : dir === 'flat' ? '#6366f1' : '#ef4444'}}>{fmtScore(p.predicted_score)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">💡 {p.recommendation}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </>
        )}

      </div>
    </div>
  )
}

function merge(agg, ss) {
  if (!ss?.skill_scores) return agg; const s = ss.skill_scores
  return {...agg, scores:{...agg?.scores, averages:{...agg?.scores?.averages, confidence_score:s.confidence, clarity_score:s.communication_clarity, empathy_score:s.empathy, listening_score:s.active_listening, adaptability_score:s.adaptability, emotional_control_score:s.emotional_control, professionalism_score:s.professionalism, overall_score:ss.overall_score}}}
}
