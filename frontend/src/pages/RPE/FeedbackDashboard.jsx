import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { RefreshCw, BarChart2, AlertTriangle, Target, TrendingUp, Trophy } from 'lucide-react'

import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'
import { FEEDBACK_THEME_VARS, FEEDBACK_COMPONENT_STYLES, scoreStatus } from '@/components/RPE/feedback/feedbackTheme'
import { outcomeBadge, escalationStatus, turnsStatus } from '@/lib/rpe/sessionOutcome'
import { resolveEnvironmentId, getEnvironment } from '@/lib/rpe/sceneEnvironments'
import { useActiveSession } from '@/context/ActiveSessionContext'
import FeedbackProgress from '@/components/RPE/feedback/FeedbackProgress'
import FeedbackNavigation from '@/components/RPE/feedback/FeedbackNavigation'
import TrustJourney from '@/components/RPE/feedback/TrustJourney'
import JourneyDetail from '@/components/RPE/feedback/JourneyDetail'
import OutcomeHero from '@/components/RPE/feedback/OutcomeHero'
import ScoreCard from '@/components/RPE/feedback/ScoreCard'
import CoachingInsight from '@/components/RPE/feedback/CoachingInsight'
import ResponseComparison from '@/components/RPE/feedback/ResponseComparison'
import StrengthsImprovements from '@/components/RPE/feedback/StrengthsImprovements'
import WatchForCard from '@/components/RPE/feedback/WatchForCard'
import BehaviorTimeline from '@/components/RPE/feedback/BehaviorTimeline'
import SessionTakeaway from '@/components/RPE/feedback/SessionTakeaway'

const DIFFICULTY_TONE = { beginner: 'success', intermediate: 'warning', advanced: 'danger' }

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

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 128 }} />)}
    </div>
  )
}

function JourneyScreen({ trustCurve, trustDeltas, outcomeTone, getTurnDetail }) {
  const [selected, setSelected] = useState(trustCurve.length > 0 ? trustCurve.length - 1 : null)
  const detail = selected != null ? getTurnDetail(selected) : null

  return (
    <div className="screen">
      <div className="screen-header-compact">
        <h2 className="screen-title" style={{ fontSize: '22px', margin: 0 }}>How you got here</h2>
        <span className="screen-sub" style={{ margin: 0 }}>Select any turn point along the curve to inspect dialogue and metrics.</span>
      </div>
      <TrustJourney
        trustCurve={trustCurve}
        trustDeltas={trustDeltas}
        outcomeTone={outcomeTone}
        selectedIndex={selected}
        onSelect={setSelected}
      />
      {detail && <JourneyDetail {...detail} />}
    </div>
  )
}

function ResultScreen({ fd, summary, badge }) {
  return (
    <div className="screen">
      <p className="screen-eyebrow">Session Outcome</p>
      <h2 className="screen-title">Performance Summary</h2>
      <OutcomeHero finalTrust={fd.final_trust} interpretation={fd.coaching_advice?.summary} />
      <div className="result-grid">
        <ScoreCard label="Final Trust" value={fd.final_trust} unit="/ 100" status={scoreStatus(fd.final_trust)} />
        <ScoreCard label="Escalation" value={fd.final_escalation} unit="/ 5" status={escalationStatus(fd.final_escalation)} />
        <ScoreCard label="Turns" value={fd.total_turns} status={turnsStatus(fd.total_turns, fd.recommended_turns, fd.max_turns)} />
        {summary.avg_quality != null && (
          <ScoreCard label="Avg Quality" value={summary.avg_quality} unit="/ 10" status={scoreStatus(summary.avg_quality, { max: 10 })} />
        )}
      </div>
    </div>
  )
}

