import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, RefreshCw, Home, PlayCircle, BarChart2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { submitSessionFeedback } from '@/lib/api/pedagogy'
import { cn } from '@/lib/utils'

const EMOTION_TONE = {
  calm:       'success',
  assertive:  'accent',
  anxious:    'warning',
  frustrated: 'danger',
  confused:   'neutral',
}

// Map RPE emotion labels → APM turn metric scores (0-1)
const EMOTION_SCORES = {
  assertive:  { assertiveness_score: 0.9, empathy_score: 0.5, clarity_score: 0.8, response_quality: 0.85 },
  calm:       { assertiveness_score: 0.6, empathy_score: 0.7, clarity_score: 0.7, response_quality: 0.70 },
  anxious:    { assertiveness_score: 0.2, empathy_score: 0.4, clarity_score: 0.4, response_quality: 0.30 },
  frustrated: { assertiveness_score: 0.3, empathy_score: 0.2, clarity_score: 0.4, response_quality: 0.30 },
  confused:   { assertiveness_score: 0.3, empathy_score: 0.4, clarity_score: 0.3, response_quality: 0.35 },
}
const DEFAULT_SCORES = { assertiveness_score: 0.5, empathy_score: 0.5, clarity_score: 0.5, response_quality: 0.5 }

async function _sendApmFeedback(data, sessionId, scenarioTitle) {
  try {
    const finalTrust = data.final_trust ?? 50
    const rating = finalTrust >= 70 ? 'good' : finalTrust >= 40 ? 'fair' : 'poor'
    const summary = finalTrust >= 70
      ? 'Strong trust maintained throughout the session.'
      : finalTrust >= 40
      ? 'Moderate trust — focus on clearer assertive communication.'
      : 'Low trust recorded — review de-escalation and emotional regulation strategies.'

    await submitSessionFeedback({
      session_id: sessionId,
      scenario_id: data.scenario_id,
      scenario_title: scenarioTitle || data.scenario_title || 'Role-play session',
      user_id: data.user_id,
      outcome: data.outcome,
      final_trust: finalTrust,
      final_escalation: data.final_escalation ?? 0,
      total_turns: data.turns?.length ?? 0,
      turn_metrics: (data.turns ?? []).map((t) => ({
        turn: t.turn,
        ...(EMOTION_SCORES[t.emotion] ?? DEFAULT_SCORES),
        flags: [],
      })),
      coaching_advice: { overall_rating: rating, summary, advice: [], strengths: [], focus_areas: [] },
    })
  } catch (err) {
    console.warn('APM feedback update failed (non-blocking):', err.message)
  }
}

const getTrustTone = (s) => (s >= 70 ? 'success' : s >= 40 ? 'warning' : 'danger')

