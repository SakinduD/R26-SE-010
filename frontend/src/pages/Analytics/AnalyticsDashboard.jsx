import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart3, LineChart,
  RefreshCw, Search, ShieldAlert, Target,
  TrendingUp, TrendingDown, CheckCircle,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '../../components/ui/Button'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import AnalyticsUserBadge from './AnalyticsUserBadge'
import { useAnalyticsIdentity } from './analyticsAuth'
import {
  hasPulledComponentData, normalizeComponentSessionOptions,
  normalizeAdaptivePlan, normalizeMcaNudges, normalizeMcaSessionNudges,
  normalizeRpeFeedback, normalizeRpeSession, normalizeSurveyProfile,
  optionalRequest, selectPreferredComponentSession, selectMcaSession,
} from './analyticsIntegrationUtils'

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

export default function AnalyticsDashboard() {
  const { userId: cid, userLabel, isAuthLoading, isAuthenticated } = useAnalyticsIdentity()
  const [userId, setUserId] = useState(cid || '')
  const [sessionId, setSessionId] = useState('')
  const [sessOpts, setSessOpts] = useState([])
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const scores = useMemo(() => {
    const a = data?.aggregate?.scores?.averages || {}
    const f = data?.aggregate?.feedback?.skill_rating_averages || {}
    return [
      ['vocal_command', a.vocal_command ?? a.speech_volume_score ?? a.professionalism_score ?? f.vocal_command],
      ['speech_fluency', a.speech_fluency ?? a.speech_pace_score ?? a.clarity_score ?? f.speech_fluency],
      ['presence_engagement', a.presence_engagement ?? a.eye_contact_score ?? a.confidence_score ?? f.presence_engagement],
      ['emotional_intelligence', a.emotional_intelligence ?? a.empathy_score ?? a.emotional_control_score ?? f.emotional_intelligence],
    ].map(([k, v]) => ({ key: k, label: labelFor(k), value: toNum(v) }))
  }, [data])

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
        const [bs, tr, pr] = await Promise.all([
          analyticsService.getBlindSpotsByUser(tu).catch(() => null),
          analyticsService.getProgressTrendsByUser(tu).catch(() => null),
          analyticsService.getPredictedOutcomesByUser(tu).catch(() => null),
        ])
        finalData.blindSpots = bs || { summary: { total_count: 0 }, blind_spots: [] }
        finalData.trends = tr || { trends: [] }
        finalData.predictions = pr || { predictions: [] }
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
      const src = { surveyProfile:sp, adaptivePlan:ap, rpeSession:rs, rpeFeedback:rf, mcaNudges:{ok:nudges.length>0,data:nudges} }
      if (!hasPulledComponentData(src)) return {integrated:false}
      await analyticsService.integrateCompletedSession({
        user_id:tu, session_id:ts,
        scenario_id: rs.data?.scenario_id||rf.data?.scenario_id||ap.data?.primary_scenario,
        skill_type: ap.data?.skill||rf.data?.skill_type||'communication',
        survey_profile:normalizeSurveyProfile(sp.data), adaptive_plan:normalizeAdaptivePlan(ap.data),
        rpe_session:normalizeRpeSession(rs.data), rpe_feedback:normalizeRpeFeedback(rf.data),
        mca_nudges:normalizeMcaNudges(nudges),
      })
      return {integrated:true}
    } catch { return {integrated:false} }
  }

  const loadSess = async () => {
    try {
      const [rs,ms] = await Promise.all([optionalRequest(()=>analyticsService.getComponentRpeSessions()), optionalRequest(()=>analyticsService.getComponentMcaSessions())])
      const o = normalizeComponentSessionOptions(rs.data,ms.data)||[]
      setSessOpts(o); const p = selectPreferredComponentSession(o); if(p) setSessionId(p.id); return p
    } catch { return null }
  }

  useEffect(() => { if(!isAuthLoading&&isAuthenticated&&cid) { setUserId(cid); loadSess().then(p=>load(cid,p?.id||'')) } }, [cid,isAuthLoading,isAuthenticated])

  const preds = Array.isArray(data?.predictions?.predictions) ? data.predictions.predictions : []
  const gaps = Array.isArray(data?.blindSpots?.blind_spots) ? data.blindSpots.blind_spots : []
  const trends = Array.isArray(data?.trends?.trends) ? data.trends.trends : []
  const overall = fmtScore(data?.aggregate?.scores?.averages?.overall_score || data?.aggregate?.feedback?.average_rating)

  // Build self-rating scores from feedback averages + blind spot data for dual-layer radar
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
            <AnalyticsNav />
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span>Session</span>
              <select value={sessionId} onChange={e=>setSessionId(e.target.value)}
                className="h-10 min-w-72 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary">
                {!sessOpts.length && <option value="">Select a session</option>}
                {sessOpts.map(o=><option key={o.source+'-'+o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <button onClick={()=>load(userId,sessionId)}
              className="h-10 flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold px-5 rounded-md transition-colors">
              {status==='loading' ? <RefreshCw className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>} Load
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border border-border bg-muted">
            <span className={'h-2 w-2 rounded-full '+(status==='live'?'bg-green-500':status==='loading'?'bg-blue-500 animate-pulse':'bg-muted-foreground')}/>
            {status==='live'?'Live Data':status==='loading'?'Loading...':'Demo Mode'}
          </span>
          {error && <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-1 rounded-full">{error}</span>}
          {msg && <span className="text-xs text-green-400 bg-green-400/10 border border-green-400/20 px-3 py-1 rounded-full">{msg}</span>}
        </div>

        {!hasLive && (
          <div className="flex items-center gap-3 border border-yellow-500/30 bg-yellow-500/10 rounded-xl px-4 py-3 text-sm text-yellow-300">
            <AlertTriangle className="h-4 w-4 shrink-0"/>Complete a practice session to see your real results here.
          </div>
        )}

        {/* Big Score Banner */}
        <div className="rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6" style={{background:'linear-gradient(135deg, #4f46e5, #7c3aed)'}}>
          <div className="flex-1 text-white">
            <p className="text-indigo-200 text-sm font-medium mb-1">Your Overall Score</p>
            <div className="flex items-end gap-2">
              <span className="text-6xl font-bold">{overall}</span>
              <span className="text-indigo-200 text-xl mb-2">/100</span>
            </div>
            <p className="text-indigo-100 text-sm mt-2">
              {Number(overall)>=75 ? 'Great job! Keep it up!' : Number(overall)>=50 ? 'Good progress. Keep practising!' : 'Every session makes you better!'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-white">
            {[{l:'Sessions',v:data?.aggregate?.scores?.metric_count||0,e:'📅'},{l:'Feedback',v:data?.aggregate?.feedback?.total_count||0,e:'💬'},{l:'Insights',v:preds.length,e:'🔍'}].map(x=>
              <div key={x.l} className="rounded-xl px-4 py-3" style={{background:'rgba(255,255,255,0.15)'}}>
                <div className="text-xl mb-1">{x.e}</div>
                <div className="text-xl font-bold">{x.v}</div>
                <div className="text-indigo-200 text-xs">{x.l}</div>
              </div>
            )}
          </div>
        </div>

        {/* Skill Score Cards */}
        <div>
          <h2 className="text-base font-bold mb-3">📊 Your Skill Scores</h2>
          <p className="text-xs text-muted-foreground mb-3">Each card shows how well you are doing in a specific skill</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[...scores, { key:'overall', label:'Overall Score', value: Number(overall) || 0 }].map((s,i) => {
              const v = s.value || 0
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
                </div>
              )
            })}
          </div>
        </div>

        {/* Radar + Blind Spots */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-bold mb-1">🕸️ Skill Overview Chart</h2>
            <p className="text-xs text-muted-foreground mb-4">{selfScores.length > 0 ? 'Teal = Observed scores · Amber = Your self-rating' : 'All your skills shown together in one view'}</p>
            <SkillTwinRadar 
              scores={scores} 
              selfScores={selfScores} 
              overallScore={overall}
            />
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-bold mb-1">🔍 Things to Know About Yourself</h2>
            <p className="text-xs text-muted-foreground mb-4">How you see yourself vs how others see you</p>
            {gaps.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="text-4xl mb-3">🎯</span>
                <p className="font-semibold text-slate-200">Your self-view matches your performance!</p>
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
                        <span className="font-bold text-sm text-slate-100">{isOver ? '⬇️' : '⬆️'} {labelFor(b.skill_area)}</span>
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
                          <p className="text-2xl font-bold text-amber-400">{fmtScore(selfVal)}</p>
                        </div>
                        <div className="flex-1 rounded-lg p-3 text-center border border-border bg-background/50">
                          <p className="text-[10px] text-muted-foreground uppercase mb-1">AI Observed</p>
                          <p className="text-2xl font-bold text-cyan-400">{fmtScore(b.comparison_score)}</p>
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
          <p className="text-xs text-muted-foreground mb-4">See if your skills are going up, staying the same, or need attention</p>
          <div className="min-h-[280px]">
            <ProgressTrendVisualization trends={trends} labelFor={labelFor} />
          </div>
        </div>

        {/* Predictions */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-base font-bold mb-1">🔮 What to Expect Next</h2>
          <p className="text-xs text-muted-foreground mb-4">AI predictions based on your recent sessions</p>
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
