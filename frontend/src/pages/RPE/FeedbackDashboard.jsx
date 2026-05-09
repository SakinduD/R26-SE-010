import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, RefreshCw, CheckCircle, XCircle, Clock, BarChart2 } from 'lucide-react'

import { rpeService }       from '@/services/rpe/rpeService'
import { cn }               from '@/lib/utils'
import CoachingPanel        from '@/components/RPE/CoachingPanel'
import RiskFlagsPanel       from '@/components/RPE/RiskFlagsPanel'
import BlindSpotsPanel      from '@/components/RPE/BlindSpotsPanel'
import QualityCurveChart    from '@/components/RPE/QualityCurveChart'
import RadarSummaryCard     from '@/components/RPE/RadarSummaryCard'

/* ── helpers ──────────────────────────────────────────────── */
const DIFFICULTY_STYLES = {
  beginner:     'bg-emerald-100 text-emerald-700',
  intermediate: 'bg-amber-100 text-amber-700',
  advanced:     'bg-red-100 text-red-700',
}

const NPC_TONE_CHIP = {
  cooperative: 'bg-emerald-100 text-emerald-700',
  neutral:     'bg-amber-100 text-amber-700',
  hostile:     'bg-red-100 text-red-700',
}

const EMOTION_STYLES = {
  calm:       'bg-emerald-100 text-emerald-700',
  assertive:  'bg-violet-100 text-violet-700',
  anxious:    'bg-amber-100 text-amber-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-slate-100 text-slate-600',
}

const EMOTION_BAR_COLORS = {
  calm:       'bg-gradient-to-r from-emerald-500 to-teal-400',
  assertive:  'bg-gradient-to-r from-violet-500 to-purple-400',
  anxious:    'bg-gradient-to-r from-amber-400 to-yellow-300',
  frustrated: 'bg-gradient-to-r from-red-500 to-rose-400',
  confused:   'bg-gradient-to-r from-slate-400 to-slate-300',
}

const SECTIONS = [
  { id: 'overview', label: 'Overview'          },
  { id: 'coaching', label: 'Coaching'           },
  { id: 'risks',    label: 'Risk & Blind Spots' },
  { id: 'charts',   label: 'Charts'             },
]

/* ── end reason badge config ─────────────────────────────── */
function endReasonBadge(endReason, outcome) {
  if (endReason === 'trust_sustained')
    return { cls: 'bg-emerald-100 text-emerald-700',  label: 'Trust Built'  }
  if (endReason === 'npc_exit')
    return { cls: 'bg-red-100 text-red-700',          label: 'NPC Exited'   }
  if (endReason === 'max_turns_reached' && outcome === 'success')
    return { cls: 'bg-violet-100 text-violet-700',    label: 'Completed'    }
  if (endReason === 'max_turns_reached' && outcome === 'failure')
    return { cls: 'bg-amber-100 text-amber-700',      label: 'Time Limit'   }
  if (outcome === 'success')
    return { cls: 'bg-emerald-100 text-emerald-700',  label: 'Success'      }
  if (outcome === 'failure')
    return { cls: 'bg-red-100 text-red-700',          label: 'Needs Work'   }
  return   { cls: 'bg-muted text-muted-foreground',   label: 'Incomplete'   }
}

/* ── end reason context card ─────────────────────────────── */
function EndReasonCard({ endReason, totalTurns, recommendedTurns, maxTurns, label }) {
  const config = {
    trust_sustained:   { border: 'border-emerald-200 bg-emerald-50', Icon: CheckCircle, iconCls: 'text-emerald-500' },
    npc_exit:          { border: 'border-red-200 bg-red-50',         Icon: XCircle,    iconCls: 'text-red-500'     },
    max_turns_reached: { border: 'border-border bg-muted/40',        Icon: Clock,      iconCls: 'text-muted-foreground' },
  }
  const c = config[endReason] ?? config.max_turns_reached
  const { Icon } = c
  return (
    <div className={cn('rounded-xl border px-4 py-3.5 flex items-center gap-3', c.border)}>
      <Icon className={cn('w-5 h-5 shrink-0', c.iconCls)} />
      <div>
        <p className="text-sm font-semibold text-foreground">{label ?? 'Session Ended'}</p>
        <p className="text-xs text-muted-foreground">
          Session ran {totalTurns} turns
          {recommendedTurns && ` (recommended ${recommendedTurns}`}
          {maxTurns && `, max ${maxTurns}`}
          {(recommendedTurns || maxTurns) && ')'}
        </p>
      </div>
    </div>
  )
}

/* ── score card ──────────────────────────────────────────── */
function ScoreCard({ label, value, suffix, colorClass = 'text-foreground', children }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
      <p className={cn('text-3xl font-bold tabular-nums', colorClass)}>
        {value}
        {suffix && <span className="text-lg text-muted-foreground font-normal">{suffix}</span>}
      </p>
      {children}
    </div>
  )
}

