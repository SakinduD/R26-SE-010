import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import {
  RefreshCw, BarChart2, ArrowRight, Sparkles,
  MessageSquare, Shield, AlertTriangle, CheckCircle2,
  Activity, Flame, Clock, Award, Flag, Check, XCircle
} from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'
import { FEEDBACK_THEME_VARS, scoreStatus } from '@/components/RPE/feedback/feedbackTheme'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'
import {
  outcomeBadge, outcomeExplanation, escalationStatus, turnsStatus,
} from '@/lib/rpe/sessionOutcome'
import { resolveEnvironmentId, getEnvironment } from '@/lib/rpe/sceneEnvironments'

function renderOutcomeIcon(endReason, outcome, tone) {
  if (tone === 'success' || endReason === 'trust_sustained' || outcome === 'success') {
    return <CheckCircle2 size={13} strokeWidth={2.5} className="text-emerald-400" />
  }
  if (tone === 'danger' || endReason === 'npc_exit' || outcome === 'failure') {
    return <AlertTriangle size={13} strokeWidth={2.5} className="text-rose-400" />
  }
  if (tone === 'warning' || endReason === 'max_turns_reached') {
    return <Clock size={13} strokeWidth={2.5} className="text-amber-400" />
  }
  return <Flag size={13} strokeWidth={2.5} className="text-slate-400" />
}

/*
 * SessionComplete — Modern Cybernetic / Glassmorphic Session Debriefing Screen.
 * Displays interactive circular trust gauge, performance breakdown cards,
 * closing transmission dialogue, and high-impact action buttons.
 */
