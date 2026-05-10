import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, RefreshCw, CheckCircle, XCircle, Clock, BarChart2 } from 'lucide-react'

import { rpeService }       from '@/services/rpe/rpeService'
import CoachingPanel        from '@/components/RPE/CoachingPanel'
import RiskFlagsPanel       from '@/components/RPE/RiskFlagsPanel'
import BlindSpotsPanel      from '@/components/RPE/BlindSpotsPanel'
import QualityCurveChart    from '@/components/RPE/QualityCurveChart'
import RadarSummaryCard     from '@/components/RPE/RadarSummaryCard'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import TabNav from '@/components/ui/TabNav'
import StatCard from '@/components/ui/StatCard'

/* ── helpers ──────────────────────────────────────────────── */
// REDESIGN: replaced hardcoded -100/-700 chip pairs with Badge variants
const DIFFICULTY_BADGE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

const NPC_TONE_BADGE = {
  cooperative: 'success',
  neutral:     'warning',
  hostile:     'danger',
}

const EMOTION_BADGE = {
  calm:       'success',
  assertive:  'accent',
  anxious:    'warning',
  frustrated: 'danger',
  confused:   'neutral',
}

// REDESIGN: emotion bar fills now use chart-* tokens (was bg-gradient-to-r hex colors)
const EMOTION_BAR_COLOR = {
  calm:       'var(--chart-2)',
  assertive:  'var(--chart-1)',
  anxious:    'var(--chart-3)',
  frustrated: 'var(--chart-5)',
  confused:   'var(--text-tertiary)',
}

const SECTIONS = [
  { value: 'overview', label: 'Overview'           },
  { value: 'coaching', label: 'Coaching'           },
  { value: 'risks',    label: 'Risk & Blind Spots' },
  { value: 'charts',   label: 'Charts'             },
]

/* ── end reason badge config ─────────────────────────────── */
function endReasonBadge(endReason, outcome) {
  if (endReason === 'trust_sustained')        return { variant: 'success', label: 'Trust Built'  }
  if (endReason === 'npc_exit')               return { variant: 'danger',  label: 'NPC Exited'   }
  if (endReason === 'max_turns_reached' && outcome === 'success') return { variant: 'accent',  label: 'Completed' }
  if (endReason === 'max_turns_reached' && outcome === 'failure') return { variant: 'warning', label: 'Time Limit' }
  if (outcome === 'success')                  return { variant: 'success', label: 'Success'      }
  if (outcome === 'failure')                  return { variant: 'danger',  label: 'Needs Work'   }
  return                                              { variant: 'neutral', label: 'Incomplete'   }
}