function CoachingScreen({ coachingAdvice }) {
  if (!coachingAdvice) return null
  const {
    summary, advice = [], strengths = [], focus_areas = [],
    improvement_turn, improvement_original, improvement_suggested,
  } = coachingAdvice

  return (
    <div className="screen">
      <p className="screen-eyebrow">Coaching</p>
      <h2 className="screen-title">What we noticed</h2>

      <div className="coach-block">
        <CoachingInsight summary={summary} advice={advice} />
      </div>

      {improvement_suggested && (
        <div className="coach-block">
          <p className="coach-block-label">Before &amp; after</p>
          <ResponseComparison
            turn={improvement_turn}
            original={improvement_original}
            suggested={improvement_suggested}
            focusAreas={focus_areas}
          />
        </div>
      )}

      {(strengths.length > 0 || focus_areas.length > 0) && (
        <div className="coach-block">
          <StrengthsImprovements strengths={strengths} focusAreas={focus_areas} />
        </div>
      )}
    </div>
  )
}

function WatchForScreen({ riskFlags = [], blindSpots = [], turnMetrics = [] }) {
  const items = [
    ...riskFlags.map((f) => ({
      key: `r-${f.flag_type}`, Icon: AlertTriangle,
      tone: f.severity === 'high' ? 'danger' : 'warning',
      label: WATCH_LABELS[f.flag_type] ?? toReadableLabel(f.flag_type),
      description: f.description, affectedTurns: f.affected_turns,
    })),
    ...blindSpots.map((b) => ({
      key: `b-${b.blind_spot_type}`, Icon: Target, tone: 'warning',
      label: WATCH_LABELS[b.blind_spot_type] ?? toReadableLabel(b.blind_spot_type),
      description: b.description, affectedTurns: b.affected_turns, recommendation: b.recommendation,
    })),
  ]

  return (
    <div className="screen">
      <p className="screen-eyebrow">Watch For</p>
      <h2 className="screen-title">Things to watch for next time</h2>
      <div className="watch-list">
        {items.map((item, i) => (
          <WatchForCard
            key={item.key}
            index={i}
            Icon={item.Icon}
            tone={item.tone}
            label={item.label}
            description={item.description}
            affectedTurns={item.affectedTurns}
            recommendation={item.recommendation}
          />
        ))}
      </div>
      {turnMetrics.length > 0 && (
        <div className="watch-timeline">
          <BehaviorTimeline turnMetrics={turnMetrics} riskFlags={riskFlags} blindSpots={blindSpots} />
        </div>
      )}
    </div>
  )
}

