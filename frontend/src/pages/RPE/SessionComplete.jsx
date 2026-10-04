import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { RefreshCw, Home, BarChart2 } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'
import { FEEDBACK_THEME_VARS, FEEDBACK_COMPONENT_STYLES, scoreStatus } from '@/components/RPE/feedback/feedbackTheme'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'
import ScoreCard from '@/components/RPE/feedback/ScoreCard'
import OutcomeHero from '@/components/RPE/feedback/OutcomeHero'
import {
  outcomeBadge, outcomeIcon, outcomeExplanation, escalationStatus, turnsStatus,
} from '@/lib/rpe/sessionOutcome'

/*
 * SessionComplete — the quick transition screen right after a session ends
 * (both V1's RolePlaySession.jsx and V2's RolePlaySessionV2.jsx navigate
 * here with the same nav-state shape; this page is genuinely shared, there
 * was never a separate V1/V2 split for it). One tap further is
 * FeedbackDashboard.jsx, the full deep-dive.
 *
 * Redesigned to actually reuse the feedback flow's own components
 * (OutcomeHero, ScoreCard, the shared .pill/.btn-c styles) instead of a
 * separate hand-built hero — this and FeedbackDashboard now read the exact
 * same outcome badge/label for the same session (see lib/rpe/sessionOutcome.js,
 * extracted from what used to be two slightly-different copies of this
 * logic). Visual treatment is quieter than the old version on purpose —
 * softer glow, calmer entrance, closer to RolePlaySessionV2's restraint —
 * this is still a transition moment, not the deep-dive itself.
 */
export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, trustScore, escalationLevel, outcome,
    scenarioTitle, currentTurn, npcRole,
    endReason, recommendedTurns, maxTurns,
  } = location.state || {}

  const [sessionData, setSessionData] = useState(null)

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    rpeService.getSessionSummary(sessionId)
      .then(setSessionData)
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const turns       = sessionData?.turns ?? []
  const badge       = outcomeBadge(endReason, outcome)
  const icon        = outcomeIcon(endReason, outcome)
  const explanation = outcomeExplanation(endReason, outcome, scenarioTitle)
  const closingLine = turns[turns.length - 1]?.npc_response

  const heroRef = useGsapScope(({ instant }) => {
    if (instant) { gsap.set('.sc-hero-card', { opacity: 1, y: 0 }); return }
    gsap.fromTo('.sc-hero-card', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' })
  }, [])

  return (
    <div className="rpe-cinema">
      <div className="sc-page" ref={(el) => { heroRef.current = el }}>

        {scenarioTitle && <p className="sc-scenario-line cap">{scenarioTitle}</p>}

        <div className={cn('sc-hero-card', badge.tone)}>
          <span className={cn('pill', badge.tone, 'sc-badge')}>{badge.label}</span>

          <OutcomeHero finalTrust={trustScore} interpretation={explanation} icon={icon} />

          {closingLine && (
            <div className="sc-quote">
              <span className="sc-quote-label">{npcRole || 'NPC'} · final line</span>
              <p className="sc-quote-text">&ldquo;{closingLine}&rdquo;</p>
            </div>
          )}

          <div className="sc-divider" />

          <div className="sc-stats-grid">
            <ScoreCard
              label="Final Trust" value={trustScore} unit="/ 100"
              status={trustScore != null ? scoreStatus(trustScore) : null}
            />
            <ScoreCard
              label="Escalation" value={escalationLevel} unit="/ 5"
              status={escalationStatus(escalationLevel)}
            />
            <ScoreCard
              label="Turns" value={currentTurn} unit={recommendedTurns ? `/ ${recommendedTurns}` : undefined}
              status={turnsStatus(currentTurn, recommendedTurns, maxTurns)}
            />
          </div>
        </div>

        <div className="sc-actions">
          <button type="button" onClick={() => navigate(`/roleplay/feedback/${sessionId}`)} className="btn-c primary">
            <BarChart2 size={14} strokeWidth={1.8} />
            View Session Outcome
          </button>
          <button type="button" onClick={() => navigate('/roleplay')} className="btn-c secondary">
            <RefreshCw size={14} strokeWidth={1.8} />
            Try again
          </button>
          <button type="button" onClick={() => navigate('/')} className="btn-c ghost">
            <Home size={14} strokeWidth={1.8} />
            Back to home
          </button>
        </div>

      </div>

      <style>{FEEDBACK_THEME_VARS}{FEEDBACK_COMPONENT_STYLES}{SESSION_COMPLETE_STYLES}</style>
    </div>
  )
}

// Deliberately quieter than the old version's saturated glow/spinning
// badge ring — closer to RolePlaySessionV2's restraint (soft borders,
// one calm accent, no competing color noise) while staying inside the
// shared .rpe-cinema palette FeedbackDashboard also uses, so the badge/
// pill/button colors still match exactly when the learner clicks through.
const SESSION_COMPLETE_STYLES = `
  .rpe-cinema{
    min-height:calc(100vh - 48px);
    background:var(--bg);
    color:var(--text-hi);
    font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex; align-items:center; justify-content:center;
    padding:32px 20px 48px;
  }
  @media (prefers-reduced-motion: reduce){
    .rpe-cinema *{ animation-duration:0.001ms !important; transition-duration:0.001ms !important; }
  }
  .rpe-cinema .cap{ text-transform:capitalize; }
  .rpe-cinema button{ font-family:inherit; }

  .sc-page{ width:100%; max-width:620px; margin:0 auto; display:flex; flex-direction:column; gap:18px; }

  .sc-scenario-line{
    margin:0; text-align:center; font-size:11.5px; font-weight:650;
    letter-spacing:.04em; color:var(--text-low);
  }

  .sc-hero-card{
    padding:32px; border-radius:18px;
    background:var(--surface); border:1px solid var(--border);
    display:flex; flex-direction:column; align-items:flex-start;
  }
  .sc-hero-card.success{ border-color:color-mix(in srgb, var(--success) 30%, var(--border)); }
  .sc-hero-card.warning{ border-color:color-mix(in srgb, var(--warning) 30%, var(--border)); }
  .sc-hero-card.danger{  border-color:color-mix(in srgb, var(--danger) 30%, var(--border)); }
  .sc-hero-card.accent{  border-color:color-mix(in srgb, var(--accent) 30%, var(--border)); }
  .sc-hero-card.neutral{ border-color:var(--border); }

  .sc-badge{ margin-bottom:16px; }

  .sc-quote{
    margin:18px 0 0; text-align:left; max-width:520px;
    border-left:2px solid var(--border); padding-left:14px;
  }
  .sc-quote-label{ font-size:9.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-low); }
  .sc-quote-text{ font-size:13px; font-style:italic; color:var(--quote-text); margin:3px 0 0; line-height:1.55; }

  .sc-divider{ height:1px; width:100%; background:var(--border); margin:22px 0 18px; }

  .sc-stats-grid{ display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; width:100%; }
  @media (max-width:480px){ .sc-stats-grid{ grid-template-columns:1fr; } }

  .sc-actions{ display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
`