export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, trustScore, escalationLevel, outcome,
    scenarioTitle, currentTurn, npcRole, npcName,
    endReason, recommendedTurns, maxTurns,
    category: stateCategory, conflictType: stateConflictType,
  } = location.state || {}

  const [sessionData, setSessionData] = useState(null)
  const scoreNumRef = useRef(null)
  const circleRef = useRef(null)

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    rpeService.getSessionSummary(sessionId)
      .then(setSessionData)
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const turns       = sessionData?.turns ?? []
  const badge       = outcomeBadge(endReason, outcome)
  const explanation = outcomeExplanation(endReason, outcome, scenarioTitle)
  const scoreStat   = scoreStatus(trustScore)
  const escStat     = escalationStatus(escalationLevel)
  const turnStat    = turnsStatus(currentTurn, recommendedTurns, maxTurns)
  const envCategory = sessionData?.category || stateCategory
  const envConflict = sessionData?.conflict_type || stateConflictType
  const envId       = resolveEnvironmentId(envCategory, envConflict)
  const env         = getEnvironment(envId)
  const bgImage     = env?.backgroundImage || '/rpe-background/rpe-env-manager-office.webp'

  // Circular gauge values
  const radius = 56
  const circumference = 2 * Math.PI * radius
  const clampedScore = Math.max(0, Math.min(100, trustScore ?? 0))
  const targetOffset = circumference - (clampedScore / 100) * circumference

  const heroRef = useGsapScope(({ instant }) => {
    if (instant) {
      gsap.set('.sc-hero-card', { opacity: 1, y: 0, scale: 1 })
      gsap.set('.sc-stat-card', { opacity: 1, y: 0 })
      if (scoreNumRef.current) scoreNumRef.current.textContent = String(trustScore ?? 0)
      if (circleRef.current) circleRef.current.style.strokeDashoffset = String(targetOffset)
      return
    }

    // Card entrance
    gsap.fromTo('.sc-hero-card',
      { opacity: 0, y: 24, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out' }
    )

    // Stats cards staggered entrance
    gsap.fromTo('.sc-stat-card',
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, delay: 0.25, ease: 'power2.out' }
    )

    // Number count-up
    const obj = { val: 0 }
    gsap.to(obj, {
      val: clampedScore,
      duration: 1.2,
      ease: 'power2.out',
      delay: 0.1,
      onUpdate: () => {
        if (scoreNumRef.current) {
          scoreNumRef.current.textContent = String(Math.round(obj.val))
        }
      },
    })

    // SVG Circular stroke animation
    if (circleRef.current) {
      gsap.fromTo(circleRef.current,
        { strokeDashoffset: circumference },
        { strokeDashoffset: targetOffset, duration: 1.2, ease: 'power2.out', delay: 0.1 }
      )
    }
  }, [trustScore, targetOffset, circumference, clampedScore])

  // Tone-specific gradient mapping
  const toneGradient = {
    success: 'from-emerald-400 to-teal-500',
    accent:  'from-violet-400 to-purple-600',
    warning: 'from-amber-400 to-orange-500',
    danger:  'from-rose-400 to-red-600',
    neutral: 'from-slate-400 to-zinc-500',
  }[scoreStat.tone] || 'from-violet-400 to-purple-600'

  const toneStroke = {
    success: '#10B981',
    accent:  '#8B5CF6',
    warning: '#F59E0B',
    danger:  '#EF4444',
    neutral: '#94A3B8',
  }[scoreStat.tone] || '#8B5CF6'

  return (
    <div className="rpe-cinema">
      {/* Background Environment Image */}
      <div className="sc-bg-photo-wrap">
        <img
          src={bgImage}
          alt=""
          className="sc-bg-photo"
          aria-hidden="true"
        />
      </div>

      {/* Darkening & vignette overlay */}
      <div className="sc-bg-overlay" />

      {/* Ambient subtle highlights */}
      <div className="sc-bg-ambient" />

      <div className="sc-page" ref={(el) => { heroRef.current = el }}>

        {/* Main Glassmorphic Card */}
        <div className={cn('sc-hero-card', badge.tone)}>

          {/* Top Header Row */}
          <div className="sc-topbar">
            <div className="sc-scenario-pill">
              <span className="sc-scenario-title">{scenarioTitle || 'Scenario Simulation'}</span>
            </div>

            <div className={cn('sc-outcome-badge', badge.tone)}>
              <span className="sc-outcome-icon">{renderOutcomeIcon(endReason, outcome, badge.tone)}</span>
              <span>{badge.label}</span>
            </div>
          </div>

          {/* Hero Performance Overview Section */}
          <div className="sc-hero-body">

            {/* Circular Cybernetic Trust Gauge */}
            <div className="sc-gauge-wrap">
              <svg className="sc-gauge-svg" width="136" height="136" viewBox="0 0 136 136">
                <defs>
                  <linearGradient id="scScoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={toneStroke} stopOpacity="1" />
                    <stop offset="100%" stopColor="#C084FC" stopOpacity="0.8" />
                  </linearGradient>
                  <filter id="scGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Track Circle */}
                <circle
                  className="sc-gauge-track"
                  cx="68" cy="68" r={radius}
                  strokeWidth="8"
                />

                {/* Animated Value Arc */}
                <circle
                  ref={circleRef}
                  className="sc-gauge-arc"
                  cx="68" cy="68" r={radius}
                  strokeWidth="8"
                  stroke="url(#scScoreGrad)"
                  strokeDasharray={circumference}
                  strokeDashoffset={targetOffset}
                  filter="url(#scGlow)"
                  transform="rotate(-90 68 68)"
                />
              </svg>

              {/* Centered Gauge Value */}
              <div className="sc-gauge-center">
                <span className="sc-gauge-num" ref={scoreNumRef}>
                  {trustScore ?? '—'}
                </span>
                <span className="sc-gauge-unit">/ 100</span>
                <span className={cn('sc-gauge-tag', scoreStat.tone)}>
                  {scoreStat.label}
                </span>
              </div>
            </div>

            {/* Hero Debrief Callout */}
            <div className="sc-hero-content">
              <div className="sc-hero-headline-row">
                <span className="sc-headline-icon">
                  {badge.tone === 'success' ? <CheckCircle2 size={20} className="text-emerald-400" /> : <Sparkles size={20} className="text-purple-400" />}
                </span>
                <h1 className="sc-hero-headline">Simulation Debrief</h1>
              </div>

              <div className="sc-explanation-box">
                <p className="sc-explanation-text">{explanation}</p>
              </div>

              <div className="sc-metric-pills-row">
                <div className="sc-pill-item">
                  <span className="sc-pill-label">Metric Target:</span>
                  <span className="sc-pill-val">70+ Trust</span>
                </div>
                <div className="sc-pill-divider" />
                <div className="sc-pill-item">
                  <span className="sc-pill-label">Safety:</span>
                  <span className={cn('sc-pill-val', escStat?.tone)}>{escStat?.label || 'Normal'}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Interactive Metric Cards Grid */}
          <div className="sc-metrics-grid">

            {/* Card 1: Final Trust */}
            <div className="sc-stat-card">
              <div className="sc-card-top">
                <span className="sc-card-label">Final Trust</span>
                <Shield size={14} className="sc-card-icon text-purple-400" />
              </div>
              <div className="sc-card-val-row">
                <span className="sc-card-number">{trustScore ?? '—'}</span>
                <span className="sc-card-sub">/ 100</span>
              </div>
              {/* Mini visual trajectory bar */}
              <div className="sc-progress-track">
                <div
                  className={cn('sc-progress-fill', scoreStat.tone)}
                  style={{ width: `${clampedScore}%` }}
                />
              </div>
              <span className={cn('sc-card-status', scoreStat.tone)}>{scoreStat.label}</span>
            </div>

            {/* Card 2: Escalation Level */}
            <div className="sc-stat-card">
              <div className="sc-card-top">
                <span className="sc-card-label">Escalation</span>
                <Flame size={14} className={cn('sc-card-icon', (escalationLevel || 0) > 2 ? 'text-rose-400' : 'text-sky-400')} />
              </div>
              <div className="sc-card-val-row">
                <span className="sc-card-number">{escalationLevel ?? '0'}</span>
                <span className="sc-card-sub">/ 5</span>
              </div>
              {/* 5-segment escalation bar */}
              <div className="sc-segments-row">
                {[1, 2, 3, 4, 5].map((lvl) => {
                  const isActive = (escalationLevel || 0) >= lvl
                  const segmentColor = lvl <= 2 ? 'bg-sky-400' : lvl === 3 ? 'bg-amber-400' : 'bg-rose-500'
                  return (
                    <div
                      key={lvl}
                      className={cn(
                        'sc-segment',
                        isActive ? segmentColor : 'bg-white/10'
                      )}
                    />
                  )
                })}
              </div>
              <span className={cn('sc-card-status', escStat?.tone || 'neutral')}>{escStat?.label || 'Calm'}</span>
            </div>

            {/* Card 3: Conversation Turns */}
            <div className="sc-stat-card">
              <div className="sc-card-top">
                <span className="sc-card-label">Conversation Turns</span>
                <Clock size={14} className="sc-card-icon text-indigo-400" />
              </div>
              <div className="sc-card-val-row">
                <span className="sc-card-number">{currentTurn ?? turns.length ?? '—'}</span>
                <span className="sc-card-sub">{recommendedTurns ? `/ ${recommendedTurns}` : 'turns'}</span>
              </div>
              {/* Mini turns pacing dots */}
              <div className="sc-progress-track">
                <div
                  className="sc-progress-fill bg-indigo-500"
                  style={{
                    width: `${Math.min(100, ((currentTurn || turns.length || 1) / (recommendedTurns || 8)) * 100)}%`
                  }}
                />
              </div>
              <span className={cn('sc-card-status', turnStat?.tone || 'neutral')}>{turnStat?.label || 'Completed'}</span>
            </div>

          </div>

          {/* Action Buttons: "Back to home" removed per request */}
          <div className="sc-actions-dock">
            <button
              type="button"
              onClick={() => navigate(`/roleplay/feedback/${sessionId}`)}
              className="sc-btn-primary"
            >
              <BarChart2 size={16} strokeWidth={2.2} />
              <span>View Session Outcome</span>
              <ArrowRight size={15} strokeWidth={2.2} className="sc-arrow-icon" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/roleplay')}
              className="sc-btn-secondary"
            >
              <RefreshCw size={15} strokeWidth={2} />
              <span>Try Again</span>
            </button>
          </div>

        </div>

      </div>

      <style>{FEEDBACK_THEME_VARS}{MODERN_SESSION_COMPLETE_STYLES}</style>
    </div>
  )
}