function DoneScreen({ fd, onTryAgain, onHarder, onOtherSkill }) {
  const targetSkills = fd.target_skills ?? []
  const advice = fd.coaching_advice?.advice ?? []

  return (
    <div className="screen screen-done">
      <div className="done-icon-wrap">
        <Trophy size={28} className="text-amber-400" />
      </div>
      <h2 className="screen-title">Session Complete</h2>
      <p className="screen-sub">Here's what to carry into your next practice round.</p>

      <div className="done-takeaway">
        <SessionTakeaway
          takeaway={advice[0]}
          summary={fd.coaching_advice?.summary}
          finalTrust={fd.final_trust}
          totalTurns={fd.total_turns}
          strengthCount={fd.coaching_advice?.strengths?.length ?? null}
          focusCount={fd.coaching_advice?.focus_areas?.length ?? null}
        />
      </div>

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
  const [sessionData,  setSessionData]  = useState(null)
  const [isLoading,    setIsLoading]    = useState(true)
  const [error,        setError]        = useState(null)
  const [activeStep,   setActiveStep]   = useState(0)
  const [direction,    setDirection]    = useState(1)
  const prefersReduced = useReducedMotion()

  const { setSessionData: setActiveSessionData } = useActiveSession()

  const load = useCallback(async () => {
    if (!sessionId) { navigate('/roleplay'); return }
    setIsLoading(true)
    setError(null)
    try {
      // Feedback (scores/coaching) and the raw session (turn transcripts)
      // are two different endpoints — see rpeService — fetched together so
      // the journey detail panel can show real user_input/npc_response text
      // per turn, not just its score.
      const [feedback, session] = await Promise.all([
        rpeService.getFeedback(sessionId),
        rpeService.getSessionSummary(sessionId).catch(() => null),
      ])
      setFeedbackData(feedback)
      setSessionData(session)

      const b = outcomeBadge(feedback.end_reason, feedback.outcome)
      setActiveSessionData({
        sessionId,
        scenarioTitle: feedback.scenario_title,
        difficulty: feedback.difficulty,
        badgeLabel: b?.label,
        badgeTone: b?.tone,
      })
    } catch (err) {
      setError(err.message || 'Failed to load the session outcome.')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, setActiveSessionData])

  useEffect(() => { load() }, [load])

  // Joins viz_payload.trust_curve (index 0 = "Start", index N = turn N) with
  // the raw session's turns[] (real transcript text) and turn_metrics (real
  // flags) by turn number, plus the two turns coaching_advice singles out —
  // this is the whole "click a journey point, see what actually happened"
  // feature's only data source.
  const getTurnDetail = useMemo(() => {
    if (!feedbackData) return () => null
    const trustCurve   = feedbackData.viz_payload?.trust_curve ?? []
    const trustDeltas  = feedbackData.viz_payload?.trust_deltas ?? []
    const turnMetrics  = feedbackData.turn_metrics ?? []
    const rawTurns     = sessionData?.turns ?? []
    const advice       = feedbackData.coaching_advice ?? {}

    return (index) => {
      const curvePoint = trustCurve[index]
      if (!curvePoint) return null
      if (index === 0) {
        return { turnLabel: 'Start', trustValue: curvePoint.value, direction: null }
      }
      const turnNum = index
      const metric  = turnMetrics.find((tm) => tm.turn === turnNum)
      const raw     = rawTurns.find((t) => t.turn === turnNum)
      const delta   = trustDeltas[index - 1]
      return {
        turnLabel: turnNum,
        trustValue: curvePoint.value,
        direction: delta?.direction,
        userInput: raw?.user_input,
        npcResponse: raw?.npc_response,
        flags: metric?.flags ?? [],
        isStrongest: advice.strongest_turn === turnNum,
        strongestNote: advice.strongest_turn_note,
        isImprovement: advice.improvement_turn === turnNum,
        improvementOriginal: advice.improvement_original,
        improvementSuggested: advice.improvement_suggested,
      }
    }
  }, [feedbackData, sessionData])

  if (isLoading) {
    return (
      <div className="rpe-cinema">
        <div className="fb-loading">
          <div className="fb-loading-icon"><BarChart2 size={24} strokeWidth={1.8} /></div>
          <p className="fb-loading-text">Analyzing your session…</p>
          <div className="fb-page"><Skeleton /></div>
        </div>
        <style>{FEEDBACK_THEME_VARS}{FEEDBACK_COMPONENT_STYLES}{FEEDBACK_STYLES}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rpe-cinema">
        <div className="fb-error-wrap">
          <div className="fb-error-card">
            <p className="fb-error-emoji">⚠️</p>
            <h2 className="fb-error-title">Unable to load your feedback.</h2>
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
        <style>{FEEDBACK_THEME_VARS}{FEEDBACK_COMPONENT_STYLES}{FEEDBACK_STYLES}</style>
      </div>
    )
  }

  const fd      = feedbackData
  const viz     = fd.viz_payload ?? {}
  const summary = viz.summary_scores ?? {}
  const badge   = outcomeBadge(fd.end_reason, fd.outcome)

  const hasWatchFor = (fd.risk_flags?.length > 0) || (fd.blind_spots?.length > 0)
  const STEPS = [
    { key: 'journey',  label: 'Journey' },
    { key: 'result',   label: 'Outcome' },
    { key: 'coaching', label: 'Coaching' },
    ...(hasWatchFor ? [{ key: 'watch', label: 'Watch For' }] : []),
    { key: 'done',     label: 'Next Step' },
  ]
  const stepIndex  = Math.min(activeStep, STEPS.length - 1)
  const stepKey    = STEPS[stepIndex].key
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

  const envId   = resolveEnvironmentId(fd.category, fd.conflict_type)
  const env     = getEnvironment(envId)
  const bgImage = env?.backgroundImage || '/rpe-background/rpe-env-manager-office.webp'

  return (
    <div className="rpe-cinema">
      {/* Cinematic Office Environment Photo */}
      <div className="fb-bg-photo-wrap">
        <img
          src={bgImage}
          alt=""
          className="fb-bg-photo"
          aria-hidden="true"
        />
      </div>

      {/* Darkening & vignette overlay */}
      <div className="fb-bg-overlay" />

      {/* Ambient glowing highlights */}
      <div className="fb-bg-ambient" />

      <div className="fb-shell">

        <FeedbackProgress steps={STEPS} activeIndex={stepIndex} />

        <div className={cn('fb-stage', !isLastStep && 'fb-stage-with-nav')}>
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
                  <JourneyScreen
                    trustCurve={viz.trust_curve ?? []}
                    trustDeltas={viz.trust_deltas ?? []}
                    outcomeTone={badge.tone}
                    getTurnDetail={getTurnDetail}
                  />
                )}
                {stepKey === 'result' && (
                  <ResultScreen fd={fd} summary={summary} badge={badge} />
                )}
                {stepKey === 'coaching' && (
                  <CoachingScreen coachingAdvice={fd.coaching_advice} />
                )}
                {stepKey === 'watch' && (
                  <WatchForScreen riskFlags={fd.risk_flags} blindSpots={fd.blind_spots} turnMetrics={fd.turn_metrics} />
                )}
                {stepKey === 'done' && (
                  <DoneScreen fd={fd} onTryAgain={goRoleplay} onHarder={goHarder} onOtherSkill={goRoleplay} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {!isLastStep && (
          <FeedbackNavigation onBack={goBack} onNext={goNext} backDisabled={stepIndex === 0} />
        )}

      </div>
      <style>{FEEDBACK_THEME_VARS}{FEEDBACK_COMPONENT_STYLES}{FEEDBACK_STYLES}</style>
    </div>
  )
}

const FEEDBACK_STYLES = `
  .rpe-cinema{
    min-height:calc(100vh - 48px);
    background: #080B11;
    color:var(--text-hi);
    font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column;
    position: relative;
    overflow: hidden;
  }
  @media (prefers-reduced-motion: reduce){
    .rpe-cinema *, .rpe-cinema *::before, .rpe-cinema *::after{ animation-duration:0.001ms !important; animation-iteration-count:1 !important; }
  }
  .rpe-cinema button{ font-family:inherit; }
  .rpe-cinema .cap{ text-transform:capitalize; }

  /* Office photo environment */
  .fb-bg-photo-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    z-index: 0;
    pointer-events: none;
  }
  .fb-bg-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 30%;
    filter: blur(2.5px) brightness(0.68) saturate(0.92) contrast(1.02);
    transform: scale(1.03);
    opacity: 0.88;
  }

  /* Deep cinematic darkening & vignette overlay */
  .fb-bg-overlay {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 35%, rgba(8, 10, 16, 0.48) 0%, rgba(4, 5, 10, 0.85) 100%);
    z-index: 1;
    pointer-events: none;
  }

  /* Ambient Subtle Lighting */
  .fb-bg-ambient {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 50% 12%, rgba(255, 255, 255, 0.04) 0%, transparent 60%),
      radial-gradient(circle at 85% 85%, rgba(20, 26, 40, 0.20) 0%, transparent 50%);
    z-index: 2;
  }

  .fb-shell{ position:relative; display:flex; flex-direction:column; flex:1; z-index:10; }

  .fb-loading{ display:flex; flex-direction:column; align-items:center; padding:40px 16px; gap:12px; }
  .fb-loading-icon{ width:48px; height:48px; border-radius:12px; background:var(--accent-glow); border:1px solid rgba(124,58,237,0.3); display:flex; align-items:center; justify-content:center; color:var(--accent); }
  .fb-loading-text{ font-size:12.5px; color:var(--text-med); margin:0 0 8px; }

  .fb-error-wrap{ flex:1; display:flex; align-items:center; justify-content:center; padding:16px; }
  .fb-error-card{ max-width:420px; width:100%; text-align:center; display:flex; flex-direction:column; gap:16px; background:rgba(18,22,34,0.85); backdrop-filter:blur(20px); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:32px 24px; }
  .fb-error-emoji{ font-size:28px; margin:0; }
  .fb-error-title{ font-size:16px; font-weight:700; margin:0; }
  .fb-error-msg{ font-size:12.5px; color:var(--danger); margin:0; }
  .fb-error-actions{ display:flex; gap:12px; justify-content:center; }

  .fb-stage{ flex:1; display:flex; padding:12px 24px 24px; }
  /* Reserve room so the floating side Back/Continue rails (fixed, ~88px
     from each edge) never sit on top of page content; on narrow screens
     FeedbackNavigation falls back to a bottom bar instead, so the side
     gutters aren't needed there. */
  @media (min-width:901px){ .fb-stage-with-nav{ padding-left:96px; padding-right:96px; } }
  @media (max-width:900px){ .fb-stage-with-nav{ padding-bottom:92px; } }
  @media (max-width:768px){ .fb-stage-with-nav{ padding-bottom:162px; } }
  .fb-screen-wrap{ max-width:1200px; margin:0 auto; width:100%; }

  .screen{ display:flex; flex-direction:column; gap:10px; padding-top:4px; }
  .screen-header-compact{ display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; padding-bottom:4px; }
  .screen-eyebrow{ font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin:0; }
  .screen-title{ font-size:24px; font-weight:800; letter-spacing:-0.01em; margin:0; text-wrap:balance; color:#FFFFFF; }
  .screen-sub{ font-size:13.5px; color:var(--text-med); margin:0; max-width:680px; }

  .result-grid{ display:grid; grid-template-columns:repeat(4, 1fr); gap:14px; margin-top:28px; }
  @media (max-width:820px){ .result-grid{ grid-template-columns:repeat(2, 1fr); } }
  @media (max-width:420px){ .result-grid{ grid-template-columns:1fr; } }

  .coach-block{ margin-top:26px; padding-top:22px; border-top:1px solid var(--border); }
  .coach-block:first-of-type{ margin-top:22px; padding-top:0; border-top:none; }
  .coach-block-label{ font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); margin:0 0 14px; }

  .watch-list{ display:flex; flex-direction:column; gap:10px; margin-top:20px; }
  .watch-timeline{ margin-top:28px; padding-top:22px; border-top:1px solid var(--border); }

  .screen-done{ align-items:flex-start; padding-top:20px; }
  .done-icon-wrap{
    width: 52px; height: 52px; border-radius: 16px;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.28);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 12px;
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.15);
  }
  .done-takeaway{ margin-top:22px; width:100%; max-width:640px; }
  .done-skills{ margin-top:26px; }
  .done-skills-label{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-low); margin:0 0 8px; }
  .done-skills-row{ display:flex; flex-wrap:wrap; gap:8px; }
  .done-actions{ display:flex; gap:10px; margin-top:24px; flex-wrap:wrap; }

  .skel{ background:linear-gradient(90deg, var(--surface-hi) 25%, var(--border) 50%, var(--surface-hi) 75%); background-size:200% 100%; border-radius:10px; animation:cinemaShimmer 1.4s ease-in-out infinite; }
  @keyframes cinemaShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }
  .fb-page{ flex:1; padding:24px 16px; max-width:1200px; margin:0 auto; width:100%; }

  @media (max-width:640px){
    .fb-stage{ padding:12px 16px 24px; }
  }
`
