import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, RefreshCw, CheckCircle, XCircle, Clock, BarChart2 } from 'lucide-react'

import { rpeService }       from '@/services/rpe/rpeService'
import CoachingPanel        from '@/components/RPE/CoachingPanel'
import RiskFlagsPanel       from '@/components/RPE/RiskFlagsPanel'
import BlindSpotsPanel      from '@/components/RPE/BlindSpotsPanel'
import QualityCurveChart    from '@/components/RPE/QualityCurveChart'
import RadarSummaryCard     from '@/components/RPE/RadarSummaryCard'
import { cn } from '@/lib/utils'

const DIFFICULTY_TONE = { beginner: 'success', intermediate: 'warning', advanced: 'danger' }
const NPC_TONE_TONE   = { cooperative: 'success', neutral: 'warning', hostile: 'danger' }
const EMOTION_TONE    = { calm: 'success', assertive: 'accent', anxious: 'warning', frustrated: 'danger', confused: 'neutral' }

const SECTIONS = [
  { value: 'overview', label: 'Overview'           },
  { value: 'coaching', label: 'Coaching'           },
  { value: 'risks',    label: 'Risk & Blind Spots' },
  { value: 'charts',   label: 'Charts'             },
]

function endReasonBadge(endReason, outcome) {
  if (endReason === 'trust_sustained')        return { tone: 'success', label: 'Trust Built'  }
  if (endReason === 'npc_exit')               return { tone: 'danger',  label: 'NPC Exited'   }
  if (endReason === 'max_turns_reached' && outcome === 'success') return { tone: 'accent',  label: 'Completed' }
  if (endReason === 'max_turns_reached' && outcome === 'failure') return { tone: 'warning', label: 'Time Limit' }
  if (outcome === 'success')                  return { tone: 'success', label: 'Success'      }
  if (outcome === 'failure')                  return { tone: 'danger',  label: 'Needs Work'   }
  return                                              { tone: 'neutral', label: 'Incomplete'   }
}

function EndReasonCard({ endReason, totalTurns, recommendedTurns, maxTurns, label }) {
  const config = {
    trust_sustained:   { tone: 'success', Icon: CheckCircle },
    npc_exit:          { tone: 'danger',  Icon: XCircle },
    max_turns_reached: { tone: 'neutral', Icon: Clock },
  }
  const c = config[endReason] ?? config.max_turns_reached
  const { Icon } = c
  return (
    <div className={cn('end-card', c.tone)}>
      <Icon size={20} strokeWidth={1.8} />
      <div>
        <p className="end-card-title">{label ?? 'Session Ended'}</p>
        <p className="end-card-sub">
          Session ran {totalTurns} turns
          {recommendedTurns && ` (recommended ${recommendedTurns}`}
          {maxTurns && `, max ${maxTurns}`}
          {(recommendedTurns || maxTurns) && ')'}
        </p>
      </div>
    </div>
  )
}

