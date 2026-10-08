import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsLoadButton from './AnalyticsLoadButton'
import AnalyticsSessionSelect from './AnalyticsSessionSelect'
import { useAnalyticsIdentity } from './analyticsAuth'
import {
  hasPulledComponentData, loadComponentSessionOptions,
  normalizeAdaptivePlan, normalizeMcaNudges, normalizeMcaOverallScore,
  normalizeMcaSessionNudges, normalizeMcaSkillScores,
  normalizeSurveyProfile,
  integrateOnce, optionalRequest, scenarioIdOf, selectMcaSession,
  selectPreferredComponentSession,
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

// Wording for a pattern across sessions, not a verdict on one session.
const PATTERN_COPY = {
  consistent_overestimation: {
    label: 'Rates higher than measured, almost every time',
    tone: 'var(--danger-text)',
  },
  consistent_underestimation: {
    label: 'Rates lower than measured, almost every time',
    tone: 'var(--warning-text)',
  },
  inconsistent: {
    label: 'Sometimes high, sometimes low',
    tone: 'var(--warning-text)',
  },
  aligned: {
    label: 'Reads this one accurately, session after session',
    tone: 'var(--success-text)',
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
    return { ...res, key: item }
  }
  return { ...item, key: v }
}

const labelFor = (v) => getInfo(v).label
const subFor = (v) => getInfo(v).sub
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
// Valid numbers only, so a skill reads the same here as on the Skill Twin and
// Post-Session Report pages.
const avgOf = (...vals) => {
  const nums = vals.map(toNum).filter((n) => n !== null)
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null
}
const fmtScore = (v) => (v == null || isNaN(Number(v))) ? '--' : Math.round(Number(v))

// Every panel here is a glance; this opens the page that explains it.
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

// Shown instead of the dashboard when there is too little history to fill it.
// A grid of empty boxes reads as broken rather than as empty.
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

// Counts, not averages: an average cancels out someone who is wrong in both
// directions and reports them as self-aware.
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
  const { userId: cid, isAuthLoading, isAuthenticated } = useAnalyticsIdentity()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [userId, setUserId] = useState(cid || '')
  // ?sessionId=… opens that session; otherwise the newest is picked in loadSess.
  const [sessionId, setSessionId] = useState(searchParams.get('sessionId') || '')
  const [sessOpts, setSessOpts] = useState([])
  // Session list has arrived, so the first load knows which session to ask for.
  const [sessReady, setSessReady] = useState(false)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // Measured scores only. Never falls back to a self-rating: that would compare
  // the learner's rating with itself and report every gap as zero.
  const scores = useMemo(() => {
    const a = data?.aggregate?.scores?.averages || {}
    return [
      ['vocal_command', toNum(a.speech_volume_score ?? a.professionalism_score)],
      ['speech_fluency', avgOf(a.speech_pace_score, a.clarity_score)],
      ['presence_engagement', avgOf(a.eye_contact_score, a.confidence_score) ?? toNum(a.adaptability_score)],
      ['emotional_intelligence', avgOf(a.empathy_score, a.emotional_control_score) ?? toNum(a.listening_score)],
    ].map(([k, v]) => ({ key: k, label: labelFor(k), value: toNum(v) }))
  }, [data])

  // No session selected. The dropdown always offers one, so this is the fallback
  // for a session list that failed to load.
  const isAllSessions = !sessionId

  // Per-skill lifetime history, keyed by skill. Absent while loading or on error.
  const history = useMemo(() => {
    const items = data?.history?.skills || []
    const byArea = Object.fromEntries(items.map((item) => [item.skill_area, item]))
    // Overall arrives separately; same shape, so the cards read it the same way.
    if (data?.history?.overall) byArea.overall = data.history.overall
    return byArea
  }, [data])

  // A selected session shows that session; the fallback view averages instead.
  const scoresShown = useMemo(() => {
    if (!isAllSessions || !data?.history) return scores
    return scores.map((s) => {
      const h = history[s.key]
      return h?.average_score != null ? { ...s, value: h.average_score } : s
    })
  }, [scores, history, isAllSessions, data])

  // The service already drops patterns with fewer than three sessions behind them.
  const recurring = useMemo(() => data?.recurring?.items || [], [data])

  // The learner's whole history, not the selected session's row count.
  const sessionCount = data?.lifetimeSessions ?? data?.aggregate?.scores?.metric_count ?? 0
  const showGettingStarted = status === 'live' && sessionCount < 3

  // The one thing worth acting on, with the reason under it. One item, not a
  // list: a page reporting four problems at once is acted on as none.
  const nextAction = useMemo(() => {
    if (!data) return null

    // Across sessions the useful thing is a direction of travel; within one
    // session it is what happened in it. Neither can be read from the other.
    if (isAllSessions) {
      if (sessionCount < 3) return null

      const falling = (data?.history?.skills || [])
        .filter((item) => item.trend_label === 'declining' && item.latest_score != null)
        .sort((a, b) => a.latest_score - b.latest_score)[0]

      if (falling) {
        return {
          tone: 'var(--danger-text)',
          title: `${labelFor(falling.skill_area)} has been sliding`,
          body: `Across your sessions it has fallen to ${Math.round(falling.latest_score)}, from a best of ${Math.round(falling.best_score ?? falling.latest_score)}.`,
          cta: 'See what to practise',
          to: '/analytics-recommendations',
        }
      }

      const pattern = (data?.recurring?.items || []).find(
        (item) => item.pattern === 'consistent_overestimation' && item.severity !== 'none'
      )
      if (pattern) {
        return {
          tone: 'var(--warning-text)',
          title: `You rate your ${labelFor(pattern.skill_area)} higher than it measures`,
          body: `This has come up in ${pattern.sessions_with_gap} of ${pattern.sessions_rated} sessions you rated.`,
          cta: 'See what to practise',
          to: '/analytics-recommendations',
        }
      }

      return {
        tone: 'var(--success-text)',
        title: 'Nothing is slipping right now',
        body: 'None of your four skills is trending down across your sessions.',
        cta: 'Start another session',
        to: '/multimodal-analysis',
      }
    }

    // 1. The widest overestimation. blind_spot_service has already applied its
    //    gap threshold, so this picks rather than re-decides what counts.
    const over = (data?.blindSpots?.blind_spots || [])
      .filter((g) => g.blind_spot_type === 'overestimation' && g.gap != null)
      .sort((a, b) => b.gap - a.gap)[0]

    if (over) {
      return {
        tone: 'var(--warning-text)',
        title: `You rated ${labelFor(over.skill_area)} higher than it measured`,
        body: `You gave it ${Math.round(over.self_rating)}; this session measured ${Math.round(over.comparison_score)}.`,
        cta: 'See what to practise',
        to: '/analytics-recommendations',
      }
    }

    // 2. Otherwise the weakest skill, but only if it is genuinely weak - something
    //    is always lowest. 50 is the boundary the score cards below already use.
    const measured = scoresShown.filter((sk) => sk.value != null)
    if (!measured.length) return null

    const weakest = [...measured].sort((a, b) => a.value - b.value)[0]
    if (weakest.value < 50) {
      return {
        tone: 'var(--danger-text)',
        title: `${weakest.label} needs your attention`,
        body: `It measured ${Math.round(weakest.value)} out of 100 in this session - your lowest of the four.`,
        cta: 'See what to practise',
        to: '/analytics-recommendations',
      }
    }

    return {
      tone: 'var(--success-text)',
      title: 'Nothing stands out in this session',
      body: `Your lowest was ${weakest.label} at ${Math.round(weakest.value)} out of 100.`,
      cta: 'Start another session',
      to: '/multimodal-analysis',
    }
  }, [data, scoresShown, isAllSessions, sessionCount])

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
      // Or the previous session's numbers sit under the new session's name.
      setData(null)

      // 1. If a session is selected, trigger integration first to calculate real system scores
      if (ts) {
        const integrated = await integrateOnce(ts, () => pull(tu, ts))
        if (integrated) setMsg('Session data integrated!')
      }

      // 2. Fetch user-level totals
      const ag = await analyticsService.getAggregateByUser(tu).catch(() => null)
      // Kept aside: the session aggregate below replaces `aggregate`, and its
      // metric_count is 1 - rows for that session, not the learner's history.
      const lifetimeSessions = ag?.scores?.metric_count ?? 0
      let finalData = {
        lifetimeSessions,
        aggregate: ag || { scores: { averages: {} }, feedback: { skill_rating_averages: {} } },
        blindSpots: { summary: { total_count: 0 }, blind_spots: [] },
        trends: { trends: [] },
        predictions: { predictions: [] }
      }

      // 3. The selected session's own results. The skill history comes too: it is
      //    what puts the session's numbers in context on the cards below.
      if (ts) {
        const [sessAg, bs, tr, pr, hist] = await Promise.all([
          analyticsService.getAggregateBySession(ts).catch(() => null),
          analyticsService.getBlindSpotsBySession(ts).catch(() => null),
          analyticsService.getProgressTrendsByUser(tu, { session_id: ts }).catch(() => null),
          analyticsService.getPredictedOutcomesByUser(tu, { session_id: ts }).catch(() => null),
          analyticsService.getSkillHistory(tu).catch(() => null),
        ])

        finalData = {
          lifetimeSessions,
          aggregate: sessAg || ag || finalData.aggregate,
          blindSpots: bs || { summary: { total_count: 0 }, blind_spots: [] },
          trends: tr || { trends: [] },
          predictions: pr || { predictions: [] },
          history: hist,
        }
      } else {
        // Different questions, so different answers: which gaps recur, rather
        // than what the average gap is. See learner_history_service.
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
      setError("We couldn't load your data. Try again in a moment.")
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
      setSessOpts(o)
      // Same helper the other analytics pages use, so they all open on the same
      // session.
      setSessionId((current) => {
        if (current) return current
        const preferred = selectPreferredComponentSession(o)
        return preferred ? preferred.id : current
      })
      return o
    } catch {
      return []
    } finally {
      // However it ends - an empty list is an answer, and waiting for one that
      // never comes leaves the page on "loading".
      setSessReady(true)
    }
  }

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !cid) return
    setUserId(cid)
    setSessReady(false)
    loadSess()
  }, [cid, isAuthLoading, isAuthenticated])

  // Waits for sessReady, or it fires on mount with sessionId still '' and loads
  // the user-level totals under a session's name before correcting itself.
  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !cid || !sessReady) return
    load(cid, sessionId)
  }, [cid, isAuthLoading, isAuthenticated, sessionId, sessReady])

  const preds = Array.isArray(data?.predictions?.predictions) ? data.predictions.predictions : []
  const gaps = Array.isArray(data?.blindSpots?.blind_spots) ? data.blindSpots.blind_spots : []
  const trends = Array.isArray(data?.trends?.trends) ? data.trends.trends : []
  const overallHistory = data?.history?.overall || null

  // Names the time basis rather than the arithmetic: the headline is the engine's
  // own score, not the mean of the four cards below.
  const overallCaption = isAllSessions
    ? `Averaged across your ${overallHistory?.session_count ?? sessionCount} sessions`
    : 'The overall score from this session'

  const overall = useMemo(() => {
    const stored = isAllSessions
      ? overallHistory?.average_score
      : data?.aggregate?.scores?.averages?.overall_score
    if (stored != null) return Math.round(Number(stored))
    const vals = scoresShown.map(s => s.value).filter(v => v != null)
    if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
    // A number or null, never "--": callers subtract from this, and
    // `Number('--') || 0` turns "not measured" into a measured zero.
    const fallback = data?.aggregate?.feedback?.average_rating
    return fallback == null || isNaN(Number(fallback)) ? null : Math.round(Number(fallback))
  }, [scoresShown, data, isAllSessions, overallHistory])

  // Shown beside the average, because neither answers alone: an average hides a
  // run of declines, a latest score reports one bad day as a standing.
  const latestOverall = useMemo(() => {
    if (!isAllSessions || overallHistory?.latest_score == null) return null
    return Math.round(Number(overallHistory.latest_score))
  }, [overallHistory, isAllSessions])

  // Below 5 points the two are the same number to a reader.
  const overallGap = latestOverall == null || overall == null ? 0 : latestOverall - Number(overall)
  const gapIsWorthSaying = Math.abs(overallGap) >= 5

  // Where the two figures disagree the gap is worth more than encouragement. The
  // cheerful lines are reached only when there is no second figure to compare.
  const overallMessage = useMemo(() => {
    const v = Number(overall)
    if (latestOverall != null && gapIsWorthSaying) {
      return overallGap < 0
        ? `Your most recent session came in ${Math.abs(overallGap)} points below this average. One session is a day, not a level.`
        : `Your most recent session ran ${overallGap} points above this average. Worth knowing what you did differently.`
    }
    if (latestOverall != null) {
      return 'Your most recent session landed right about here. Steady is its own result.'
    }
    if (!Number.isFinite(v)) return 'No overall score was recorded for this session.'
    if (v >= 75) return 'Great job! Keep it up!'
    if (v >= 50) return 'Good progress. Keep practising!'
    return 'Every session makes you better!'
  }, [overall, latestOverall, overallGap, gapIsWorthSaying])

  // The learner's own ratings, for the second radar layer.
  const selfScores = useMemo(() => {
    const f = data?.aggregate?.feedback?.skill_rating_averages || {}
    const b = data?.blindSpots?.blind_spots || []
    
    // Normalised onto the four primary keys.
    return [
      ['vocal_command', f.vocal_command ?? f.speech_volume_score ?? f.professionalism_score ?? (b.find(x=>getInfo(x.skill_area).key==='vocal_command')?.self_rating)],
      ['speech_fluency', f.speech_fluency ?? f.speech_pace_score ?? f.clarity_score ?? (b.find(x=>getInfo(x.skill_area).key==='speech_fluency')?.self_rating)],
      ['presence_engagement', f.presence_engagement ?? f.eye_contact_score ?? f.confidence_score ?? (b.find(x=>getInfo(x.skill_area).key==='presence_engagement')?.self_rating)],
      ['emotional_intelligence', f.emotional_intelligence ?? f.empathy_score ?? f.emotional_control_score ?? (b.find(x=>getInfo(x.skill_area).key==='emotional_intelligence')?.self_rating)],
    ].map(([k, v]) => ({ key: k, label: labelFor(k), value: toNum(v) }))
     .filter(s => s.value !== null)
  }, [data])

  // Without this, "no gaps found" and "nothing to compare" look identical, and
  // the page congratulates people on self-awareness they never showed.
  const hasSelfRating = selfScores.length > 0

  // Both radar layers share one time basis, so the gap between the shapes is
  // about the learner rather than about the layers covering different spans.
  const radarSelfScores = selfScores

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
          {error && <span className="text-xs text-danger bg-danger/10 border border-danger/20 px-3 py-1 rounded-full">{error}</span>}
          {msg && <span className="text-xs text-success bg-success/10 border border-success/20 px-3 py-1 rounded-full">{msg}</span>}
        </div>

        {!hasLive && !showGettingStarted && (
          <div className="banner banner-warning" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: 'var(--warning-text)' }}/>
            <span>Complete a practice session to see your real results here.</span>
          </div>
        )}

        {/* Below three sessions the panels would be empty boxes and a two-point
            trend line, so the page explains itself instead. */}
        {showGettingStarted ? (
          <GettingStarted sessionCount={sessionCount} onStart={() => navigate('/multimodal-analysis')} />
        ) : (
        <>

        <div
          className="rounded-2xl p-6"
          style={{ background: 'var(--gradient-accent)' }}
        >
          <div style={{ color: 'white' }}>
            <p style={{ color: 'rgba(255,255,255,0.85)' }} className="text-sm font-medium mb-1">Your Overall Score</p>
            <div className="flex items-end gap-2">
              <span className="score-num" style={{ fontSize: 60, fontWeight: 600, lineHeight: 1 }}>{fmtScore(overall)}</span>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 20, marginBottom: 6 }}>/100</span>
            </div>
            {/* A score out of 100 with no source reads as a grade. */}
            <p style={{ color: 'rgba(255,255,255,0.75)' }} className="text-xs mt-1">{overallCaption}</p>

            {latestOverall != null && (
              <div
                className="flex items-center gap-2 mt-3 rounded-lg px-3 py-2"
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.18)' }}
              >
                <span className="score-num" style={{ fontSize: 22, fontWeight: 600 }}>{latestOverall}</span>
                <span style={{ color: 'rgba(255,255,255,0.8)' }} className="text-xs">
                  your most recent session
                </span>
              </div>
            )}

            <p style={{ color: 'rgba(255,255,255,0.85)' }} className="text-sm mt-2">
              {overallMessage}
            </p>
          </div>
        </div>

        {/* Directly under the score: whoever reads one thing should read this. */}
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
            {isAllSessions ? 'Averaged across every session, out of 100' : 'This session, out of 100'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[...scoresShown, { key:'overall', label:'Overall Score', value: overall }].map((s,i) => {
              const h = history[s.key] || null
              // A measured zero and nothing measured are different facts. Scoring
              // is by penalty, so 0 is reachable - hence `measured`, not `v > 0`.
              const measured = s.value != null
              const v = measured ? Math.round(s.value) : null
              const isOverall = s.key === 'overall'
              const emoji = isOverall ? '🎯' : !measured ? '❓' : v >= 75 ? '🌟' : v >= 50 ? '👍' : '💪'
              const barColor = isOverall ? 'var(--accent)' : !measured ? 'var(--text-tertiary)' : v >= 75 ? 'var(--success)' : v >= 50 ? 'var(--info)' : 'var(--warning)'
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
                  {/* Lifetime context: without it a good day reads as a level and
                      a bad one as a collapse. */}
                  {h ? (
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>best {h.best_score == null ? '--' : Math.round(h.best_score)}</span>
                      <span>avg {h.average_score == null ? '--' : Math.round(h.average_score)}</span>
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
              overallNote={
                isAllSessions
                  ? 'Each session is scored as a whole and those scores are averaged, so this will not always match the average of the skills above.'
                  : undefined
              }
            />
            {isAllSessions && selfScores.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Both shapes are averages, so a week you rated yourself unusually
                high or low is smoothed out here. The panel beside this one counts
                those sessions one by one.
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
            {/* A gap needs two sides, so the empty states below distinguish "no
                measurement" from "no self-rating" from "no gap found". */}
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
                  // The blind spot's own copy, not the averaged rating: this is what
                  // the gap was calculated from, so the two boxes subtract to it.
                  const selfVal = b.self_rating
                  return (
                    <div key={i} className="rounded-xl p-4 border" style={{
                      borderColor: isOver
                        ? 'color-mix(in oklab, var(--danger) 30%, transparent)'
                        : 'color-mix(in oklab, var(--info) 30%, transparent)',
                      background: isOver
                        ? 'color-mix(in oklab, var(--danger) 8%, transparent)'
                        : 'color-mix(in oklab, var(--info) 8%, transparent)',
                    }}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-bold text-sm fg">{isOver ? '⬇️' : '⬆️'} {labelFor(b.skill_area)}</span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-tight" style={{
                          background: isOver
                            ? 'color-mix(in oklab, var(--danger) 20%, transparent)'
                            : 'color-mix(in oklab, var(--info) 20%, transparent)',
                          color: isOver ? 'var(--danger-text)' : 'var(--info-text)',
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
                // Direction comes from the two numbers, not trend_label: the label
                // describes the history, and a rising history can be forecast to
                // fall. Reading it made 100 → 85 render green and "Looking good!".
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
                        <p className="text-lg font-bold" style={{color: up ? 'var(--success-text)' : dir === 'flat' ? 'var(--info-text)' : 'var(--danger-text)'}}>{fmtScore(p.predicted_score)}</p>
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