const MODERN_SESSION_COMPLETE_STYLES = `
  .rpe-cinema {
    position: relative;
    min-height: calc(100vh - 48px);
    background: var(--bg);
    color: var(--text-hi);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px 60px;
    overflow: hidden;
  }

  /* Background Environment Photo */
  .sc-bg-photo-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    z-index: 0;
    pointer-events: none;
  }
  .sc-bg-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 36%;
    filter: blur(2.5px) brightness(0.68) saturate(0.92) contrast(1.02);
    transform: scale(1.03);
    opacity: 0.88;
  }
  :root[data-theme="light"] .sc-bg-photo {
    filter: blur(3px) brightness(1.05) saturate(0.85);
    opacity: 0.22;
  }

  /* Deep cinematic darkening & vignette overlay */
  .sc-bg-overlay {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 42%, rgba(8, 10, 16, 0.45) 0%, rgba(4, 5, 10, 0.82) 100%);
    z-index: 1;
    pointer-events: none;
  }
  :root[data-theme="light"] .sc-bg-overlay {
    background: radial-gradient(circle at 50% 30%, rgba(248, 250, 252, 0.82) 0%, rgba(241, 245, 249, 0.95) 100%);
  }

  /* Ambient Subtle Lighting */
  .sc-bg-ambient {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 50% 15%, rgba(255, 255, 255, 0.04) 0%, transparent 60%),
      radial-gradient(circle at 85% 80%, rgba(20, 26, 40, 0.20) 0%, transparent 50%);
    z-index: 2;
  }
  :root[data-theme="light"] .sc-bg-ambient {
    background:
      radial-gradient(circle at 50% 10%, rgba(124, 58, 237, 0.04) 0%, transparent 60%),
      radial-gradient(circle at 85% 85%, rgba(124, 58, 237, 0.03) 0%, transparent 50%);
  }

  .sc-page {
    position: relative;
    z-index: 10;
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
  }

  /* Main Glass Terminal */
  .sc-hero-card {
    position: relative;
    background: var(--surface);
    backdrop-filter: blur(28px);
    -webkit-backdrop-filter: blur(28px);
    border: 1px solid var(--border);
    border-radius: 26px;
    padding: 34px 34px 30px;
    box-shadow: var(--card-shadow, 0 32px 80px -16px rgba(0, 0, 0, 0.85));
    display: flex;
    flex-direction: column;
    gap: 24px;
    transition: border-color .3s ease;
  }
  :root[data-theme="light"] .sc-hero-card {
    background: #FFFFFF;
    border-color: #E2E8F0;
    box-shadow: 0 20px 45px -15px rgba(0, 0, 0, 0.08);
  }
  :root[data-theme="light"] .sc-scenario-pill {
    background: #F1F5F9;
    border-color: #E2E8F0;
  }
  :root[data-theme="light"] .sc-scenario-title {
    color: #334155;
  }
  :root[data-theme="light"] .sc-gauge-track {
    stroke: #E2E8F0;
  }
  :root[data-theme="light"] .sc-gauge-num {
    color: #0F172A;
  }
  :root[data-theme="light"] .sc-gauge-unit {
    color: #64748B;
  }
  :root[data-theme="light"] .sc-hero-headline {
    color: #0F172A;
  }
  :root[data-theme="light"] .sc-explanation-box {
    background: #F8FAFC;
    border-color: #E2E8F0;
    border-left: 3px solid #7C3AED;
  }
  :root[data-theme="light"] .sc-explanation-text {
    color: #334155;
  }
  :root[data-theme="light"] .sc-pill-label {
    color: #64748B;
  }
  :root[data-theme="light"] .sc-pill-val {
    color: #0F172A;
  }
  :root[data-theme="light"] .sc-pill-divider {
    background: #E2E8F0;
  }
  :root[data-theme="light"] .sc-stat-card {
    background: #F8FAFC;
    border-color: #E2E8F0;
  }
  :root[data-theme="light"] .sc-card-number {
    color: #0F172A;
  }
  :root[data-theme="light"] .sc-card-label {
    color: #64748B;
  }
  :root[data-theme="light"] .sc-card-sub {
    color: #64748B;
  }
  :root[data-theme="light"] .sc-progress-track {
    background: #E2E8F0;
  }
  :root[data-theme="light"] .sc-final-quote {
    background: #F8FAFC;
    border-color: #E2E8F0;
  }
  :root[data-theme="light"] .sc-quote-body {
    color: #1E293B;
  }
  .sc-hero-card.success {
    box-shadow:
      0 32px 80px -16px rgba(0, 0, 0, 0.85),
      0 0 50px -12px rgba(16, 185, 129, 0.18);
    border-top-color: rgba(52, 211, 153, 0.35);
  }
  .sc-hero-card.warning {
    box-shadow:
      0 32px 80px -16px rgba(0, 0, 0, 0.85),
      0 0 50px -12px rgba(245, 158, 11, 0.18);
    border-top-color: rgba(251, 191, 36, 0.35);
  }
  .sc-hero-card.danger {
    box-shadow:
      0 32px 80px -16px rgba(0, 0, 0, 0.85),
      0 0 50px -12px rgba(239, 68, 68, 0.18);
    border-top-color: rgba(248, 113, 113, 0.35);
  }

  /* Top Bar */
  .sc-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 6px;
  }
  .sc-scenario-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 100px;
    padding: 6px 14px;
  }
  .sc-scenario-title {
    font-size: 12.5px;
    font-weight: 650;
    letter-spacing: .02em;
    color: #E2E8F0;
    text-transform: capitalize;
  }

  .sc-outcome-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: .03em;
    padding: 5px 14px;
    border-radius: 100px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .sc-outcome-badge.success {
    color: #34D399;
    background: rgba(16, 185, 129, 0.12);
    border-color: rgba(16, 185, 129, 0.3);
    box-shadow: 0 0 16px rgba(16, 185, 129, 0.15);
  }
  .sc-outcome-badge.accent {
    color: #C084FC;
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.3);
    box-shadow: 0 0 16px rgba(168, 85, 247, 0.15);
  }
  .sc-outcome-badge.warning {
    color: #FBBF24;
    background: rgba(245, 158, 11, 0.12);
    border-color: rgba(245, 158, 11, 0.3);
  }
  .sc-outcome-badge.danger {
    color: #F87171;
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.3);
  }
  .sc-outcome-badge.neutral {
    color: #94A3B8;
    background: rgba(148, 163, 184, 0.08);
  }
  .sc-outcome-icon { font-size: 13px; line-height: 1; }

  /* Hero Body */
  .sc-hero-body {
    display: flex;
    align-items: center;
    gap: 28px;
    padding: 8px 0;
  }
  @media (max-width: 580px) {
    .sc-hero-body { flex-direction: column; align-items: center; text-align: center; }
  }

  /* Gauge */
  .sc-gauge-wrap {
    position: relative;
    width: 136px;
    height: 136px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sc-gauge-svg {
    transform: rotate(0deg);
  }
  .sc-gauge-track {
    fill: none;
    stroke: rgba(255, 255, 255, 0.07);
  }
  .sc-gauge-arc {
    fill: none;
    stroke-linecap: round;
    transition: stroke-dashoffset .5s ease;
  }
  .sc-gauge-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .sc-gauge-num {
    font-size: 38px;
    font-weight: 850;
    line-height: 1;
    letter-spacing: -0.03em;
    color: #FFFFFF;
    font-variant-numeric: tabular-nums;
  }
  .sc-gauge-unit {
    font-size: 11px;
    font-weight: 650;
    color: #94A3B8;
    margin-top: 2px;
  }
  .sc-gauge-tag {
    font-size: 9.5px;
    font-weight: 750;
    letter-spacing: .06em;
    text-transform: uppercase;
    margin-top: 4px;
    padding: 2px 7px;
    border-radius: 100px;
  }
  .sc-gauge-tag.success { color: #34D399; background: rgba(16, 185, 129, 0.15); }
  .sc-gauge-tag.accent  { color: #C084FC; background: rgba(168, 85, 247, 0.15); }
  .sc-gauge-tag.warning { color: #FBBF24; background: rgba(245, 158, 11, 0.15); }
  .sc-gauge-tag.danger  { color: #F87171; background: rgba(239, 68, 68, 0.15); }
  .sc-gauge-tag.neutral { color: #94A3B8; background: rgba(148, 163, 184, 0.15); }

  /* Hero Content */
  .sc-hero-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sc-hero-headline-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sc-hero-headline {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #FFFFFF;
    margin: 0;
  }
  .sc-explanation-box {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid #8B5CF6;
    border-radius: 0 12px 12px 0;
    padding: 12px 16px;
  }
  .sc-explanation-text {
    font-size: 13.5px;
    line-height: 1.55;
    color: #CBD5E1;
    margin: 0;
  }

  .sc-metric-pills-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
  }
  .sc-pill-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .sc-pill-label { color: #64748B; font-weight: 500; }
  .sc-pill-val { color: #E2E8F0; font-weight: 650; }
  .sc-pill-val.success { color: #34D399; }
  .sc-pill-val.accent  { color: #C084FC; }
  .sc-pill-val.warning { color: #FBBF24; }
  .sc-pill-val.danger  { color: #F87171; }
  .sc-pill-divider { width: 1px; height: 12px; background: rgba(255, 255, 255, 0.1); }

  /* Metric Cards Grid */
  .sc-metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  @media (max-width: 540px) {
    .sc-metrics-grid { grid-template-columns: 1fr; }
  }

  .sc-stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: transform .2s ease, border-color .2s ease, background .2s ease;
  }
  .sc-stat-card:hover {
    transform: translateY(-2px);
    background: rgba(255, 255, 255, 0.045);
    border-color: rgba(255, 255, 255, 0.12);
  }
  .sc-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sc-card-label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: #64748B;
  }
  .sc-card-val-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .sc-card-number {
    font-size: 26px;
    font-weight: 850;
    line-height: 1;
    color: #FFFFFF;
    font-variant-numeric: tabular-nums;
  }
  .sc-card-sub {
    font-size: 11.5px;
    font-weight: 600;
    color: #94A3B8;
  }

  /* Progress Mini-Bars */
  .sc-progress-track {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 100px;
    overflow: hidden;
    margin-top: 2px;
  }
  .sc-progress-fill {
    height: 100%;
    border-radius: 100px;
    transition: width 1s ease;
  }
  .sc-progress-fill.success { background: #10B981; }
  .sc-progress-fill.accent  { background: #8B5CF6; }
  .sc-progress-fill.warning { background: #F59E0B; }
  .sc-progress-fill.danger  { background: #EF4444; }
  .sc-progress-fill.neutral { background: #94A3B8; }

  /* Segmented Escalation Bar */
  .sc-segments-row {
    display: flex;
    gap: 4px;
    width: 100%;
    margin-top: 2px;
  }
  .sc-segment {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    transition: background-color .3s ease;
  }

  .sc-card-status {
    font-size: 11px;
    font-weight: 650;
    margin-top: 2px;
  }
  .sc-card-status.success { color: #34D399; }
  .sc-card-status.accent  { color: #C084FC; }
  .sc-card-status.warning { color: #FBBF24; }
  .sc-card-status.danger  { color: #F87171; }
  .sc-card-status.neutral { color: #94A3B8; }

  /* Actions Dock */
  .sc-actions-dock {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 6px;
  }
  @media (max-width: 480px) {
    .sc-actions-dock { flex-direction: column; }
  }

  .sc-btn-primary {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    background: linear-gradient(135deg, #7C3AED 0%, #9333EA 50%, #A855F7 100%);
    color: #FFFFFF;
    border: none;
    border-radius: 14px;
    padding: 14px 24px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: .01em;
    cursor: pointer;
    box-shadow: 0 10px 28px -4px rgba(124, 58, 237, 0.45);
    transition: transform .18s ease, filter .18s ease, box-shadow .18s ease;
  }
  .sc-btn-primary:hover {
    transform: translateY(-2px);
    filter: brightness(1.08);
    box-shadow: 0 14px 36px -4px rgba(124, 58, 237, 0.6);
  }
  .sc-btn-primary:active {
    transform: translateY(0);
  }
  .sc-arrow-icon {
    transition: transform .2s ease;
  }
  .sc-btn-primary:hover .sc-arrow-icon {
    transform: translateX(3px);
  }

  .sc-btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #E2E8F0;
    border-radius: 14px;
    padding: 14px 22px;
    font-size: 13.5px;
    font-weight: 650;
    cursor: pointer;
    backdrop-filter: blur(8px);
    transition: transform .18s ease, background .18s ease, border-color .18s ease;
  }
  .sc-btn-secondary:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.22);
    color: #FFFFFF;
  }
  .sc-btn-secondary:active {
    transform: translateY(0);
  }
`
