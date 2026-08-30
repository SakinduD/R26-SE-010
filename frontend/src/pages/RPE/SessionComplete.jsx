import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RefreshCw, Home, BarChart2 } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'

const getTrustTone = (s) => (s >= 70 ? 'success' : s >= 40 ? 'warning' : 'danger')

const OUTCOME_META = {
  trust_sustained: {
    variant: 'success',
    icon: '🎉',
    title: 'Session Complete: Success!',
    sub: 'You built enough trust to resolve the situation.',
  },
  npc_exit: {
    variant: 'danger',
    icon: '💢',
    title: 'The Conversation Broke Down',
    sub: 'The session ended because of repeated inappropriate language. Review your outcome below.',
  },
}

function outcomeMeta(endReason, outcome, scenarioTitle) {
  let meta = OUTCOME_META[endReason]
  let title, sub, icon
  if (meta) {
    title = meta.title; sub = meta.sub; icon = meta.icon
  } else if (endReason === 'max_turns_reached') {
    meta = { variant: outcome === 'success' ? 'success' : 'warning' }
    icon = outcome === 'success' ? '✅' : '⏱'
    title = outcome === 'success' ? 'Session Complete' : 'Maximum Turns Reached'
    sub = outcome === 'success'
      ? 'You reached the turn limit, scored on final results.'
      : 'Check your outcome for improvement tips.'
  } else {
    meta = { variant: outcome === 'success' ? 'success' : 'natural' }
    icon = outcome === 'success' ? '✅' : '👋'
    title = outcome === 'success' ? 'Session Complete: Success!' : 'Session Complete: Keep Practicing'
    sub = scenarioTitle
  }
  return { ...meta, title, sub, icon }
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

  return (
    <div className="rpe-cinema">
      <div className="page">

        <div className={cn('hero-card', meta.variant)}>
          <div className="hero-top">
            <div className={cn('hero-badge', meta.variant)}>
              <div className="hero-badge-inner"><span className="hero-icon">{meta.icon}</span></div>
            </div>
            <div className="hero-text">
              <div className="hero-title">{meta.title}</div>
              <p className="hero-sub">{meta.sub}</p>
            </div>
          </div>

          {closingLine && (
            <div className="hero-quote">
              <span className="hero-quote-label">{npcRole || 'NPC'} · final line</span>
              <p className="hero-quote-text">"{closingLine}"</p>
            </div>
          )}

          <div className="hero-divider" />

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-label">Final Trust</span>
              <span className={cn('hero-stat-val', trustScore != null ? getTrustTone(trustScore) : '')}>{trustScore ?? '—'}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-label">Escalation</span>
              <span className="hero-stat-val">{escalationLevel ?? '—'}<span className="unit">/5</span></span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-label">Turns</span>
              <span className="hero-stat-val">{currentTurn ?? '—'}{recommendedTurns ? <span className="unit">/{recommendedTurns}</span> : null}</span>
            </div>
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

      <style>{`
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

        .rpe-cinema .page{ max-width:1080px; margin:0 auto; display:flex; flex-direction:column; gap:16px; }

        .rpe-cinema .hero-card{
          padding:24px 28px; border-radius:16px;
          background:var(--surface-hi); border:1px solid var(--border);
          opacity:0; transform:translateY(10px);
          animation: cinemaIn .45s var(--ease) forwards;
        }
        @keyframes cinemaIn{ to{ opacity:1; transform:none; } }
        .rpe-cinema .hero-card.success{ border-color:rgba(63,185,80,0.35); box-shadow:0 20px 50px rgba(63,185,80,0.1); }
        .rpe-cinema .hero-card.warning{ border-color:rgba(210,153,34,0.35); box-shadow:0 20px 50px rgba(210,153,34,0.1); }
        .rpe-cinema .hero-card.danger{  border-color:rgba(248,81,73,0.35); box-shadow:0 20px 50px rgba(248,81,73,0.1); }
        .rpe-cinema .hero-card.natural{ border-color:rgba(124,58,237,0.35); box-shadow:0 20px 50px rgba(124,58,237,0.1); }

        .rpe-cinema .hero-top{ display:flex; align-items:center; gap:18px; }
        .rpe-cinema .hero-badge{ position:relative; width:56px; height:56px; border-radius:50%; flex-shrink:0; }
        .rpe-cinema .hero-badge::before{ content:""; position:absolute; inset:0; border-radius:50%; animation: cinemaRingPulse 2.4s var(--ease) infinite; }
        .rpe-cinema .hero-badge.success::before{ background:conic-gradient(from 0deg, var(--success), #6BDE85, var(--success)); }
        .rpe-cinema .hero-badge.warning::before{ background:conic-gradient(from 0deg, var(--warning), #F0C05A, var(--warning)); }
        .rpe-cinema .hero-badge.danger::before{  background:conic-gradient(from 0deg, var(--danger), #FF8A85, var(--danger)); }
        .rpe-cinema .hero-badge.natural::before{ background:conic-gradient(from 0deg, var(--accent), #9B6BFF, var(--accent)); }
        @keyframes cinemaRingPulse{ 0%,100%{ opacity:.6; } 50%{ opacity:1; } }
        .rpe-cinema .hero-badge-inner{
          position:absolute; inset:3px; border-radius:50%;
          background:linear-gradient(160deg, var(--surface-hi), var(--surface));
          border:1px solid var(--border);
          display:flex; align-items:center; justify-content:center;
        }
        .rpe-cinema .hero-icon{ font-size:22px; line-height:1; }
        .rpe-cinema .hero-text{ min-width:0; }
        .rpe-cinema .hero-title{ font-size:18px; font-weight:750; letter-spacing:-0.01em; }
        .rpe-cinema .hero-sub{ font-size:12.5px; color:var(--text-med); margin:3px 0 0; }

        .rpe-cinema .hero-quote{
          margin:16px 0 0 74px; text-align:left;
          border-left:2px solid rgba(124,58,237,0.5); padding-left:14px;
        }
        .rpe-cinema .hero-quote-label{ font-size:9.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); }
        .rpe-cinema .hero-quote-text{ font-size:13px; font-style:italic; color:var(--quote-text, #C9D1D9); margin:3px 0 0; line-height:1.55; }

        .rpe-cinema .hero-divider{ height:1px; background:var(--border); margin:18px 0 16px; }

        .rpe-cinema .hero-stats{ display:flex; gap:32px; }
        @media (max-width:520px){ .rpe-cinema .hero-stats{ gap:16px; flex-wrap:wrap; } }
        .rpe-cinema .hero-stat{ display:flex; flex-direction:column; gap:2px; }
        .rpe-cinema .hero-stat-label{ font-size:9.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); }
        .rpe-cinema .hero-stat-val{ font-size:20px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--text-hi); }
        .rpe-cinema .hero-stat-val.success{ color:var(--success); }
        .rpe-cinema .hero-stat-val.warning{ color:var(--warning); }
        .rpe-cinema .hero-stat-val.danger{  color:var(--danger); }
        .rpe-cinema .hero-stat-val .unit{ font-size:12px; font-weight:600; color:var(--text-med); margin-left:1px; }

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

        :root[data-theme="light"] .rpe-cinema{
          --bg:            #F5F3FD;
          --surface:       #FFFFFF;
          --surface-hi:    #EFEAFB;
          --border:        #D9CFF5;
          --accent:        #6B3FD6;
          --accent-glow:   rgba(107,63,214,0.12);
          --success:       #1E8E4A;
          --success-glow:  rgba(30,142,74,0.12);
          --warning:       #B4790E;
          --warning-glow:  rgba(180,121,14,0.14);
          --danger:        #D93B32;
          --danger-glow:   rgba(217,59,50,0.12);
          --text-hi:       #241E38;
          --text-med:      #5E5678;
          --text-low:      #8D84A8;
          --quote-text:    #3A3352;
        }
      `}</style>
    </div>
  )
}
