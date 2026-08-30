import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, animate, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, RefreshCw, BarChart2, AlertTriangle, Target, TrendingUp } from 'lucide-react'

import { rpeService } from '@/services/rpe/rpeService'
import SessionRoadmap  from '@/components/RPE/SessionRoadmap'
import { cn } from '@/lib/utils'

const DIFFICULTY_TONE = { beginner: 'success', intermediate: 'warning', advanced: 'danger' }
const RATING_TONE = {
  excellent:  { tone: 'success', label: 'Excellent'  },
  good:       { tone: 'accent',  label: 'Good'        },
  needs_work: { tone: 'warning', label: 'Needs Work'  },
}

function endReasonBadge(endReason, outcome) {
  if (endReason === 'trust_sustained')        return { tone: 'success', label: 'Trust Built'  }
  if (endReason === 'npc_exit')               return { tone: 'danger',  label: 'NPC Exited'   }
  if (endReason === 'max_turns_reached' && outcome === 'success') return { tone: 'accent',  label: 'Completed' }
  if (endReason === 'max_turns_reached' && outcome === 'failure') return { tone: 'warning', label: 'Time Limit' }
  if (outcome === 'success')                  return { tone: 'success', label: 'Success'      }
  if (outcome === 'failure')                  return { tone: 'danger',  label: 'Needs Work'   }
  return                                              { tone: 'neutral', label: 'Incomplete'   }
}

function outcomeIcon(endReason, outcome) {
  if (endReason === 'trust_sustained') return '🎉'
  if (endReason === 'npc_exit')        return '💢'
  if (endReason === 'max_turns_reached') return outcome === 'success' ? '✅' : '⏱'
  if (outcome === 'success')           return '✅'
  return '👋'
}

function toReadableLabel(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Plain-language labels for the Watch For screen — the raw flag_type/
// blind_spot_type values (trust_plateau, high_escalation_turns, ...) read
// as data-analysis jargon once title-cased. Falls back to toReadableLabel
// for any type not listed here, so a new backend flag never renders blank.
const WATCH_LABELS = {
  trust_plateau:            'Trust Stopped Growing',
  escalation_spike:         'Tension Jumped Suddenly',
  passive_streak:           'Held Back Too Long',
  trust_collapse:           'Trust Dropped Fast',
  emotional_volatility:     'Tone Kept Shifting',
  low_trust_turns:          'Trust Stayed Low',
  high_escalation_turns:    'Tension Stayed High',
  dominant_negative_emotion:'A Difficult Tone Took Over',
  missed_recovery:          'Missed Chances to Calm Things Down',
}

// Animates 0 -> target once `active` is true — used for the stat reveal on
// the Result screen. Runs once per mount (each step remounts on entry).
// framer-motion's animate() drives the tween (duration is in seconds).
function useCountUp(target, active, duration = 0.8) {
  const [value, setValue] = useState(0)
  const prefersReduced = useReducedMotion()
  useEffect(() => {
    if (!active || target == null) { setValue(target ?? 0); return }
    if (prefersReduced) { setValue(target); return }
    const controls = animate(0, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [target, active, duration, prefersReduced])
  return value
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 128 }} />)}
    </div>
  )
}

function JourneyScreen({ trustCurve, trustDeltas, icon, tone }) {
  return (
    <div className="screen">
      <p className="screen-eyebrow">Your Journey</p>
      <h2 className="screen-title">How you got here</h2>
      <p className="screen-sub">Every turn, tracked — tap a point to see where trust stood.</p>
      <SessionRoadmap trustCurve={trustCurve} trustDeltas={trustDeltas} outcomeIcon={icon} outcomeTone={tone} />
    </div>
  )
}

function ResultScreen({ fd, summary, badge, icon, active }) {
  const trust = useCountUp(fd.final_trust ?? 0, active)
  const esc   = useCountUp(fd.final_escalation ?? 0, active, 0.5)
  const turns = useCountUp(fd.total_turns ?? 0, active, 0.5)

  return (
    <div className="screen">
      <p className="result-icon">{icon}</p>
      <p className="screen-eyebrow">Session Outcome</p>
      <h2 className="screen-title">{badge.label}</h2>
      <div className="result-stats">
        <div className="result-stat">
          <span className="result-val">{trust}</span>
          <span className="result-unit">/100</span>
          <span className="result-label">Final Trust</span>
        </div>
        <div className="result-stat">
          <span className="result-val">{esc}</span>
          <span className="result-unit">/5</span>
          <span className="result-label">Escalation</span>
        </div>
        <div className="result-stat">
          <span className="result-val">{turns}</span>
          <span className="result-label">Turns</span>
        </div>
        {summary.avg_quality != null && (
          <div className="result-stat">
            <span className="result-val">{summary.avg_quality}</span>
            <span className="result-unit">/10</span>
            <span className="result-label">Avg Quality</span>
          </div>
        )}
      </div>
    </div>
  )
}