function getTrustColor(v) {
  return v >= 70 ? 'text-emerald-600' : v >= 40 ? 'text-amber-500' : 'text-red-500'
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-32 bg-muted rounded-xl" />
      ))}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   FeedbackDashboard
════════════════════════════════════════════════════════════ */
export default function FeedbackDashboard() {
  const { sessionId: paramId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const sessionId = paramId || location.state?.sessionId

  const [feedbackData,  setFeedbackData]  = useState(null)
  const [isLoading,     setIsLoading]     = useState(true)
  const [error,         setError]         = useState(null)
  const [activeSection, setActiveSection] = useState('overview')

  const load = useCallback(async () => {
    if (!sessionId) { navigate('/roleplay'); return }
    setIsLoading(true)
    setError(null)
    try {
      const data = await rpeService.getFeedback(sessionId)
      setFeedbackData(data)
    } catch (err) {
      setError(err.message || 'Failed to load feedback.')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => { load() }, [load])

  /* ── derived ─────────────────────────────────────────── */
  const viz             = feedbackData?.viz_payload         ?? {}
  const summary         = viz.summary_scores                ?? {}
  const emotionDist     = viz.emotion_distribution          ?? {}
  const trustDeltas     = viz.trust_deltas                  ?? []
  const npcToneJourney  = viz.npc_tone_journey              ?? []
  const endReason       = feedbackData?.end_reason
  const recommendedTurns = feedbackData?.recommended_turns
  const maxTurns        = feedbackData?.max_turns

  const totalEmotions   = Object.values(emotionDist).reduce((s, c) => s + c, 0)
  const emotionEntries  = Object.entries(emotionDist).sort((a, b) => b[1] - a[1])

  /* ── LOADING ──────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="text-center mb-8 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <BarChart2 className="w-6 h-6 text-primary animate-pulse" />
            </div>
            <p className="text-muted-foreground text-sm">Analysing your session…</p>
          </div>
          <Skeleton />
        </div>
      </div>
    )
  }

  /* ── ERROR ────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-card rounded-2xl border border-border p-8 max-w-md w-full text-center space-y-4 shadow-lg">
          <p className="text-3xl">⚠️</p>
          <h2 className="font-bold text-foreground">Could not load feedback for this session.</h2>
          <p className="text-sm text-red-500">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={load}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <RefreshCw size={14} /> Try Again
            </button>
            <button
              onClick={() => navigate('/roleplay')}
              className="rounded-xl bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/80 transition-colors"
            >
              Back to Scenarios
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── LOADED ───────────────────────────────────────────── */
  const fd    = feedbackData
  const badge = endReasonBadge(endReason, fd.outcome)

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Sticky page header */}
      <div className="sticky top-0 z-20 bg-card border-b border-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-foreground leading-tight">Session Feedback</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground truncate">{fd.scenario_title}</span>
                {fd.difficulty && (
                  <span className={cn(
                    'text-xs font-semibold rounded-full px-2 py-0.5 capitalize shrink-0',
                    DIFFICULTY_STYLES[fd.difficulty] ?? 'bg-muted text-muted-foreground'
                  )}>
                    {fd.difficulty}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className={cn('shrink-0 text-xs font-bold rounded-full px-3 py-1', badge.cls)}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* Section nav */}
      <div className="bg-card border-b border-border/60">
        <div className="max-w-4xl mx-auto px-4 flex gap-0 overflow-x-auto scrollbar-hide">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                'whitespace-nowrap px-5 py-3 text-sm font-semibold transition-colors border-b-2',
                activeSection === s.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-5">

          {/* Score cards — always visible */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ScoreCard
              label="Final Trust"
              value={fd.final_trust ?? '—'}
              suffix="/100"
              colorClass={getTrustColor(fd.final_trust ?? 0)}
            />
            <ScoreCard label="Escalation" value={fd.final_escalation ?? '—'} suffix="/5">
              <div className="flex justify-center gap-1 mt-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'w-2 h-2 rounded-full',
                      i < (fd.final_escalation ?? 0)
                        ? fd.final_escalation <= 1 ? 'bg-emerald-400'
                          : fd.final_escalation <= 3 ? 'bg-amber-400'
                          : 'bg-red-500'
                        : 'bg-muted border border-border'
                    )}
                  />
                ))}
              </div>
            </ScoreCard>
            <ScoreCard label="Turns" value={fd.total_turns ?? '—'} suffix=" turns" />
            <ScoreCard
              label="Avg Quality"
              value={summary.avg_quality ?? '—'}
              suffix="/10"
              colorClass={
                (summary.avg_quality ?? 0) >= 7 ? 'text-emerald-600'
                : (summary.avg_quality ?? 0) >= 4 ? 'text-amber-500'
                : 'text-red-500'
              }
            />
          </div>

          {/* ── OVERVIEW ──────────────────────────────────────── */}
          {activeSection === 'overview' && (
            <div className="space-y-5">
              <EndReasonCard
                endReason={endReason}
                totalTurns={fd.total_turns}
                recommendedTurns={recommendedTurns}
                maxTurns={maxTurns}
                label={summary.end_reason_label}
              />
              <div className="grid md:grid-cols-2 gap-5">
                <RadarSummaryCard summaryScores={summary} emotionDistribution={emotionDist} />
                <CoachingPanel
                  coachingAdvice={fd.coaching_advice}
                  truncated
                  onExpand={() => setActiveSection('coaching')}
                />
              </div>
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <RiskFlagsPanel riskFlags={fd.risk_flags} limit={2} />
                  {fd.risk_flags?.length > 2 && (
                    <button
                      onClick={() => setActiveSection('risks')}
                      className="mt-2 text-xs text-primary hover:underline font-semibold"
                    >
                      See all {fd.risk_flags.length} flags →
                    </button>
                  )}
                </div>
                <div>
                  <BlindSpotsPanel blindSpots={fd.blind_spots} limit={1} />
                  {fd.blind_spots?.length > 1 && (
                    <button
                      onClick={() => setActiveSection('risks')}
                      className="mt-2 text-xs text-primary hover:underline font-semibold"
                    >
                      See all {fd.blind_spots.length} blind spots →
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── COACHING ──────────────────────────────────────── */}
          {activeSection === 'coaching' && (
            <div className="space-y-5">
              <CoachingPanel coachingAdvice={fd.coaching_advice} />

              {npcToneJourney.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
                  <p className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">
                    How the NPC saw you across the session
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {npcToneJourney.map((item, i) => (
                      <span
                        key={i}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
                          NPC_TONE_CHIP[item.tone] ?? 'bg-muted text-muted-foreground'
                        )}
                      >
                        {item.turn}: {item.tone}
                      </span>
                    ))}
                  </div>
                  {endReason === 'npc_exit' && (
                    <p className="text-xs text-red-500 mt-3 font-medium">
                      ⚠ The NPC exited at turn {fd.total_turns} due to escalation reaching level {fd.final_escalation}/5
                    </p>
                  )}
                  {endReason === 'trust_sustained' && (
                    <p className="text-xs text-emerald-600 mt-3 font-medium">
                      ✅ Trust was sustained above the threshold — NPC resolved.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── RISKS ─────────────────────────────────────────── */}
          {activeSection === 'risks' && (
            <div className="grid md:grid-cols-2 gap-5">
              <RiskFlagsPanel riskFlags={fd.risk_flags} />
              <BlindSpotsPanel blindSpots={fd.blind_spots} />
            </div>
          )}

          {/* ── CHARTS ────────────────────────────────────────── */}
          {activeSection === 'charts' && (
            <div className="space-y-5">
              <QualityCurveChart
                qualityCurve={viz.quality_curve}
                trustCurve={viz.trust_curve}
                escalationCurve={viz.escalation_curve}
              />

              {/* Trust delta strip */}
              {trustDeltas.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
                  <p className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">Trust change per turn</p>
                  <div className="flex flex-wrap gap-2">
                    {trustDeltas.map((item, i) => (
                      <span
                        key={i}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-bold',
                          item.direction === 'up'   ? 'bg-emerald-100 text-emerald-700'
                          : item.direction === 'down' ? 'bg-red-100 text-red-700'
                          : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {item.turn}: {item.direction === 'up' ? `+${item.delta}` : item.delta === 0 ? '±0' : item.delta}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Emotion distribution */}
              {emotionEntries.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
                  <p className="text-sm font-bold text-foreground mb-4 uppercase tracking-wide">Emotion Breakdown</p>
                  <div className="space-y-3">
                    {emotionEntries.map(([emotion, count]) => {
                      const pct = totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
                      return (
                        <div key={emotion} className="flex items-center gap-3">
                          <span className={cn(
                            'w-20 shrink-0 text-xs font-semibold rounded-full px-2 py-0.5 text-center capitalize',
                            EMOTION_STYLES[emotion] ?? 'bg-muted text-muted-foreground'
                          )}>
                            {emotion}
                          </span>
                          <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                            <div
                              className={cn('h-2.5 rounded-full transition-all duration-700', EMOTION_BAR_COLORS[emotion] ?? 'bg-slate-400')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-14 text-right tabular-nums font-medium">
                            {count} ({pct}%)
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-0 bg-card border-t border-border px-4 py-3 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <button
            onClick={() => navigate('/roleplay')}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20"
          >
            <RefreshCw size={14} /> Try Again
          </button>
          <button
            onClick={() => navigate('/roleplay')}
            className="rounded-xl bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/80 transition-colors"
          >
            Next Scenario
          </button>
        </div>
      </div>

    </div>
  )
}