const dominantEmotion = (history) => {
  const counts = {}
  for (const e of history) counts[e] = (counts[e] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm'
}

const OUTCOME_META = {
  trust_sustained: {
    variant: 'success',
    icon: '🎉',
    title: 'Session Complete — Success!',
    sub: 'You built enough trust to resolve the situation.',
  },
  npc_exit: {
    variant: 'danger',
    icon: '💢',
    title: 'The Conversation Broke Down',
    sub: 'The NPC ended the session due to high escalation. Review your feedback below.',
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
      ? 'You reached the turn limit — scored on final results.'
      : 'Check your feedback for improvement tips.'
  } else {
    meta = { variant: outcome === 'success' ? 'success' : 'natural' }
    icon = outcome === 'success' ? '✅' : '👋'
    title = outcome === 'success' ? 'Session Complete — Success!' : 'Session Complete — Keep Practicing'
    sub = scenarioTitle
  }
  return { ...meta, title, sub, icon }
}

function Pill({ tone, children }) {
  return <span className={cn('pill', tone)}>{children}</span>
}

function Panel({ title, children }) {
  return (
    <div className="panel">
      {title && <div className="panel-label">{title}</div>}
      {children}
    </div>
  )
}

export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, trustScore, escalationLevel, outcome,
    totalTurns, scenarioTitle, currentTurn, npcRole,
    endReason, recommendedTurns, maxTurns,
  } = location.state || {}

  const [sessionData, setSessionData]   = useState(null)
  const [isLoading, setIsLoading]       = useState(true)
  const [showAllTurns, setShowAllTurns] = useState(false)

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    rpeService.getSessionSummary(sessionId)
      .then((data) => {
        setSessionData(data)
        if (data?.outcome) {
          _sendApmFeedback(data, sessionId, scenarioTitle)
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [])

  const emotionHistory = sessionData?.emotion_history ?? []
  const trustHistory   = sessionData?.trust_history   ?? []
  const turns          = sessionData?.turns            ?? []
  const finalTrust     = sessionData?.final_trust      ?? trustScore ?? 0
  const finalEsc       = sessionData?.final_escalation ?? escalationLevel ?? 0
  const visibleTurns   = showAllTurns ? turns : turns.slice(0, 4)

  const trustDeltas = trustHistory.slice(1).map((v, i) => v - trustHistory[i])
  const dom         = dominantEmotion(emotionHistory.slice(1))
  const meta        = outcomeMeta(endReason, outcome, scenarioTitle)
  const closingLine = turns[turns.length - 1]?.npc_response

  const trustInsight =
    finalTrust > 60 ? { icon: '✅', text: 'You maintained strong trust throughout.', tone: 'success' }
    : finalTrust > 40 ? { icon: '⚠', text: 'Trust was moderate. Try more assertive responses.', tone: 'warning' }
    : { icon: '❌', text: 'Trust was low. Focus on staying calm and professional.', tone: 'danger' }

  const escInsight =
    finalEsc <= 1 ? { icon: '✅', text: 'You kept the conversation calm and controlled.', tone: 'success' }
    : finalEsc <= 3 ? { icon: '⚠', text: 'Some tension arose. Try de-escalating earlier.', tone: 'warning' }
    : { icon: '❌', text: 'High escalation. Avoid reactive or emotional responses.', tone: 'danger' }

  const emotionInsight =
    dom === 'assertive' || dom === 'calm'
      ? { icon: '✅', text: 'Your tone was professional and composed.', tone: 'success' }
      : dom === 'anxious' || dom === 'confused'
      ? { icon: '⚠', text: 'You seemed uncertain. Practice confident phrasing.', tone: 'warning' }
      : { icon: '❌', text: 'Frustration came through. Try staying solution-focused.', tone: 'danger' }

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

        {!isLoading && (
          <div className="grid-2">
            {trustHistory.length > 0 && (() => {
              const minVal = Math.min(...trustHistory)
              const maxVal = Math.max(...trustHistory)
              const range  = maxVal - minVal || 1
              return (
                <Panel title="Trust progression">
                  <div className="chart">
                    {trustHistory.map((val, i) => {
                      const heightPct = 20 + ((val - minVal) / range) * 80
                      return (
                        <div key={i} className="chart-col">
                          <span className={cn('chart-val', getTrustTone(val))}>{val}</span>
                          <div className="chart-bar-track">
                            <div className={cn('chart-bar', getTrustTone(val))} style={{ height: `${heightPct}%` }} />
                          </div>
                          <span className="chart-tick">{i === 0 ? 'S' : `T${i}`}</span>
                        </div>
                      )
                    })}
                  </div>
                </Panel>
              )
            })()}

            <Panel title="How did you do?">
              <ul className="insight-list">
                {[trustInsight, escInsight, emotionInsight].map((item, i) => (
                  <li key={i} className={cn('insight-row', item.tone)}>
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}

        {isLoading && (
          <Panel>
            <div className="skel" style={{ height: 16, width: '40%', marginBottom: 12 }} />
            <div className="skel" style={{ height: 12, width: '70%', marginBottom: 8 }} />
            <div className="skel" style={{ height: 12, width: '60%' }} />
          </Panel>
        )}

        {!isLoading && turns.length > 0 && (
          <Panel title="Turn by turn">
            <div className="turn-list">
              {visibleTurns.map((t, i) => {
                const delta = trustDeltas[t.turn - 1]
                return (
                  <div key={t.turn} className="turn-row">
                    <span className="turn-num">T{t.turn}</span>
                    <Pill tone={EMOTION_TONE[t.emotion] ?? 'neutral'}>{t.emotion}</Pill>
                    <span className={cn('turn-trust', getTrustTone(t.trust_score))}>
                      {t.trust_score}
                      {delta != null && delta !== 0 && (
                        <span className="turn-delta">
                          {delta > 0 ? <TrendingUp size={10} strokeWidth={2} /> : <TrendingDown size={10} strokeWidth={2} />}
                        </span>
                      )}
                      {delta === 0 && <Minus size={10} strokeWidth={2} className="turn-delta neutral" />}
                    </span>
                    <p className="turn-text">{t.user_input}</p>
                  </div>
                )
              })}
            </div>
            {turns.length > 4 && (
              <button type="button" onClick={() => setShowAllTurns((v) => !v)} className="show-toggle">
                {showAllTurns
                  ? <><ChevronUp size={12} strokeWidth={2} /> Hide</>
                  : <><ChevronDown size={12} strokeWidth={2} /> Show all {turns.length} turns</>}
              </button>
            )}
          </Panel>
        )}

        <div className="actions">
          <button type="button" onClick={() => navigate('/training-plan')} className="btn-c secondary">
            View updated plan
          </button>
          <button type="button" onClick={() => navigate(`/roleplay/feedback/${sessionId}`)} className="btn-c primary">
            <BarChart2 size={14} strokeWidth={1.8} />
            View full feedback
          </button>
          <button type="button" onClick={() => navigate('/roleplay')} className="btn-c secondary">
            <RefreshCw size={14} strokeWidth={1.8} />
            Try again
          </button>
          <button type="button" onClick={() => navigate('/roleplay')} className="btn-c ghost">
            <PlayCircle size={14} strokeWidth={1.8} />
            Try another
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
          background:
            radial-gradient(60% 50% at 50% 0%, rgba(124,58,237,0.10) 0%, transparent 60%),
            radial-gradient(50% 40% at 50% 0%, rgba(68,147,248,0.08) 0%, transparent 60%),
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
        .rpe-cinema .hero-card.natural{ border-color:rgba(68,147,248,0.35); box-shadow:0 20px 50px rgba(68,147,248,0.1); }

        .rpe-cinema .hero-top{ display:flex; align-items:center; gap:18px; }
        .rpe-cinema .hero-badge{ position:relative; width:56px; height:56px; border-radius:50%; flex-shrink:0; }
        .rpe-cinema .hero-badge::before{ content:""; position:absolute; inset:0; border-radius:50%; animation: cinemaRingPulse 2.4s var(--ease) infinite; }
        .rpe-cinema .hero-badge.success::before{ background:conic-gradient(from 0deg, var(--success), #6BDE85, var(--success)); }
        .rpe-cinema .hero-badge.warning::before{ background:conic-gradient(from 0deg, var(--warning), #F0C05A, var(--warning)); }
        .rpe-cinema .hero-badge.danger::before{  background:conic-gradient(from 0deg, var(--danger), #FF8A85, var(--danger)); }
        .rpe-cinema .hero-badge.natural::before{ background:conic-gradient(from 0deg, var(--primary), #7C3AED, var(--primary)); }
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
        .rpe-cinema .hero-quote-text{ font-size:13px; font-style:italic; color:#C9D1D9; margin:3px 0 0; line-height:1.55; }

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

        .rpe-cinema .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:stretch; }
        @media (max-width:760px){ .rpe-cinema .grid-2{ grid-template-columns:1fr; } }

        .rpe-cinema .panel{ background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:16px 18px; }
        .rpe-cinema .panel-label{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-low); margin-bottom:12px; }

        .rpe-cinema .chart{ position:relative; display:flex; align-items:flex-end; gap:6px; height:104px; }
        .rpe-cinema .chart-col{ display:flex; flex-direction:column; align-items:center; gap:4px; flex:1; }
        .rpe-cinema .chart-val{ font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; }
        .rpe-cinema .chart-val.success{ color:var(--success); }
        .rpe-cinema .chart-val.warning{ color:var(--warning); }
        .rpe-cinema .chart-val.danger{  color:var(--danger); }
        .rpe-cinema .chart-bar-track{ width:100%; height:72px; display:flex; flex-direction:column; justify-content:flex-end; }
        .rpe-cinema .chart-bar{ width:100%; border-radius:3px 3px 0 0; transition:height .5s var(--ease); box-shadow:0 0 10px currentColor; opacity:.9; }
        .rpe-cinema .chart-bar.success{ background:var(--success); color:var(--success-glow); }
        .rpe-cinema .chart-bar.warning{ background:var(--warning); color:var(--warning-glow); }
        .rpe-cinema .chart-bar.danger{  background:var(--danger);  color:var(--danger-glow); }
        .rpe-cinema .chart-tick{ font-size:9px; color:var(--text-low); font-variant-numeric:tabular-nums; }

        .rpe-cinema .pill{
          display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:650;
          padding:4px 10px; border-radius:100px; border:1px solid transparent; text-transform:capitalize;
        }
        .rpe-cinema .pill.success{ color:var(--success); background:var(--success-glow); border-color:rgba(63,185,80,0.3); }
        .rpe-cinema .pill.warning{ color:var(--warning); background:var(--warning-glow); border-color:rgba(210,153,34,0.3); }
        .rpe-cinema .pill.danger{  color:var(--danger);  background:var(--danger-glow);  border-color:rgba(248,81,73,0.3); }
        .rpe-cinema .pill.accent{  color:var(--accent);  background:var(--accent-glow);  border-color:rgba(124,58,237,0.3); }
        .rpe-cinema .pill.neutral{ color:var(--text-med); background:var(--surface-hi); border-color:var(--border); }

        .rpe-cinema .turn-list{ display:flex; flex-direction:column; gap:6px; }
        .rpe-cinema .turn-row{
          display:flex; align-items:center; gap:12px;
          background:var(--surface-hi); border:1px solid var(--border); border-radius:10px; padding:8px 12px;
        }
        .rpe-cinema .turn-num{ font-size:11px; font-weight:700; color:var(--text-low); width:22px; flex-shrink:0; font-variant-numeric:tabular-nums; }
        .rpe-cinema .turn-trust{ font-size:11px; font-weight:700; flex-shrink:0; font-variant-numeric:tabular-nums; display:inline-flex; align-items:center; gap:2px; width:38px; }
        .rpe-cinema .turn-trust.success{ color:var(--success); }
        .rpe-cinema .turn-trust.warning{ color:var(--warning); }
        .rpe-cinema .turn-trust.danger{  color:var(--danger); }
        .rpe-cinema .turn-delta{ display:inline-flex; }
        .rpe-cinema .turn-delta.neutral{ color:var(--text-low); }
        .rpe-cinema .turn-text{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0; font-size:12.5px; color:var(--text-med); }

        .rpe-cinema .show-toggle{
          margin-top:10px; background:transparent; border:0; color:var(--primary); cursor:pointer;
          font-weight:600; font-size:12px; display:inline-flex; align-items:center; gap:4px;
        }
        .rpe-cinema .show-toggle:hover{ filter:brightness(1.2); }

        .rpe-cinema .skel{ background:linear-gradient(90deg, var(--surface-hi) 25%, var(--border) 50%, var(--surface-hi) 75%); background-size:200% 100%; border-radius:6px; animation:cinemaShimmer 1.4s ease-in-out infinite; }
        @keyframes cinemaShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

        .rpe-cinema .insight-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
        .rpe-cinema .insight-row{ display:flex; align-items:flex-start; gap:8px; font-size:13px; font-weight:500; }
        .rpe-cinema .insight-row.success{ color:var(--success); }
        .rpe-cinema .insight-row.warning{ color:var(--warning); }
        .rpe-cinema .insight-row.danger{  color:var(--danger); }

        .rpe-cinema .actions{ display:flex; gap:10px; justify-content:center; flex-wrap:wrap; padding-top:4px; }
        .rpe-cinema .btn-c{
          display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650;
          padding:10px 16px; border-radius:10px; cursor:pointer; border:1px solid transparent;
          transition:filter .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease), transform .2s var(--ease);
        }
        .rpe-cinema .btn-c.primary{ background:linear-gradient(135deg, var(--primary), #6BB2FF); color:#fff; box-shadow:0 8px 22px var(--primary-glow); }
        .rpe-cinema .btn-c.primary:hover{ filter:brightness(1.08); transform:translateY(-1px); }
        .rpe-cinema .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
        .rpe-cinema .btn-c.secondary:hover{ border-color:var(--text-med); }
        .rpe-cinema .btn-c.ghost{ background:transparent; color:var(--text-med); }
        .rpe-cinema .btn-c.ghost:hover{ color:var(--text-hi); background:var(--surface-hi); }
      `}</style>
    </div>
  )
}
