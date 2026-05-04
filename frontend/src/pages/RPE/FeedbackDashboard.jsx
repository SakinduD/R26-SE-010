import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, RefreshCw, Download, CheckCircle, XCircle, Clock } from 'lucide-react'

import { rpeService }       from '@/services/rpe/rpeService'
import { cn }               from '@/lib/utils'
import CoachingPanel        from '@/components/RPE/CoachingPanel'
import RiskFlagsPanel       from '@/components/RPE/RiskFlagsPanel'
import BlindSpotsPanel      from '@/components/RPE/BlindSpotsPanel'
import QualityCurveChart    from '@/components/RPE/QualityCurveChart'
import RadarSummaryCard     from '@/components/RPE/RadarSummaryCard'

/* ── helpers ────────────────────────────────────────────────── */
const DIFFICULTY_BADGE = {
  beginner:     'bg-green-100 text-green-700',
  intermediate: 'bg-yellow-100 text-yellow-700',
  advanced:     'bg-red-100 text-red-700',
}

const NPC_TONE_CHIP = {
  cooperative: 'bg-green-100 text-green-700',
  neutral:     'bg-yellow-100 text-yellow-700',
  hostile:     'bg-red-100 text-red-700',
}

const EMOTION_COLORS = {
  calm:       'bg-green-100 text-green-700',
  assertive:  'bg-blue-100 text-blue-700',
  anxious:    'bg-yellow-100 text-yellow-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-gray-100 text-gray-700',
}

const EMOTION_BAR_COLORS = {
  calm:       'bg-green-400',
  assertive:  'bg-blue-400',
  anxious:    'bg-yellow-400',
  frustrated: 'bg-red-400',
  confused:   'bg-gray-400',
}

const SECTIONS = [
  { id: 'overview', label: 'Overview'           },
  { id: 'coaching', label: 'Coaching'            },
  { id: 'risks',    label: 'Risk & Blind Spots'  },
  { id: 'charts',   label: 'Charts'              },
]

/* ── end reason badge config ─────────────────────────────────── */
function endReasonBadge(endReason, outcome) {
  if (endReason === 'trust_sustained')
    return { cls: 'bg-green-100 text-green-700',  label: '🎉 Trust Built'  }
  if (endReason === 'npc_exit')
    return { cls: 'bg-red-100 text-red-700',      label: '💢 NPC Exited'   }
  if (endReason === 'max_turns_reached' && outcome === 'success')
    return { cls: 'bg-blue-100 text-blue-700',    label: '✅ Completed'    }
  if (endReason === 'max_turns_reached' && outcome === 'failure')
    return { cls: 'bg-yellow-100 text-yellow-700', label: '⏱ Time Limit'  }
  if (outcome === 'success')
    return { cls: 'bg-green-100 text-green-700',  label: '✅ Success'      }
  if (outcome === 'failure')
    return { cls: 'bg-red-100 text-red-700',      label: '❌ Needs Work'   }
  return   { cls: 'bg-gray-100 text-gray-500',    label: 'Incomplete'      }
}

/* ── end reason context card ─────────────────────────────────── */
function EndReasonCard({ endReason, totalTurns, recommendedTurns, maxTurns, label }) {
  const config = {
    trust_sustained:   { border: 'border-green-200 bg-green-50',  Icon: CheckCircle, iconCls: 'text-green-500' },
    npc_exit:          { border: 'border-red-200 bg-red-50',       Icon: XCircle,    iconCls: 'text-red-500'   },
    max_turns_reached: { border: 'border-blue-200 bg-blue-50',     Icon: Clock,      iconCls: 'text-blue-400'  },
  }
  const c = config[endReason] ?? config.max_turns_reached
  const { Icon } = c
  return (
    <div className={cn('rounded-xl border px-4 py-3 flex items-center gap-3', c.border)}>
      <Icon className={cn('w-5 h-5 shrink-0', c.iconCls)} />
      <div>
        <p className="text-sm font-semibold text-gray-800">{label ?? 'Session Ended'}</p>
        <p className="text-xs text-gray-500">
          Session ran {totalTurns} turns
          {recommendedTurns && ` (recommended ${recommendedTurns}`}
          {maxTurns && `, max ${maxTurns}`}
          {(recommendedTurns || maxTurns) && ')'}
        </p>
      </div>
    </div>
  )
}