function StatTile({ label, value, unit }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 128 }} />)}
    </div>
  )
}

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

  const viz              = feedbackData?.viz_payload ?? {}
  const summary          = viz.summary_scores        ?? {}
  const emotionDist      = viz.emotion_distribution  ?? {}
  const trustDeltas      = viz.trust_deltas          ?? []
  const npcToneJourney   = viz.npc_tone_journey      ?? []
  const endReason        = feedbackData?.end_reason
  const recommendedTurns = feedbackData?.recommended_turns
  const maxTurns         = feedbackData?.max_turns

  const totalEmotions  = Object.values(emotionDist).reduce((s, c) => s + c, 0)
  const emotionEntries = Object.entries(emotionDist).sort((a, b) => b[1] - a[1])

  if (isLoading) {
    return (
      <div className="rpe-cinema">
        <div className="fb-loading">
          <div className="fb-loading-icon"><BarChart2 size={24} strokeWidth={1.8} /></div>
          <p className="fb-loading-text">Analysing your session…</p>
          <div className="fb-page"><Skeleton /></div>
        </div>
        <style>{FEEDBACK_STYLES}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rpe-cinema">
        <div className="fb-error-wrap">
          <div className="fb-error-card">
            <p className="fb-error-emoji">⚠️</p>
            <h2 className="fb-error-title">Could not load feedback for this session.</h2>
            <p className="fb-error-msg">{error}</p>
            <div className="fb-error-actions">
              <button type="button" onClick={load} className="btn-c primary">
                <RefreshCw size={14} strokeWidth={1.8} /> Try again
              </button>
              <button type="button" onClick={() => navigate('/roleplay')} className="btn-c secondary">
                Back to scenarios
              </button>
            </div>
          </div>
        </div>
        <style>{FEEDBACK_STYLES}</style>
      </div>
    )
  }

  const fd    = feedbackData
  const badge = endReasonBadge(endReason, fd.outcome)

  return (
    <div className="rpe-cinema">
      <div className="fb-shell">

        <div className="fb-header">
          <div className="fb-header-inner">
            <div className="fb-header-left">
              <button type="button" onClick={() => navigate(-1)} className="fb-back" aria-label="Back">
                <ChevronLeft size={18} strokeWidth={1.6} />
              </button>
              <div style={{ minWidth: 0 }}>
                <h1 className="fb-title">Session feedback</h1>
                <div className="fb-subrow">
                  <span className="fb-scenario">{fd.scenario_title}</span>
                  {fd.difficulty && <span className={cn('pill', DIFFICULTY_TONE[fd.difficulty] ?? 'neutral')}>{fd.difficulty}</span>}
                </div>
              </div>
            </div>
            <span className={cn('pill', badge.tone)}>{badge.label}</span>
          </div>
        </div>

        <div className="fb-tabs-band">
          <div className="fb-tabs-inner">
            {SECTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={cn('fb-tab', activeSection === s.value && 'active')}
                onClick={() => setActiveSection(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="fb-page">

          <div className="stat-grid">
            <StatTile label="Final Trust" value={fd.final_trust ?? '—'} unit="/100" />
            <StatTile label="Escalation" value={fd.final_escalation ?? '—'} unit="/5" />
            <StatTile label="Turns" value={fd.total_turns ?? '—'} unit=" turns" />
            <StatTile label="Avg Quality" value={summary.avg_quality ?? '—'} unit="/10" />
          </div>

          {activeSection === 'overview' && (
            <div className="fb-section-stack">
              <EndReasonCard
                endReason={endReason}
                totalTurns={fd.total_turns}
                recommendedTurns={recommendedTurns}
                maxTurns={maxTurns}
                label={summary.end_reason_label}
              />
              <div className="grid-2">
                <RadarSummaryCard summaryScores={summary} emotionDistribution={emotionDist} />
                <CoachingPanel coachingAdvice={fd.coaching_advice} truncated onExpand={() => setActiveSection('coaching')} />
              </div>
              <div className="grid-2">
                <div>
                  <RiskFlagsPanel riskFlags={fd.risk_flags} limit={2} />
                  {fd.risk_flags?.length > 2 && (
                    <button type="button" onClick={() => setActiveSection('risks')} className="see-all">
                      See all {fd.risk_flags.length} flags →
                    </button>
                  )}
                </div>
                <div>
                  <BlindSpotsPanel blindSpots={fd.blind_spots} limit={1} />
                  {fd.blind_spots?.length > 1 && (
                    <button type="button" onClick={() => setActiveSection('risks')} className="see-all">
                      See all {fd.blind_spots.length} blind spots →
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'coaching' && (
            <div className="fb-section-stack">
              <CoachingPanel coachingAdvice={fd.coaching_advice} />

              {npcToneJourney.length > 0 && (
                <div className="panel">
                  <div className="panel-label">How the NPC saw you across the session</div>
                  <div className="pill-row">
                    {npcToneJourney.map((item, i) => (
                      <span key={i} className={cn('pill', NPC_TONE_TONE[item.tone] ?? 'neutral')}>
                        {item.turn}: <span className="cap">{item.tone}</span>
                      </span>
                    ))}
                  </div>
                  {endReason === 'npc_exit' && (
                    <p className="callout danger">⚠ The NPC exited at turn {fd.total_turns} due to escalation reaching level {fd.final_escalation}/5</p>
                  )}
                  {endReason === 'trust_sustained' && (
                    <p className="callout success">✅ Trust was sustained above the threshold — NPC resolved.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeSection === 'risks' && (
            <div className="grid-2">
              <RiskFlagsPanel riskFlags={fd.risk_flags} />
              <BlindSpotsPanel blindSpots={fd.blind_spots} />
            </div>
          )}

          {activeSection === 'charts' && (
            <div className="fb-section-stack">
              <QualityCurveChart
                qualityCurve={viz.quality_curve}
                trustCurve={viz.trust_curve}
                escalationCurve={viz.escalation_curve}
              />

              {trustDeltas.length > 0 && (
                <div className="panel">
                  <div className="panel-label">Trust change per turn</div>
                  <div className="pill-row">
                    {trustDeltas.map((item, i) => (
                      <span key={i} className={cn('pill', item.direction === 'up' ? 'success' : item.direction === 'down' ? 'danger' : 'neutral')}>
                        {item.turn}: {item.direction === 'up' ? `+${item.delta}` : item.delta === 0 ? '±0' : item.delta}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {emotionEntries.length > 0 && (
                <div className="panel">
                  <div className="panel-label">Emotion breakdown</div>
                  <div className="emotion-list">
                    {emotionEntries.map(([emotion, count]) => {
                      const pct = totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
                      return (
                        <div key={emotion} className="emotion-row">
                          <span className={cn('pill', EMOTION_TONE[emotion] ?? 'neutral')} style={{ width: 90, flexShrink: 0, justifyContent: 'center' }}>
                            <span className="cap">{emotion}</span>
                          </span>
                          <div className="emotion-track">
                            <div className={cn('emotion-fill', EMOTION_TONE[emotion] ?? 'neutral')} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="emotion-count">{count} ({pct}%)</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        <div className="fb-footer">
          <div className="fb-footer-inner">
            <button type="button" onClick={() => navigate('/roleplay')} className="btn-c primary">
              <RefreshCw size={14} strokeWidth={1.8} /> Try again
            </button>
            <button type="button" onClick={() => navigate('/roleplay')} className="btn-c secondary">
              Next scenario
            </button>
          </div>
        </div>

      </div>
      <style>{FEEDBACK_STYLES}</style>
    </div>
  )
}

const FEEDBACK_STYLES = `
  .rpe-cinema{
    --bg:            #0D1117;
    --surface:       #161B22;
    --surface-hi:    #21262D;
    --border:        #30363D;
    --primary:       #4493F8;
    --primary-glow:  rgba(68,147,248,0.15);
    --accent:        #7C3AED;
    --accent-glow:   rgba(124,58,237,0.15);
    --success:       #3FB950;
    --success-glow:  rgba(63,185,80,0.15);
    --warning:       #D29922;
    --warning-glow:  rgba(210,153,34,0.15);
    --danger:        #F85149;
    --danger-glow:   rgba(248,81,73,0.15);
    --text-hi:       #F0F6FC;
    --text-med:      #8B949E;
    --text-low:      #484F58;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);

    min-height:calc(100vh - 48px);
    background:var(--bg); color:var(--text-hi);
    font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column;
  }
  .rpe-cinema button{ font-family:inherit; }
  .rpe-cinema .cap{ text-transform:capitalize; }

  .fb-shell{ display:flex; flex-direction:column; flex:1; }

  .fb-loading{ display:flex; flex-direction:column; align-items:center; padding:40px 16px; gap:12px; }
  .fb-loading-icon{ width:48px; height:48px; border-radius:12px; background:var(--accent-glow); border:1px solid rgba(124,58,237,0.3); display:flex; align-items:center; justify-content:center; color:var(--accent); }
  .fb-loading-text{ font-size:12.5px; color:var(--text-med); margin:0 0 8px; }

  .fb-error-wrap{ flex:1; display:flex; align-items:center; justify-content:center; padding:16px; }
  .fb-error-card{ max-width:420px; width:100%; text-align:center; display:flex; flex-direction:column; gap:16px; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:32px 24px; }
  .fb-error-emoji{ font-size:28px; margin:0; }
  .fb-error-title{ font-size:16px; font-weight:700; margin:0; }
  .fb-error-msg{ font-size:12.5px; color:var(--danger); margin:0; }
  .fb-error-actions{ display:flex; gap:12px; justify-content:center; }

  .fb-header{ position:sticky; top:0; z-index:20; background:rgba(13,17,23,0.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--border); }
  .fb-header-inner{ max-width:1024px; margin:0 auto; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .fb-header-left{ display:flex; align-items:center; gap:12px; min-width:0; }
  .fb-back{ background:none; border:none; cursor:pointer; color:var(--text-med); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition:background .2s ease, color .2s ease; flex-shrink:0; }
  .fb-back:hover{ background:var(--surface-hi); color:var(--text-hi); }
  .fb-title{ font-size:15px; font-weight:700; margin:0; line-height:1.2; }
  .fb-subrow{ display:flex; align-items:center; gap:8px; margin-top:3px; }
  .fb-scenario{ font-size:11.5px; color:var(--text-med); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .fb-tabs-band{ background:var(--surface); border-bottom:1px solid var(--border); }
  .fb-tabs-inner{ max-width:1024px; margin:0 auto; padding:0 16px; display:flex; gap:22px; overflow-x:auto; }
  .fb-tab{ background:none; border:none; cursor:pointer; padding:12px 0; font-size:12.5px; font-weight:600; color:var(--text-med); border-bottom:2px solid transparent; white-space:nowrap; transition:color .2s ease, border-color .2s ease; }
  .fb-tab:hover{ color:var(--text-hi); }
  .fb-tab.active{ color:var(--primary); border-bottom-color:var(--primary); }

  .fb-page{ flex:1; padding:24px 16px; }
  .fb-page > .stat-grid, .fb-page > .fb-section-stack{ max-width:1024px; margin:0 auto; }
  .fb-section-stack{ display:flex; flex-direction:column; gap:20px; margin-top:20px; }

  .stat-grid{ display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; }
  @media (max-width:640px){ .stat-grid{ grid-template-columns:repeat(2, 1fr); } }
  .stat-tile{ background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 12px; text-align:center; }
  .stat-label{ font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); margin-bottom:6px; }
  .stat-value{ font-size:20px; font-weight:800; font-variant-numeric:tabular-nums; }
  .stat-unit{ font-size:11px; font-weight:600; color:var(--text-med); margin-left:2px; }

  .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:760px){ .grid-2{ grid-template-columns:1fr; } }

  .end-card{ display:flex; align-items:center; gap:12px; border-radius:12px; padding:14px 16px; border:1px solid transparent; }
  .end-card.success{ background:var(--success-glow); border-color:rgba(63,185,80,0.3); color:var(--success); }
  .end-card.danger{  background:var(--danger-glow);  border-color:rgba(248,81,73,0.3);  color:var(--danger); }
  .end-card.neutral{ background:var(--surface-hi); border-color:var(--border); color:var(--text-med); }
  .end-card-title{ font-size:13.5px; font-weight:650; color:var(--text-hi); margin:0; }
  .end-card-sub{ font-size:11.5px; color:var(--text-med); margin:2px 0 0; }

  .see-all{ margin-top:8px; background:none; border:none; color:var(--accent); font-size:12px; font-weight:650; cursor:pointer; }
  .see-all:hover{ text-decoration:underline; }

  .panel{ background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px; }
  .panel-label{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-low); margin-bottom:12px; }

  .pill{ display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:650; padding:4px 11px; border-radius:100px; text-transform:capitalize; }
  .pill.success{ color:var(--success); background:var(--success-glow); }
  .pill.warning{ color:var(--warning); background:var(--warning-glow); }
  .pill.danger{  color:var(--danger);  background:var(--danger-glow); }
  .pill.accent{  color:var(--accent);  background:var(--accent-glow); }
  .pill.neutral{ color:var(--text-med); background:var(--surface-hi); }
  .pill-row{ display:flex; flex-wrap:wrap; gap:8px; }

  .callout{ font-size:12.5px; font-weight:600; margin:12px 0 0; }
  .callout.danger{ color:var(--danger); }
  .callout.success{ color:var(--success); }

  .emotion-list{ display:flex; flex-direction:column; gap:12px; }
  .emotion-row{ display:flex; align-items:center; gap:12px; }
  .emotion-track{ flex:1; background:var(--surface-hi); border:1px solid var(--border); border-radius:100px; height:8px; overflow:hidden; }
  .emotion-fill{ height:100%; border-radius:100px; transition:width .7s var(--ease); }
  .emotion-fill.success{ background:var(--success); }
  .emotion-fill.warning{ background:var(--warning); }
  .emotion-fill.danger{  background:var(--danger); }
  .emotion-fill.accent{  background:var(--accent); }
  .emotion-fill.neutral{ background:var(--text-low); }
  .emotion-count{ font-size:11.5px; color:var(--text-med); width:78px; text-align:right; font-variant-numeric:tabular-nums; flex-shrink:0; }

  .skel{ background:linear-gradient(90deg, var(--surface-hi) 25%, var(--border) 50%, var(--surface-hi) 75%); background-size:200% 100%; border-radius:10px; animation:cinemaShimmer 1.4s ease-in-out infinite; }
  @keyframes cinemaShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

  .btn-c{ display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650; padding:10px 18px; border-radius:10px; cursor:pointer; border:1px solid transparent; transition:filter .2s var(--ease), border-color .2s var(--ease); }
  .btn-c.primary{ background:linear-gradient(135deg, var(--primary), #6BB2FF); color:#fff; box-shadow:0 8px 22px var(--primary-glow); }
  .btn-c.primary:hover{ filter:brightness(1.08); }
  .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
  .btn-c.secondary:hover{ border-color:var(--text-med); }

  .fb-footer{ position:sticky; bottom:0; background:var(--surface); border-top:1px solid var(--border); padding:12px 16px; z-index:20; }
  .fb-footer-inner{ max-width:1024px; margin:0 auto; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
`