/* ── end reason context card ─────────────────────────────── */
// REDESIGN: replaced hardcoded bg-emerald-50/red-50 backgrounds with semantic tokens + accent stripe
function EndReasonCard({ endReason, totalTurns, recommendedTurns, maxTurns, label }) {
  const config = {
    trust_sustained:   { bg: 'var(--success-soft)', border: 'oklch(0.700 0.150 165 / 0.4)', Icon: CheckCircle, color: 'var(--success)' },
    npc_exit:          { bg: 'var(--danger-soft)',  border: 'oklch(0.660 0.180 20 / 0.4)',  Icon: XCircle,    color: 'var(--danger)' },
    max_turns_reached: { bg: 'var(--bg-elevated)',  border: 'var(--border-subtle)',          Icon: Clock,      color: 'var(--text-tertiary)' },
  }
  const c = config[endReason] ?? config.max_turns_reached
  const { Icon } = c
  return (
    <div
      style={{
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${c.border}`,
        background: c.bg,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Icon size={20} strokeWidth={1.8} style={{ color: c.color, flexShrink: 0 }} />
      <div>
        <p className="fg" style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{label ?? 'Session Ended'}</p>
        <p className="t-cap" style={{ marginTop: 2 }}>
          Session ran {totalTurns} turns
          {recommendedTurns && ` (recommended ${recommendedTurns}`}
          {maxTurns && `, max ${maxTurns}`}
          {(recommendedTurns || maxTurns) && ')'}
        </p>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="skel" style={{ height: 128 }} />
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
      <div style={{ padding: '40px 16px' }}>
        <div style={{ maxWidth: 1024, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 'var(--radius)',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BarChart2 size={24} strokeWidth={1.8} style={{ color: 'var(--accent)' }} className="animate-pulse" />
            </div>
            <p className="t-cap">Analysing your session…</p>
          </div>
          <Skeleton />
        </div>
      </div>
    )
  }

  /* ── ERROR ────────────────────────────────────────────── */
  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <Card style={{ maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 28, margin: 0 }} aria-hidden>⚠️</p>
          <h2 className="t-h3" style={{ margin: 0 }}>Could not load feedback for this session.</h2>
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{error}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button type="button" onClick={load} className="btn btn-primary">
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} strokeWidth={1.8} /> Try again
              </span>
            </button>
            <button type="button" onClick={() => navigate('/roleplay')} className="btn btn-secondary">
              <span className="btn-label">Back to scenarios</span>
            </button>
          </div>
        </Card>
      </div>
    )
  }

  /* ── LOADED ───────────────────────────────────────────── */
  const fd    = feedbackData
  const badge = endReasonBadge(endReason, fd.outcome)

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      {/* REDESIGN: sticky page header restyled to match Topbar/.bg-canvas convention */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'oklch(0.145 0.015 264 / 0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            maxWidth: 1024,
            margin: '0 auto',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="icon-btn"
              aria-label="Back"
            >
              <ChevronLeft size={18} strokeWidth={1.6} />
            </button>
            <div style={{ minWidth: 0 }}>
              <h1 className="t-h3" style={{ margin: 0, lineHeight: 1.2 }}>Session feedback</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span
                  className="t-cap"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {fd.scenario_title}
                </span>
                {fd.difficulty && (
                  <Badge variant={DIFFICULTY_BADGE[fd.difficulty] ?? 'neutral'}>
                    <span style={{ textTransform: 'capitalize' }}>{fd.difficulty}</span>
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {/* REDESIGN: badge pill replaced with Badge component */}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </div>

      {/* REDESIGN: 4-tab nav switched to TabNav component (sliding indicator) */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ maxWidth: 1024, margin: '0 auto', padding: '0 16px' }}>
          <TabNav
            value={activeSection}
            onChange={setActiveSection}
            options={SECTIONS}
          />
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '24px 16px' }}>
        <div
          style={{
            maxWidth: 1024,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >

          {/* REDESIGN: 4 score boxes replaced with StatCard component */}
          <div className="grid-4">
            <StatCard
              label="Final Trust"
              value={fd.final_trust ?? '—'}
              unit="/100"
            />
            <StatCard
              label="Escalation"
              value={fd.final_escalation ?? '—'}
              unit="/5"
            />
            <StatCard
              label="Turns"
              value={fd.total_turns ?? '—'}
              unit=" turns"
            />
            <StatCard
              label="Avg Quality"
              value={summary.avg_quality ?? '—'}
              unit="/10"
            />
          </div>

          {/* ── OVERVIEW ──────────────────────────────────────── */}
          {activeSection === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <EndReasonCard
                endReason={endReason}
                totalTurns={fd.total_turns}
                recommendedTurns={recommendedTurns}
                maxTurns={maxTurns}
                label={summary.end_reason_label}
              />
              <div className="grid-2">
                <RadarSummaryCard summaryScores={summary} emotionDistribution={emotionDist} />
                <CoachingPanel
                  coachingAdvice={fd.coaching_advice}
                  truncated
                  onExpand={() => setActiveSection('coaching')}
                />
              </div>
              <div className="grid-2">
                <div>
                  <RiskFlagsPanel riskFlags={fd.risk_flags} limit={2} />
                  {fd.risk_flags?.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setActiveSection('risks')}
                      className="t-cap"
                      style={{
                        marginTop: 8,
                        background: 'transparent',
                        border: 0,
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      See all {fd.risk_flags.length} flags →
                    </button>
                  )}
                </div>
                <div>
                  <BlindSpotsPanel blindSpots={fd.blind_spots} limit={1} />
                  {fd.blind_spots?.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setActiveSection('risks')}
                      className="t-cap"
                      style={{
                        marginTop: 8,
                        background: 'transparent',
                        border: 0,
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <CoachingPanel coachingAdvice={fd.coaching_advice} />

              {npcToneJourney.length > 0 && (
                <Card>
                  <div className="t-over" style={{ marginBottom: 12 }}>
                    How the NPC saw you across the session
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {npcToneJourney.map((item, i) => (
                      <Badge key={i} variant={NPC_TONE_BADGE[item.tone] ?? 'neutral'}>
                        {item.turn}: <span style={{ textTransform: 'capitalize' }}>{item.tone}</span>
                      </Badge>
                    ))}
                  </div>
                  {endReason === 'npc_exit' && (
                    <p className="t-cap" style={{ color: 'var(--danger)', marginTop: 12, fontWeight: 500 }}>
                      ⚠ The NPC exited at turn {fd.total_turns} due to escalation reaching level {fd.final_escalation}/5
                    </p>
                  )}
                  {endReason === 'trust_sustained' && (
                    <p className="t-cap" style={{ color: 'var(--success)', marginTop: 12, fontWeight: 500 }}>
                      ✅ Trust was sustained above the threshold — NPC resolved.
                    </p>
                  )}
                </Card>
              )}
            </div>
          )}

          {/* ── RISKS ─────────────────────────────────────────── */}
          {activeSection === 'risks' && (
            <div className="grid-2">
              <RiskFlagsPanel riskFlags={fd.risk_flags} />
              <BlindSpotsPanel blindSpots={fd.blind_spots} />
            </div>
          )}

          {/* ── CHARTS ────────────────────────────────────────── */}
          {activeSection === 'charts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <QualityCurveChart
                qualityCurve={viz.quality_curve}
                trustCurve={viz.trust_curve}
                escalationCurve={viz.escalation_curve}
              />

              {/* REDESIGN: trust delta strip uses Badge variants */}
              {trustDeltas.length > 0 && (
                <Card>
                  <div className="t-over" style={{ marginBottom: 12 }}>Trust change per turn</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {trustDeltas.map((item, i) => (
                      <Badge
                        key={i}
                        variant={
                          item.direction === 'up' ? 'success'
                          : item.direction === 'down' ? 'danger'
                          : 'neutral'
                        }
                      >
                        {item.turn}: {item.direction === 'up' ? `+${item.delta}` : item.delta === 0 ? '±0' : item.delta}
                      </Badge>
                    ))}
                  </div>
                </Card>
              )}

              {/* REDESIGN: emotion distribution bars now use chart-* tokens via CSS variables */}
              {emotionEntries.length > 0 && (
                <Card>
                  <div className="t-over" style={{ marginBottom: 14 }}>Emotion breakdown</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {emotionEntries.map(([emotion, count]) => {
                      const pct = totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
                      return (
                        <div
                          key={emotion}
                          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                        >
                          <span style={{ width: 88, flexShrink: 0 }}>
                            <Badge variant={EMOTION_BADGE[emotion] ?? 'neutral'}>
                              <span style={{ textTransform: 'capitalize' }}>{emotion}</span>
                            </Badge>
                          </span>
                          <div
                            style={{
                              flex: 1,
                              background: 'var(--bg-input)',
                              borderRadius: 999,
                              height: 8,
                              overflow: 'hidden',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${pct}%`,
                                borderRadius: 999,
                                background: EMOTION_BAR_COLOR[emotion] ?? 'var(--text-tertiary)',
                                transition: 'width 700ms var(--ease)',
                              }}
                            />
                          </div>
                          <span
                            className="score-num"
                            style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 70, textAlign: 'right', fontWeight: 500 }}
                          >
                            {count} ({pct}%)
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}

        </div>
      </div>

      {/* REDESIGN: sticky bottom action bar restyled with .btn classes */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          padding: '12px 16px',
          zIndex: 20,
        }}
      >
        <div
          style={{
            maxWidth: 1024,
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => navigate('/roleplay')}
            className="btn btn-primary"
          >
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={14} strokeWidth={1.8} /> Try again
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/roleplay')}
            className="btn btn-secondary"
          >
            <span className="btn-label">Next scenario</span>
          </button>
        </div>
      </div>

    </div>
  )
}
