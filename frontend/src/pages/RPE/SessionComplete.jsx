import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { RefreshCw, Home, BarChart2 } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'
import { FEEDBACK_THEME_VARS, scoreStatus } from '@/components/RPE/feedback/feedbackTheme'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'
import ScoreCard from '@/components/RPE/feedback/ScoreCard'

// Escalation is "lower is better", unlike trust/quality — scoreStatus()
// doesn't apply. Same thresholds FeedbackDashboard's ResultScreen uses, so
// this reads the same way whether you're here or on the outcome screen.
function escalationStatus(value) {
  if (value == null) return null
  if (value === 0) return { tone: 'success', label: 'No escalation needed' }
  if (value <= 2)  return { tone: 'accent',  label: 'Mostly calm' }
  if (value === 3) return { tone: 'warning', label: 'Some tension' }
  return { tone: 'danger', label: 'Escalated' }
}

function turnsStatus(total, recommended) {
  if (total == null) return null
  if (recommended != null && total <= recommended) return { tone: 'success', label: 'Efficient' }
  return { tone: 'neutral', label: 'On track' }
}

// Always "Session Complete" as the headline — the session finishing and the
// scenario's objective being met are two different things, and the old
// version conflated them (e.g. titling a low-score run "Maximum Turns
// Reached", which reads as the app failing to finish rather than the
// objective not landing). Status/explanation carry the honest read instead,
// separately from whether the session itself completed.
function outcomeMeta(endReason, outcome, scenarioTitle) {
  if (endReason === 'trust_sustained' || outcome === 'success') {
    return {
      variant: 'success', icon: '🎉',
      statusLabel: 'Strong outcome', statusTone: 'success',
      explanation: 'You built enough trust to resolve the situation.',
    }
  }
  if (endReason === 'npc_exit') {
    return {
      variant: 'danger', icon: '💢',
      statusLabel: 'Needs improvement', statusTone: 'danger',
      explanation: 'The conversation ended early because of repeated inappropriate language. Your feedback below breaks down what happened and how to approach it differently.',
    }
  }
  if (outcome === 'ended_by_user') {
    return {
      variant: 'neutral', icon: '👋',
      statusLabel: 'Ended by you', statusTone: 'neutral',
      explanation: 'You chose to end the conversation before it fully resolved. Review your outcome below to see where things stood.',
    }
  }
  if (endReason === 'max_turns_reached') {
    return {
      variant: 'warning', icon: '⏱',
      statusLabel: 'Needs improvement', statusTone: 'warning',
      explanation: "You completed the conversation, but the core objective wasn't fully resolved by the turn limit.",
    }
  }
  return {
    variant: 'warning', icon: '👋',
    statusLabel: 'Needs improvement', statusTone: 'warning',
    explanation: `You completed the conversation${scenarioTitle ? ` in "${scenarioTitle}"` : ''}, but the core objective wasn't fully resolved.`,
  }
}