/* ── score card ──────────────────────────────────────────────── */
function ScoreCard({ label, value, suffix, colorClass = 'text-gray-900', children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('text-3xl font-bold tabular-nums', colorClass)}>
        {value}
        {suffix && <span className="text-lg text-gray-400 font-normal">{suffix}</span>}
      </p>
      {children}
    </div>
  )
}

function getTrustColor(v) {
  return v >= 70 ? 'text-green-600' : v >= 40 ? 'text-yellow-500' : 'text-red-500'
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-32 bg-gray-200 rounded-xl" />
      ))}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   FeedbackDashboard
══════════════════════════════════════════════════════════════ */
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

  /* ── derived ─────────────────────────────────────────────── */
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

  /* ── LOADING ────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-10">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="text-center mb-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3" />
            <p className="text-gray-500 text-sm">Analysing your session…</p>
          </div>
          <Skeleton />
        </div>
      </div>
    )
  }

  /* ── ERROR ──────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md w-full text-center space-y-4">
          <p className="text-2xl">⚠️</p>
          <h2 className="font-semibold text-gray-900">Could not load feedback for this session.</h2>
          <p className="text-sm text-red-500">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={load}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw size={14} /> Try Again
            </button>
            <button
              onClick={() => navigate('/roleplay')}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              Back to Scenarios
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── LOADED ─────────────────────────────────────────────── */
  const fd    = feedbackData
  const badge = endReasonBadge(endReason, fd.outcome)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Sticky page header ─────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-gray-500 hover:text-gray-800 text-sm shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 leading-tight truncate">
                Session Feedback
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500 truncate">{fd.scenario_title}</span>
                {fd.difficulty && (
                  <span className={cn(
                    'text-xs font-medium rounded-full px-2 py-0.5 capitalize shrink-0',
                    DIFFICULTY_BADGE[fd.difficulty] ?? 'bg-gray-100 text-gray-600'
                  )}>
                    {fd.difficulty}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* End reason / outcome badge */}
          <span className={cn('shrink-0 text-sm font-semibold rounded-full px-3 py-1', badge.cls)}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* ── Section nav bar ────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100 px-4">
        <div className="max-w-4xl mx-auto flex gap-1 overflow-x-auto">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                'whitespace-nowrap px-4 py-3 text-sm transition-colors',
                activeSection === s.id
                  ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                  : 'text-gray-400 hover:text-gray-600'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main content ───────────────────────────────────── */}
      <div className="flex-1 px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">

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
                        ? fd.final_escalation <= 1 ? 'bg-green-400'
                          : fd.final_escalation <= 3 ? 'bg-yellow-400'
                          : 'bg-red-500'
                        : 'bg-gray-200'
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
                (summary.avg_quality ?? 0) >= 7
                  ? 'text-green-600'
                  : (summary.avg_quality ?? 0) >= 4
                  ? 'text-yellow-500'
                  : 'text-red-500'
              }
            />
          </div>

          {/* ── OVERVIEW ─────────────────────────────────────── */}
          {activeSection === 'overview' && (
            <div className="space-y-6">
              {/* End reason context card */}
              <EndReasonCard
                endReason={endReason}
                totalTurns={fd.total_turns}
                recommendedTurns={recommendedTurns}
                maxTurns={maxTurns}
                label={summary.end_reason_label}
              />

              <div className="grid md:grid-cols-2 gap-6">
                <RadarSummaryCard summaryScores={summary} emotionDistribution={emotionDist} />
                <CoachingPanel
                  coachingAdvice={fd.coaching_advice}
                  truncated
                  onExpand={() => setActiveSection('coaching')}
                />
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <RiskFlagsPanel riskFlags={fd.risk_flags} limit={2} />
                  {fd.risk_flags?.length > 2 && (
                    <button
                      onClick={() => setActiveSection('risks')}
                      className="mt-2 text-xs text-blue-600 hover:underline"
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
                      className="mt-2 text-xs text-blue-600 hover:underline"
                    >
                      See all {fd.blind_spots.length} blind spots →
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── COACHING ─────────────────────────────────────── */}
          {activeSection === 'coaching' && (
            <div className="space-y-6">
              <CoachingPanel coachingAdvice={fd.coaching_advice} />

              {/* NPC tone journey */}
              {npcToneJourney.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <p className="text-sm font-semibold text-gray-700 mb-3">
                    How the NPC saw you across the session
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {npcToneJourney.map((item, i) => (
                      <span
                        key={i}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                          NPC_TONE_CHIP[item.tone] ?? 'bg-gray-100 text-gray-600'
                        )}
                      >
                        {item.turn}: {item.tone}
                      </span>
                    ))}
                  </div>
                  {/* End reason note */}
                  {endReason === 'npc_exit' && (
                    <p className="text-xs text-red-500 mt-2">
                      ⚠ The NPC exited at turn {fd.total_turns} due to escalation reaching level{' '}
                      {fd.final_escalation}/5
                    </p>
                  )}
                  {endReason === 'trust_sustained' && (
                    <p className="text-xs text-green-500 mt-2">
                      ✅ Trust was sustained above the threshold — NPC resolved.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── RISKS ────────────────────────────────────────── */}
          {activeSection === 'risks' && (
            <div className="grid md:grid-cols-2 gap-6">
              <RiskFlagsPanel riskFlags={fd.risk_flags} />
              <BlindSpotsPanel blindSpots={fd.blind_spots} />
            </div>
          )}

          {/* ── CHARTS ───────────────────────────────────────── */}
          {activeSection === 'charts' && (
            <div className="space-y-6">
              <QualityCurveChart
                qualityCurve={viz.quality_curve}
                trustCurve={viz.trust_curve}
                escalationCurve={viz.escalation_curve}
              />

              {/* Trust delta strip */}
              {trustDeltas.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm font-semibold text-gray-700 mb-3">Trust change per turn</p>
                  <div className="flex flex-wrap gap-2">
                    {trustDeltas.map((item, i) => (
                      <span
                        key={i}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-bold',
                          item.direction === 'up'   ? 'bg-green-100 text-green-700'
                          : item.direction === 'down' ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-500'
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
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm font-semibold text-gray-700 mb-4">Emotion Breakdown</p>
                  <div className="space-y-3">
                    {emotionEntries.map(([emotion, count]) => {
                      const pct = totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
                      return (
                        <div key={emotion} className="flex items-center gap-3">
                          <span className={cn(
                            'w-20 shrink-0 text-xs font-medium rounded-full px-2 py-0.5 text-center capitalize',
                            EMOTION_COLORS[emotion] ?? 'bg-gray-100 text-gray-700'
                          )}>
                            {emotion}
                          </span>
                          <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div
                              className={cn(
                                'h-3 rounded-full transition-all duration-700',
                                EMOTION_BAR_COLORS[emotion] ?? 'bg-gray-400'
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-14 text-right tabular-nums">
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

      {/* ── Sticky action bar ──────────────────────────────── */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 z-20">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <button
            onClick={() => navigate('/roleplay')}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <RefreshCw size={14} /> Try Again
          </button>
          <div className="flex gap-3">
            <button
              disabled
              title="Coming soon"
              className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
            >
              <Download size={14} /> Download Report
            </button>
            <button
              onClick={() => navigate('/roleplay')}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            >
              Next Scenario
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