const coachStepVariants = {
  hidden:  { opacity: 0, x: -10 },
  visible: (i) => ({
    opacity: 1, x: 0,
    transition: { duration: 0.35, ease: 'easeOut', delay: i * 0.22 },
  }),
}

function CoachingScreen({ coachingAdvice }) {
  if (!coachingAdvice) return null
  const {
    overall_rating, summary, advice = [], strengths = [], focus_areas = [],
    strongest_turn, strongest_turn_note,
    improvement_turn, improvement_original, improvement_suggested,
  } = coachingAdvice
  const rating = RATING_TONE[overall_rating] ?? RATING_TONE.needs_work

  return (
    <div className="screen">
      <p className="screen-eyebrow">Coaching</p>
      <div className="coach-head">
        <h2 className="screen-title">What we noticed</h2>
        <span className={cn('pill', rating.tone)}>{rating.label}</span>
      </div>
      {summary && <p className="coach-summary">{summary}</p>}

      {advice.length > 0 && (
        <ol className="coach-steps">
          {advice.map((point, i) => (
            <motion.li key={i} custom={i} variants={coachStepVariants} initial="hidden" animate="visible">
              <span className="coach-num">{i + 1}</span>
              <p>{point}</p>
            </motion.li>
          ))}
        </ol>
      )}

      {(strengths.length > 0 || focus_areas.length > 0) && (
        <div className="coach-chip-row">
          {strengths.map((s, i) => <span key={`s${i}`} className="chip success">{s}</span>)}
          {focus_areas.map((f, i) => <span key={`f${i}`} className="chip warning">{f}</span>)}
        </div>
      )}

      {strongest_turn != null && (
        <div className="callout-box success">
          <p className="callout-heading">Strongest moment — turn {strongest_turn}</p>
          <p className="callout-note">{strongest_turn_note}</p>
        </div>
      )}

      {improvement_turn != null && improvement_suggested && (
        <div className="callout-box rewrite">
          <p className="callout-heading">Try this instead — turn {improvement_turn}</p>
          {improvement_original && <p className="rewrite-original">"{improvement_original}"</p>}
          <p className="rewrite-arrow">↓</p>
          <p className="rewrite-suggested">"{improvement_suggested}"</p>
        </div>
      )}
    </div>
  )
}

const watchCardVariants = {
  hidden:  { opacity: 0, y: 8 },
  visible: (i) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.3, ease: 'easeOut', delay: i * 0.1 },
  }),
}

