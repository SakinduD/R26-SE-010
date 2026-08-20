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
  hasPulledComponentData, normalizeComponentSessionOptions,
  normalizeAdaptivePlan, normalizeMcaNudges, normalizeMcaOverallScore,
  normalizeMcaSessionNudges, normalizeMcaSkillScores,
  normalizeRpeFeedback, normalizeRpeSession, normalizeSurveyProfile,
  optionalRequest, selectMcaSession,
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
            <div className="h-1.5 rounded-full overflow-hidden bg-muted mb-2">
              <div className="h-full rounded-full" style={{ width: pct + '%', backgroundColor: copy.tone }} />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{item.recommendation}</p>
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
    return Object.fromEntries(items.map((item) => [item.skill_area, item]))
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
        const integrated = await pull(tu, ts)
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
      const [sp,ap,rs,rf,ms] = await Promise.all([
        optionalRequest(()=>analyticsService.getComponentSurveyProfile()),
        optionalRequest(()=>analyticsService.getComponentAdaptivePlan()),
        optionalRequest(()=>analyticsService.getComponentRpeSession(ts)),
        optionalRequest(()=>analyticsService.getComponentRpeFeedback(ts)),
        optionalRequest(()=>analyticsService.getComponentMcaSessions()),
      ])
      const mcs = selectMcaSession(ms.data,ts), nudges = normalizeMcaSessionNudges(mcs)
      // Use the MCA-computed skill scores only when the selected session is that MCA session.
      const isSelectedMca = mcs && String(mcs.id) === String(ts)
      const mcaSkillScores = isSelectedMca ? normalizeMcaSkillScores(mcs) : null
      const mcaOverallScore = isSelectedMca ? normalizeMcaOverallScore(mcs) : null
      const src = { surveyProfile:sp, adaptivePlan:ap, rpeSession:rs, rpeFeedback:rf, mcaNudges:{ok:nudges.length>0||Boolean(mcaSkillScores),data:nudges} }
      if (!hasPulledComponentData(src)) return {integrated:false}
      await analyticsService.integrateCompletedSession({
        user_id:tu, session_id:ts,
        scenario_id: rs.data?.scenario_id||rf.data?.scenario_id||ap.data?.primary_scenario,
        skill_type: ap.data?.skill||rf.data?.skill_type||'communication',
        survey_profile:normalizeSurveyProfile(sp.data), adaptive_plan:normalizeAdaptivePlan(ap.data),
        rpe_session:normalizeRpeSession(rs.data), rpe_feedback:normalizeRpeFeedback(rf.data),
        mca_nudges:normalizeMcaNudges(nudges),
        mca_skill_scores: mcaSkillScores || undefined,
        mca_overall_score: mcaOverallScore ?? undefined,
      })
      return {integrated:true}
    } catch { return {integrated:false} }
  }

  const loadSess = async () => {
    try {
      const [rs,ms] = await Promise.all([optionalRequest(()=>analyticsService.getComponentRpeSessions()), optionalRequest(()=>analyticsService.getComponentMcaSessions())])
      const o = normalizeComponentSessionOptions(rs.data,ms.data)||[]
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
  // Feedback breakdown that adds up:  Feedback = Self + System.
  //  • Self   = self-assessments (distinct sessions; self is stored 4 rows/skill so
  //             counting sessions keeps it as "1 assessment", not 4)
  //  • System = auto-generated feedback items (system + mentor rows: RPE outcome,
  //             MCA nudges, adaptive plan, survey profile). Peer isn't collected.
  const fb = data?.aggregate?.feedback || {}
  const fbByType = fb.by_type || {}
  const fbSelf = fb.self_session_count || 0
  const fbSystem = (fbByType.system || 0) + (fbByType.mentor || 0)
  const fbTotal = fbSelf + fbSystem
  const fbBreakdown = [
    fbSelf && `Self ${fbSelf}`,
    fbSystem && `System ${fbSystem}`,
  ].filter(Boolean).join(' · ')
  // Overall is the mean of the four skills — a summary, not a skill — so it always
  // equals the average of the four skill cards shown below.
  // One sentence telling a first-time reader what the headline number is. The
  // number alone invites the wrong reading: people assume a single score out of
  // 100 is a grade, and act on it accordingly.
  const overallCaption = isAllSessions
    ? 'Your four skills from your most recent session, averaged'
    : 'This session’s four skills, averaged'

  const overall = useMemo(() => {
    const vals = scoresShown.map(s => s.value).filter(v => v != null)
    if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
    return fmtScore(data?.aggregate?.scores?.averages?.overall_score || data?.aggregate?.feedback?.average_rating)
  }, [scoresShown, data])

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
        {!hasLive && (
          <div className="banner banner-warning" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }}/>
            <span>Complete a practice session to see your real results here.</span>
          </div>
        )}

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
            <p style={{ color: 'rgba(255,255,255,0.85)' }} className="text-sm mt-2">
              {Number(overall)>=75 ? 'Great job! Keep it up!' : Number(overall)>=50 ? 'Good progress. Keep practising!' : 'Every session makes you better!'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center" style={{ color: 'white' }}>
            {[
              // Sessions = user's lifetime total when no session is selected, or the
              // selected session's count when one is chosen (aggregate scope follows the selection).
              { l: 'Sessions', v: data?.aggregate?.scores?.metric_count || 0 },
              { l: 'Feedback', v: fbTotal, sub: fbBreakdown },
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

        {/* Skill Score Cards */}
        <div>
          <h2 className="text-base font-bold mb-3">📊 Your Skill Scores</h2>
          {/* Written for someone opening this page for the first time. The big
              number and the small ones underneath answer different questions,
              and without saying which is which a reader assumes the largest one
              is the important one. */}
          <p className="text-xs text-muted-foreground mb-3">
            {isAllSessions
              ? 'The big number is your most recent session. Underneath: your highest score ever, your average across all sessions, and which way you have been moving lately.'
              : 'How this one session scored, out of 100, in each skill.'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[...scoresShown, { key:'overall', label:'Overall Score', value: Number(overall) || 0 }].map((s,i) => {
              const h = isAllSessions ? history[s.key] : null
              const v = s.value != null ? Math.round(s.value) : 0
              const isOverall = s.key === 'overall'
              const emoji = isOverall ? '🎯' : (v >= 75 ? '🌟' : v >= 50 ? '👍' : v > 0 ? '💪' : '❓')
              const barColor = isOverall ? '#8b5cf6' : (v >= 75 ? '#10b981' : v >= 50 ? '#6366f1' : v > 0 ? '#f59e0b' : '#6b7280')
              return (
                <div key={s.key} className={`rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors ${isOverall ? 'ring-2 ring-primary/20' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg">{emoji}</span>
                    <span className="text-xl font-bold" style={{color: barColor}}>{v > 0 ? v : '--'}</span>
                  </div>
                  <div className="mb-2">
                    <p className="text-sm font-semibold">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground italic leading-none">{subFor(s.key)}</p>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-muted">
                    <motion.div initial={{width:0}} animate={{width:v+'%'}} transition={{duration:0.8,delay:i*0.05}}
                      className="h-full rounded-full" style={{backgroundColor: barColor}}/>
                  </div>
                  {/* The number above is one session. Without the average and the
                      best beside it, a good day reads as a level and a bad one
                      reads as a collapse. */}
                  {h && (
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>best {Math.round(h.best_score ?? 0)}</span>
                      <span>avg {Math.round(h.average_score ?? 0)}</span>
                      <span style={{ color: TREND_TONE[h.trend_label] }}>{TREND_MARK[h.trend_label]}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Radar + Blind Spots */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-bold mb-1">🕸️ Skill Overview Chart</h2>
            <p className="text-xs text-muted-foreground mb-4">
              {isAllSessions
                ? 'Your latest session across all four skills'
                : radarSelfScores.length > 0
                  ? 'Teal = Observed scores · Amber = Your self-rating'
                  : 'All your skills shown together in one view'}
            </p>
            <SkillTwinRadar
              scores={scoresShown}
              selfScores={radarSelfScores}
              overallScore={overall}
            />
            {isAllSessions && selfScores.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Your self-ratings are not drawn here. Averaged over every session they
                would smooth out the very thing worth seeing — see the patterns beside
                this chart for how your ratings compared, session by session.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-bold mb-1">🔍 Things to Know About Yourself</h2>
            <p className="text-xs text-muted-foreground mb-4">
              {isAllSessions
                ? 'Patterns across all your sessions — how often, not how much'
                : 'How you see yourself vs what this session measured'}
            </p>
            {/* A gap needs two sides. With no self-assessment there is nothing to
                compare, and saying "your self-view matches" would be claiming a
                finding the data cannot support. */}
            {isAllSessions && recurring.length > 0 ? (
              <RecurringPatterns items={recurring} />
            ) : !hasObserved ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="text-4xl mb-3">📊</span>
                <p className="font-semibold fg">This session has no measured scores yet</p>
                <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                  A gap is your rating measured against what the session recorded. Without
                  the measurement there is nothing to compare your rating with.
                </p>
              </div>
            ) : !hasSelfRating ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="text-4xl mb-3">📝</span>
                <p className="font-semibold fg">No self-assessment for this session yet</p>
                <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                  Rate yourself on this session and your ratings will be compared with what
                  was measured, to show where the two disagree.
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
                <p className="text-muted-foreground text-sm mt-1">No gaps detected for this session. Great self-awareness!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {gaps.map((b, i) => {
                  const isOver = b.blind_spot_type === 'overestimation'
                  const selfVal = selfScores.find(s => getInfo(s.key).key === getInfo(b.skill_area).key)?.value || b.self_rating
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
          <h2 className="text-base font-bold mb-1">📈 How You Are Improving Over Time</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Every session you have completed, oldest on the left. A line going up means
            that skill is improving.
          </p>
          <div className="min-h-[280px]">
            <ProgressTrendVisualization trends={trends} labelFor={labelFor} />
          </div>
        </div>

        {/* Predictions */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-base font-bold mb-1">🔮 What to Expect Next</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Where each skill is heading if you carry on exactly as you have been. Not a
            target and not a promise — a continuation of your own trend line.
          </p>
          {preds.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-4xl block mb-2">🤖</span>
              <p className="text-muted-foreground text-sm">Complete more sessions to get predictions</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {preds.slice(0, 4).map((p, i) => {
                const up = p.trend_label === 'improving'
                const borderColor = up ? 'rgba(16,185,129,0.3)' : p.risk_level === 'high' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'
                const bgColor = up ? 'rgba(16,185,129,0.08)' : p.risk_level === 'high' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)'
                return (
                  <div key={i} className="rounded-xl p-4 border" style={{borderColor, background: bgColor}}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">{up ? '📈' : '⚠️'}</span>
                      <div>
                        <p className="font-bold text-sm">{labelFor(p.predicted_skill)}</p>
                        <p className="text-xs text-muted-foreground">{up ? 'Looking good!' : 'Needs attention'}</p>
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
                        <p className="text-lg font-bold" style={{color: up ? '#10b981' : '#ef4444'}}>{fmtScore(p.predicted_score)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">💡 {p.recommendation}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function merge(agg, ss) {
  if (!ss?.skill_scores) return agg; const s = ss.skill_scores
  return {...agg, scores:{...agg?.scores, averages:{...agg?.scores?.averages, confidence_score:s.confidence, clarity_score:s.communication_clarity, empathy_score:s.empathy, listening_score:s.active_listening, adaptability_score:s.adaptability, emotional_control_score:s.emotional_control, professionalism_score:s.professionalism, overall_score:ss.overall_score}}}
}