export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, trustScore, escalationLevel, outcome,
    scenarioTitle, currentTurn, npcRole,
    endReason, recommendedTurns,
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
  const meta        = outcomeMeta(endReason, outcome, scenarioTitle)
  const closingLine = turns[turns.length - 1]?.npc_response

  const heroRef = useGsapScope(({ instant }) => {
    if (instant) { gsap.set('.hero-card', { opacity: 1, y: 0 }); return }
    gsap.fromTo('.hero-card', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' })
  }, [])

  return (
    <div className="rpe-cinema">
      <div className="page" ref={(el) => { heroRef.current = el }}>

        <div className={cn('hero-card', meta.variant)}>
          <div className="hero-top">
            <div className={cn('hero-badge', meta.variant)}>
              <div className="hero-badge-inner"><span className="hero-icon">{meta.icon}</span></div>
            </div>
            <div className="hero-text">
              <div className="hero-title">Session Complete</div>
              <span className={cn('hero-status', meta.statusTone)}>{meta.statusLabel}</span>
            </div>
          </div>

          <p className="hero-explanation">{meta.explanation}</p>

          {closingLine && (
            <div className="hero-quote">
              <span className="hero-quote-label">{npcRole || 'NPC'} · final line</span>
              <p className="hero-quote-text">"{closingLine}"</p>
            </div>
          )}

          <div className="hero-divider" />

          <div className="hero-stats-grid">
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
              status={turnsStatus(currentTurn, recommendedTurns)}
            />
          </div>
        </div>

        <div className="actions">
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

      <style>{FEEDBACK_THEME_VARS}{`
        .rpe-cinema{
          min-height:calc(100vh - 48px);
          background:
            radial-gradient(60% 50% at 50% 0%, rgba(124,58,237,0.10) 0%, transparent 60%),
            var(--bg);
          color:var(--text-hi);
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          -webkit-font-smoothing:antialiased;
          padding:32px 24px 48px;
        }
        @media (prefers-reduced-motion: reduce){
          .rpe-cinema *{ animation-duration:0.001ms !important; transition-duration:0.001ms !important; }
        }
        .rpe-cinema .cap{ text-transform:capitalize; }
        .rpe-cinema button{ font-family:inherit; }

        .rpe-cinema .page{ max-width:1100px; margin:0 auto; display:flex; flex-direction:column; gap:16px; }

        .rpe-cinema .hero-card{
          padding:28px 32px; border-radius:16px;
          background:var(--surface-hi); border:1px solid var(--border);
        }
        .rpe-cinema .hero-card.success{ border-color:rgba(63,185,80,0.35); box-shadow:0 20px 50px rgba(63,185,80,0.1); }
        .rpe-cinema .hero-card.warning{ border-color:rgba(210,153,34,0.35); box-shadow:0 20px 50px rgba(210,153,34,0.1); }
        .rpe-cinema .hero-card.danger{  border-color:rgba(248,81,73,0.35); box-shadow:0 20px 50px rgba(248,81,73,0.1); }
        .rpe-cinema .hero-card.neutral{ border-color:rgba(124,58,237,0.35); box-shadow:0 20px 50px rgba(124,58,237,0.1); }

        .rpe-cinema .hero-top{ display:flex; align-items:center; gap:18px; }
        .rpe-cinema .hero-badge{ position:relative; width:56px; height:56px; border-radius:50%; flex-shrink:0; }
        .rpe-cinema .hero-badge::before{ content:""; position:absolute; inset:0; border-radius:50%; animation: cinemaRingPulse 2.4s var(--ease) infinite; }
        .rpe-cinema .hero-badge.success::before{ background:conic-gradient(from 0deg, var(--success), #6BDE85, var(--success)); }
        .rpe-cinema .hero-badge.warning::before{ background:conic-gradient(from 0deg, var(--warning), #F0C05A, var(--warning)); }
        .rpe-cinema .hero-badge.danger::before{  background:conic-gradient(from 0deg, var(--danger), #FF8A85, var(--danger)); }
        .rpe-cinema .hero-badge.neutral::before{ background:conic-gradient(from 0deg, var(--accent), #9B6BFF, var(--accent)); }
        @keyframes cinemaRingPulse{ 0%,100%{ opacity:.6; } 50%{ opacity:1; } }
        .rpe-cinema .hero-badge-inner{
          position:absolute; inset:3px; border-radius:50%;
          background:linear-gradient(160deg, var(--surface-hi), var(--surface));
          border:1px solid var(--border);
          display:flex; align-items:center; justify-content:center;
        }
        .rpe-cinema .hero-icon{ font-size:22px; line-height:1; }
        .rpe-cinema .hero-text{ min-width:0; display:flex; flex-direction:column; gap:5px; }
        .rpe-cinema .hero-title{ font-size:19px; font-weight:750; letter-spacing:-0.01em; }
        .rpe-cinema .hero-status{ display:inline-flex; align-self:flex-start; font-size:11px; font-weight:700; padding:3px 10px; border-radius:100px; }
        .rpe-cinema .hero-status.success{ color:var(--success); background:var(--success-glow); }
        .rpe-cinema .hero-status.warning{ color:var(--warning); background:var(--warning-glow); }
        .rpe-cinema .hero-status.danger{  color:var(--danger);  background:var(--danger-glow); }
        .rpe-cinema .hero-status.neutral{ color:var(--accent);  background:var(--accent-glow); }

        .rpe-cinema .hero-explanation{ font-size:13.5px; line-height:1.6; color:var(--text-med); margin:16px 0 0; max-width:640px; }

        .rpe-cinema .hero-quote{
          margin:16px 0 0; text-align:left;
          border-left:2px solid rgba(124,58,237,0.5); padding-left:14px;
        }
        .rpe-cinema .hero-quote-label{ font-size:9.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); }
        .rpe-cinema .hero-quote-text{ font-size:13px; font-style:italic; color:var(--quote-text); margin:3px 0 0; line-height:1.55; }

        .rpe-cinema .hero-divider{ height:1px; background:var(--border); margin:18px 0 16px; }

        .rpe-cinema .hero-stats-grid{ display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; }
        @media (max-width:520px){ .rpe-cinema .hero-stats-grid{ grid-template-columns:1fr; } }

        .rpe-cinema .actions{ display:flex; gap:10px; justify-content:center; flex-wrap:wrap; padding-top:4px; }
        .rpe-cinema .btn-c{
          display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650;
          padding:10px 16px; border-radius:10px; cursor:pointer; border:1px solid transparent;
          transition:filter .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease), transform .2s var(--ease);
        }
        .rpe-cinema .btn-c.primary{ background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff; box-shadow:0 8px 22px var(--accent-glow); }
        .rpe-cinema .btn-c.primary:hover{ filter:brightness(1.08); transform:translateY(-1px); }
        .rpe-cinema .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
        .rpe-cinema .btn-c.secondary:hover{ border-color:var(--text-med); }
        .rpe-cinema .btn-c.ghost{ background:transparent; color:var(--text-med); }
        .rpe-cinema .btn-c.ghost:hover{ color:var(--text-hi); background:var(--surface-hi); }
      `}</style>
    </div>
  )
}