function WatchForScreen({ riskFlags = [], blindSpots = [] }) {
  const items = [
    ...riskFlags.map((f) => ({
      key: `r-${f.flag_type}`, Icon: AlertTriangle,
      tone: f.severity === 'high' ? 'danger' : 'warning',
      label: WATCH_LABELS[f.flag_type] ?? toReadableLabel(f.flag_type), desc: f.description,
    })),
    ...blindSpots.map((b) => ({
      key: `b-${b.blind_spot_type}`, Icon: Target, tone: 'warning',
      label: WATCH_LABELS[b.blind_spot_type] ?? toReadableLabel(b.blind_spot_type), desc: b.description,
    })),
  ]

  return (
    <div className="screen">
      <p className="screen-eyebrow">Watch For</p>
      <h2 className="screen-title">A few things to keep an eye on</h2>
      <div className="watch-list">
        {items.map((item, i) => (
          <motion.div
            key={item.key}
            custom={i}
            variants={watchCardVariants}
            initial="hidden"
            animate="visible"
            className={cn('watch-card', item.tone)}
          >
            <item.Icon size={16} strokeWidth={1.8} />
            <div>
              <p className="watch-label">{item.label}</p>
              <p className="watch-desc">{item.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function DoneScreen({ targetSkills = [], onTryAgain, onHarder, onOtherSkill }) {
  return (
    <div className="screen screen-done">
      <p className="done-emoji">🏁</p>
      <h2 className="screen-title">Nice work</h2>
      <p className="screen-sub">Ready for another round, or take what you learned into the next one.</p>
      {targetSkills.length > 0 && (
        <div className="done-skills">
          <p className="done-skills-label">This session practiced</p>
          <div className="done-skills-row">
            {targetSkills.map((s) => (
              <span key={s} className="chip accent">{s.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </div>
      )}
      <div className="done-actions">
        <button type="button" onClick={onTryAgain} className="btn-c primary">
          <RefreshCw size={14} strokeWidth={1.8} /> Try again
        </button>
        {onHarder && (
          <button type="button" onClick={onHarder} className="btn-c secondary">
            <TrendingUp size={14} strokeWidth={1.8} /> Try a harder scenario
          </button>
        )}
        <button type="button" onClick={onOtherSkill} className="btn-c secondary">Practice another skill</button>
      </div>
    </div>
  )
}

export default function FeedbackDashboard() {
  const { sessionId: paramId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const sessionId = paramId || location.state?.sessionId

  const [feedbackData, setFeedbackData] = useState(null)
  const [isLoading,    setIsLoading]    = useState(true)
  const [error,        setError]        = useState(null)
  const [activeStep,   setActiveStep]   = useState(0)
  const [direction,    setDirection]    = useState(1)
  const prefersReduced = useReducedMotion()

  const load = useCallback(async () => {
    if (!sessionId) { navigate('/roleplay'); return }
    setIsLoading(true)
    setError(null)
    try {
      const data = await rpeService.getFeedback(sessionId)
      setFeedbackData(data)
    } catch (err) {
      setError(err.message || 'Failed to load the session outcome.')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => { load() }, [load])

  if (isLoading) {
    return (
      <div className="rpe-cinema">
        <div className="fb-loading">
          <div className="fb-loading-icon"><BarChart2 size={24} strokeWidth={1.8} /></div>
          <p className="fb-loading-text">Analyzing your session…</p>
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
            <h2 className="fb-error-title">Could not load the outcome for this session.</h2>
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

  const fd      = feedbackData
  const viz     = fd.viz_payload ?? {}
  const summary = viz.summary_scores ?? {}
  const badge   = endReasonBadge(fd.end_reason, fd.outcome)
  const icon    = outcomeIcon(fd.end_reason, fd.outcome)

  const hasWatchFor = (fd.risk_flags?.length > 0) || (fd.blind_spots?.length > 0)
  const STEPS = ['journey', 'result', 'coaching', ...(hasWatchFor ? ['watch'] : []), 'done']
  const stepIndex  = Math.min(activeStep, STEPS.length - 1)
  const stepKey    = STEPS[stepIndex]
  const isLastStep = stepIndex === STEPS.length - 1

  const goNext = () => { setDirection(1);  setActiveStep((s) => Math.min(s + 1, STEPS.length - 1)) }
  const goBack = () => { setDirection(-1); setActiveStep((s) => Math.max(s - 1, 0)) }
  const goRoleplay = () => navigate('/roleplay')

  // "Try a harder scenario" pre-applies the next difficulty tier (in the same
  // category, if known) on the Practice Lab screen — hidden once already at
  // the top tier. "Practice another skill" just goes back to a fresh browse,
  // no fabricated "next best skill" recommendation.
  const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'advanced']
  const currentDiffIndex = DIFFICULTY_ORDER.indexOf(fd.difficulty)
  const nextDifficulty = currentDiffIndex >= 0 ? DIFFICULTY_ORDER[currentDiffIndex + 1] : null
  const goHarder = nextDifficulty
    ? () => navigate(`/roleplay?difficulty=${nextDifficulty}${fd.category ? `&category=${encodeURIComponent(fd.category)}` : ''}`)
    : null

  const screenVariants = prefersReduced
    ? { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        enter:  (d) => ({ opacity: 0, x: d > 0 ? 40 : -40 }),
        center: { opacity: 1, x: 0 },
        exit:   (d) => ({ opacity: 0, x: d > 0 ? -40 : 40 }),
      }

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
                <h1 className="fb-title">Session Outcome</h1>
                <div className="fb-subrow">
                  <span className="fb-scenario">{fd.scenario_title}</span>
                  {fd.difficulty && <span className={cn('pill', DIFFICULTY_TONE[fd.difficulty] ?? 'neutral')}>{fd.difficulty}</span>}
                </div>
              </div>
            </div>
            <span className={cn('pill', badge.tone)}>{badge.label}</span>
          </div>
          <div className="fb-dots">
            {STEPS.map((s, i) => (
              <span key={s} className={cn('fb-dot', i === stepIndex && 'active', i < stepIndex && 'done')} />
            ))}
          </div>
        </div>

        <div className="fb-stage">
          <div style={{ width: '100%', overflow: 'hidden' }}>
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={stepKey}
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="fb-screen-wrap"
              >
                {stepKey === 'journey' && (
                  <JourneyScreen trustCurve={viz.trust_curve ?? []} trustDeltas={viz.trust_deltas ?? []} icon={icon} tone={badge.tone} />
                )}
                {stepKey === 'result' && (
                  <ResultScreen fd={fd} summary={summary} badge={badge} icon={icon} active />
                )}
                {stepKey === 'coaching' && (
                  <CoachingScreen coachingAdvice={fd.coaching_advice} />
                )}
                {stepKey === 'watch' && (
                  <WatchForScreen riskFlags={fd.risk_flags} blindSpots={fd.blind_spots} />
                )}
                {stepKey === 'done' && (
                  <DoneScreen targetSkills={fd.target_skills} onTryAgain={goRoleplay} onHarder={goHarder} onOtherSkill={goRoleplay} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {!isLastStep && (
          <div className="fb-nav-band">
            <div className="fb-nav">
              <button type="button" onClick={goBack} disabled={stepIndex === 0} className="btn-c secondary">
                Back
              </button>
              <button type="button" onClick={goNext} className="btn-c primary">
                Continue <ChevronRight size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}

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
  @media (prefers-reduced-motion: reduce){
    .rpe-cinema *, .rpe-cinema *::before, .rpe-cinema *::after{ animation-duration:0.001ms !important; animation-iteration-count:1 !important; }
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
  .fb-header-inner{ max-width:640px; margin:0 auto; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .fb-header-left{ display:flex; align-items:center; gap:12px; min-width:0; }
  .fb-back{ background:none; border:none; cursor:pointer; color:var(--text-med); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition:background .2s ease, color .2s ease; flex-shrink:0; }
  .fb-back:hover{ background:var(--surface-hi); color:var(--text-hi); }
  .fb-title{ font-size:15px; font-weight:700; margin:0; line-height:1.2; }
  .fb-subrow{ display:flex; align-items:center; gap:8px; margin-top:3px; }
  .fb-scenario{ font-size:11.5px; color:var(--text-med); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .fb-dots{ max-width:640px; margin:0 auto; padding:0 16px 12px; display:flex; gap:6px; }
  .fb-dot{ height:4px; flex:1; border-radius:100px; background:var(--surface-hi); transition:background .3s var(--ease); }
  .fb-dot.done{ background:var(--accent); }
  .fb-dot.active{ background:linear-gradient(90deg, var(--accent), #9B6BFF); }

  .fb-stage{ flex:1; display:flex; padding:8px 16px 24px; }
  .fb-screen-wrap{ max-width:640px; margin:0 auto; width:100%; }

  .screen{ display:flex; flex-direction:column; gap:6px; padding-top:12px; }
  .screen-eyebrow{ font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin:0; }
  .screen-title{ font-size:22px; font-weight:800; letter-spacing:-0.01em; margin:2px 0 0; }
  .screen-sub{ font-size:13px; color:var(--text-med); margin:2px 0 0; }

  .result-icon{ font-size:38px; margin:0 0 4px; }
  .result-stats{ display:grid; grid-template-columns:repeat(2, 1fr); gap:14px; margin-top:20px; }
  @media (max-width:420px){ .result-stats{ grid-template-columns:1fr; } }
  .result-stat{
    background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:16px;
    display:flex; flex-direction:column; align-items:flex-start;
  }
  .result-val{ font-size:28px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--text-hi); line-height:1; }
  .result-unit{ font-size:12px; font-weight:600; color:var(--text-med); }
  .result-label{ font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); margin-top:8px; }

  .pill{ display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:650; padding:4px 11px; border-radius:100px; text-transform:capitalize; flex-shrink:0; }
  .pill.success{ color:var(--success); background:var(--success-glow); }
  .pill.warning{ color:var(--warning); background:var(--warning-glow); }
  .pill.danger{  color:var(--danger);  background:var(--danger-glow); }
  .pill.accent{  color:var(--accent);  background:var(--accent-glow); }
  .pill.neutral{ color:var(--text-med); background:var(--surface-hi); }

  .coach-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:2px; }
  .coach-summary{
    font-size:13.5px; font-style:italic; color:#C9D1D9; margin:14px 0 0;
    border-left:3px solid rgba(124,58,237,0.4); background:var(--accent-glow);
    border-radius:0 8px 8px 0; padding:10px 14px;
  }
  .coach-steps{ list-style:none; margin:18px 0 0; padding:0; display:flex; flex-direction:column; gap:14px; }
  .coach-steps li{ display:flex; gap:12px; align-items:flex-start; }
  .coach-steps p{ margin:0; font-size:13.5px; line-height:1.6; color:#C9D1D9; padding-top:2px; }
  .coach-num{
    width:24px; height:24px; border-radius:50%; background:var(--accent); color:#fff;
    font-size:11.5px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;
  }
  .coach-chip-row{ display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
  .chip{ font-size:11.5px; font-weight:600; padding:5px 12px; border-radius:100px; text-transform:capitalize; }
  .chip.success{ color:var(--success); background:var(--success-glow); }
  .chip.warning{ color:var(--warning); background:var(--warning-glow); }
  .chip.accent{  color:var(--accent);  background:var(--accent-glow); }

  .callout-box{ margin-top:18px; border-radius:12px; padding:14px 16px; border:1px solid transparent; }
  .callout-box.success{ background:var(--success-glow); border-color:rgba(63,185,80,0.25); }
  .callout-box.rewrite{ background:var(--surface); border-color:var(--border); }
  .callout-heading{ font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; margin:0 0 8px; }
  .callout-box.success .callout-heading{ color:var(--success); }
  .callout-box.rewrite .callout-heading{ color:var(--text-low); }
  .callout-note{ font-size:13px; color:var(--text-hi); margin:0; line-height:1.55; }
  .rewrite-original{ font-size:13px; color:var(--text-med); font-style:italic; margin:0; text-decoration:line-through; text-decoration-color:rgba(248,81,73,0.5); }
  .rewrite-arrow{ font-size:12px; color:var(--text-low); margin:6px 0; }
  .rewrite-suggested{ font-size:13.5px; color:var(--text-hi); font-style:italic; margin:0; font-weight:600; }

  .watch-list{ display:flex; flex-direction:column; gap:10px; margin-top:16px; }
  .watch-card{
    display:flex; gap:12px; align-items:flex-start; border-radius:12px; padding:14px 16px; border:1px solid transparent;
  }
  .watch-card.danger{  background:var(--danger-glow);  border-color:rgba(248,81,73,0.25);  color:var(--danger); }
  .watch-card.warning{ background:var(--warning-glow); border-color:rgba(210,153,34,0.25); color:var(--warning); }
  .watch-card svg{ flex-shrink:0; margin-top:2px; }
  .watch-label{ font-size:13px; font-weight:700; color:var(--text-hi); margin:0; }
  .watch-desc{ font-size:12.5px; color:var(--text-med); margin:4px 0 0; line-height:1.5; }

  .screen-done{ align-items:center; text-align:center; padding-top:32px; }
  .done-emoji{ font-size:40px; margin:0 0 6px; }
  .done-skills{ margin-top:18px; }
  .done-skills-label{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-low); margin:0 0 8px; }
  .done-skills-row{ display:flex; flex-wrap:wrap; justify-content:center; gap:8px; }
  .done-actions{ display:flex; gap:10px; margin-top:22px; }

  .skel{ background:linear-gradient(90deg, var(--surface-hi) 25%, var(--border) 50%, var(--surface-hi) 75%); background-size:200% 100%; border-radius:10px; animation:cinemaShimmer 1.4s ease-in-out infinite; }
  @keyframes cinemaShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }
  .fb-page{ flex:1; padding:24px 16px; max-width:640px; margin:0 auto; width:100%; }

  .btn-c{ display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650; padding:10px 18px; border-radius:10px; cursor:pointer; border:1px solid transparent; transition:filter .2s var(--ease), border-color .2s var(--ease); }
  .btn-c.primary{ background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff; box-shadow:0 8px 22px var(--accent-glow); }
  .btn-c.primary:hover{ filter:brightness(1.08); }
  .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
  .btn-c.secondary:hover{ border-color:var(--text-med); }
  .btn-c.secondary:disabled{ opacity:.4; cursor:default; }

  .fb-nav-band{ position:sticky; bottom:0; z-index:20; background:var(--surface); border-top:1px solid var(--border); }
  .fb-nav{
    max-width:640px; margin:0 auto; padding:12px 16px;
    display:flex; justify-content:space-between; align-items:center; gap:12px;
  }
`
