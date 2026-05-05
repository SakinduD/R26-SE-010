import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, RefreshCw, Home, PlayCircle, BarChart2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'

const EMOTION_STYLES = {
  calm:       'bg-emerald-100 text-emerald-700',
  assertive:  'bg-violet-100 text-violet-700',
  anxious:    'bg-amber-100 text-amber-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-slate-100 text-slate-600',
}

const getTrustGradient  = (s) => s >= 70 ? 'from-emerald-500 to-teal-400' : s >= 40 ? 'from-amber-400 to-yellow-300' : 'from-red-500 to-rose-400'
const getTrustTextColor = (s) => s >= 70 ? 'text-emerald-600' : s >= 40 ? 'text-amber-500' : 'text-red-500'

const computeNpcTone = (trust) =>
  trust >= 70 ? 'cooperative' : trust >= 40 ? 'neutral' : 'hostile'

const NPC_TONE_CHIP = {
  cooperative: 'bg-emerald-100 text-emerald-700',
  neutral:     'bg-amber-100 text-amber-700',
  hostile:     'bg-red-100 text-red-700',
}

const dominantEmotion = (history) => {
  const counts = {}
  for (const e of history) counts[e] = (counts[e] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm'
}

/* ── outcome banner config ────────────────────────────────── */
const OUTCOME_BANNERS = {
  trust_sustained: {
    bg: 'bg-gradient-to-r from-emerald-500 to-teal-500',
    icon: '🎉',
    title: 'Session Complete — Success!',
    sub: 'You built enough trust to resolve the situation.',
  },
  npc_exit: {
    bg: 'bg-gradient-to-r from-red-500 to-rose-500',
    icon: '💢',
    title: 'The Conversation Broke Down',
    sub: 'The NPC ended the session due to high escalation. Review your feedback below.',
  },
}

export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, trustScore, escalationLevel, outcome,
    totalTurns, scenarioTitle, currentTurn,
    endReason, recommendedTurns, maxTurns,
  } = location.state || {}

  const [sessionData, setSessionData]   = useState(null)
  const [isLoading, setIsLoading]       = useState(true)
  const [showAllTurns, setShowAllTurns] = useState(false)

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    rpeService.getSessionSummary(sessionId)
      .then(setSessionData)
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [])

  const emotionHistory = sessionData?.emotion_history ?? []
  const trustHistory   = sessionData?.trust_history   ?? []
  const turns          = sessionData?.turns            ?? []
  const finalTrust     = sessionData?.final_trust      ?? trustScore ?? 0
  const finalEsc       = sessionData?.final_escalation ?? escalationLevel ?? 0
  const visibleTurns   = showAllTurns ? turns : turns.slice(0, 3)

  const trustDeltas = trustHistory.slice(1).map((v, i) => v - trustHistory[i])
  const toneHistory = trustHistory.map(computeNpcTone)
  const dom         = dominantEmotion(emotionHistory.slice(1))

  const trustInsight =
    finalTrust > 60 ? { icon: '✅', text: 'You maintained strong trust throughout.', cls: 'text-emerald-700' }
    : finalTrust > 40 ? { icon: '⚠', text: 'Trust was moderate. Try more assertive responses.', cls: 'text-amber-700' }
    : { icon: '❌', text: 'Trust was low. Focus on staying calm and professional.', cls: 'text-red-700' }

  const escInsight =
    finalEsc <= 1 ? { icon: '✅', text: 'You kept the conversation calm and controlled.', cls: 'text-emerald-700' }
    : finalEsc <= 3 ? { icon: '⚠', text: 'Some tension arose. Try de-escalating earlier.', cls: 'text-amber-700' }
    : { icon: '❌', text: 'High escalation. Avoid reactive or emotional responses.', cls: 'text-red-700' }

  const emotionInsight =
    dom === 'assertive' || dom === 'calm'
      ? { icon: '✅', text: 'Your tone was professional and composed.', cls: 'text-emerald-700' }
      : dom === 'anxious' || dom === 'confused'
      ? { icon: '⚠', text: 'You seemed uncertain. Practice confident phrasing.', cls: 'text-amber-700' }
      : { icon: '❌', text: 'Frustration came through. Try staying solution-focused.', cls: 'text-red-700' }

  /* ── outcome banner ────────────────────────────────────── */
  const renderOutcomeBanner = () => {
    const banner = endReason === 'trust_sustained' ? OUTCOME_BANNERS.trust_sustained
      : endReason === 'npc_exit' ? OUTCOME_BANNERS.npc_exit
      : null

    if (banner) {
      return (
        <div className={cn('rounded-2xl px-6 py-6 text-white text-center shadow-lg', banner.bg)}>
          <p className="text-4xl mb-2">{banner.icon}</p>
          <p className="text-xl font-bold">{banner.title}</p>
          <p className="text-sm text-white/80 mt-1">{banner.sub}</p>
        </div>
      )
    }
    if (endReason === 'max_turns_reached') {
      return outcome === 'success' ? (
        <div className="rounded-2xl bg-gradient-to-r from-primary to-violet-600 px-6 py-6 text-white text-center shadow-lg shadow-primary/25">
          <p className="text-4xl mb-2">✅</p>
          <p className="text-xl font-bold">Session Complete</p>
          <p className="text-sm text-white/80 mt-1">You reached the turn limit — scored on final results.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-6 text-white text-center shadow-lg">
          <p className="text-4xl mb-2">⏱</p>
          <p className="text-xl font-bold">Maximum Turns Reached</p>
          <p className="text-sm text-white/80 mt-1">Check your feedback for improvement tips.</p>
        </div>
      )
    }
    return (
      <div className={cn(
        'rounded-2xl px-6 py-6 text-white text-center shadow-lg',
        outcome === 'success'
          ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
          : 'bg-gradient-to-r from-red-500 to-rose-500'
      )}>
        <p className="text-xl font-bold">
          {outcome === 'success' ? 'Session Complete — Success!' : 'Session Complete — Keep Practicing'}
        </p>
        <p className="text-sm text-white/70 mt-1">{scenarioTitle}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Outcome banner */}
        {renderOutcomeBanner()}

        {/* Score cards */}
        <div className="grid grid-cols-3 gap-3">
          {/* Final Trust */}
          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Final Trust</p>
            <p className={cn('text-4xl font-bold tabular-nums', getTrustTextColor(trustScore ?? 0))}>
              {trustScore ?? '—'}
            </p>
          </div>
          {/* Escalation */}
          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Escalation</p>
            <p className="text-4xl font-bold text-foreground tabular-nums">
              {escalationLevel ?? '—'}
              <span className="text-xl text-muted-foreground font-normal">/5</span>
            </p>
          </div>
          {/* Turns */}
          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Turns</p>
            <p className="text-4xl font-bold text-foreground tabular-nums">
              {currentTurn ?? '—'}
              {endReason !== 'npc_exit' && endReason !== 'trust_sustained' && recommendedTurns && (
                <span className="text-xl text-muted-foreground font-normal">/{recommendedTurns}</span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {endReason === 'npc_exit' ? 'turns (NPC exited)'
                : endReason === 'trust_sustained' ? 'turns (resolved)'
                : `of ${recommendedTurns ?? totalTurns ?? '?'} recommended`}
            </p>
          </div>
        </div>

        {/* Session length context */}
        {(recommendedTurns || maxTurns) && (
          <p className="text-xs text-muted-foreground text-center -mt-1">
            Session lasted{' '}
            <span className={cn(
              'font-semibold',
              (currentTurn ?? 0) <= (recommendedTurns ?? 6) ? 'text-emerald-600'
              : (currentTurn ?? 0) <= (maxTurns ?? 999) ? 'text-amber-500'
              : 'text-red-500'
            )}>
              {currentTurn} turns
            </span>
            {recommendedTurns && ` (recommended: ${recommendedTurns}`}
            {maxTurns && ` / max: ${maxTurns}`}
            {(recommendedTurns || maxTurns) && ')'}
          </p>
        )}

        {/* Trust progression chart */}
        {!isLoading && trustHistory.length > 0 && (() => {
          const minVal = Math.min(...trustHistory)
          const maxVal = Math.max(...trustHistory)
          const range  = maxVal - minVal || 1
          return (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wide">Trust Progression</h2>
              <div className="relative flex items-end gap-2" style={{ height: '128px' }}>
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-border pointer-events-none"
                  style={{ bottom: `${(50 / 100) * 96}px` }}
                />
                {trustHistory.map((val, i) => {
                  const heightPct = 20 + ((val - minVal) / range) * 80
                  return (
                    <div key={i} className="flex flex-col items-center gap-1 flex-1">
                      <span className={cn('text-[10px] font-bold tabular-nums', getTrustTextColor(val))}>
                        {val}
                      </span>
                      <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                        <div
                          className={cn('w-full rounded-t-sm transition-all duration-500 bg-gradient-to-t', getTrustGradient(val))}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground tabular-nums">
                        {i === 0 ? 'S' : `T${i}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Trust delta per turn */}
        {!isLoading && trustDeltas.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">Trust Change Per Turn</h2>
            <div className="flex flex-wrap gap-2">
              {trustDeltas.map((d, i) => (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-bold flex items-center gap-1',
                    d > 0 ? 'bg-emerald-100 text-emerald-700'
                    : d < 0 ? 'bg-red-100 text-red-700'
                    : 'bg-muted text-muted-foreground'
                  )}
                >
                  {d > 0 ? <TrendingUp size={10} /> : d < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
                  T{i + 1}: {d > 0 ? `+${d}` : d === 0 ? '±0' : d}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* NPC tone journey */}
        {!isLoading && toneHistory.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">NPC Attitude Over Time</h2>
            <div className="flex flex-wrap gap-2">
              {toneHistory.map((tone, i) => (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
                    NPC_TONE_CHIP[tone] ?? 'bg-muted text-muted-foreground'
                  )}
                >
                  {i === 0 ? 'Start' : `T${i}`}: {tone}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Emotion journey */}
        {!isLoading && emotionHistory.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">Emotion History</h2>
            <div className="flex flex-wrap gap-2">
              {emotionHistory.map((em, i) => (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    EMOTION_STYLES[em] ?? EMOTION_STYLES.confused
                  )}
                >
                  {i === 0 ? 'start' : `T${i}`}: {em}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Turn review */}
        {!isLoading && turns.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">Turn by Turn</h2>
            <div className="space-y-2">
              {visibleTurns.map((t) => (
                <div
                  key={t.turn}
                  className="flex items-center gap-3 rounded-lg bg-muted/50 border border-border/60 px-3 py-2.5 text-sm"
                >
                  <span className="text-xs font-mono font-bold text-muted-foreground w-5 shrink-0">T{t.turn}</span>
                  <span className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                    EMOTION_STYLES[t.emotion] ?? EMOTION_STYLES.confused
                  )}>
                    {t.emotion}
                  </span>
                  <span className={cn('shrink-0 text-xs font-bold tabular-nums', getTrustTextColor(t.trust_score))}>
                    {t.trust_score}
                  </span>
                  <p className="text-xs text-muted-foreground truncate">{t.user_input}</p>
                </div>
              ))}
            </div>
            {turns.length > 3 && (
              <button
                onClick={() => setShowAllTurns((v) => !v)}
                className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline font-semibold"
              >
                {showAllTurns
                  ? <><ChevronUp size={12} /> Hide</>
                  : <><ChevronDown size={12} /> Show all {turns.length} turns</>}
              </button>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground animate-pulse">
            Loading session data…
          </div>
        )}

        {/* Performance summary */}
        {!isLoading && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">How Did You Do?</h2>
            <ul className="space-y-2.5">
              {[trustInsight, escInsight, emotionInsight].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span>{item.icon}</span>
                  <span className={cn('font-medium', item.cls)}>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-center flex-wrap pb-8">
          <button
            onClick={() => navigate(`/roleplay/feedback/${sessionId}`)}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-md shadow-primary/25"
          >
            <BarChart2 size={14} /> View Full Feedback
          </button>
          <button
            onClick={() => navigate('/roleplay')}
            className="flex items-center gap-2 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-secondary-foreground hover:bg-secondary/90 transition-colors shadow-sm"
          >
            <RefreshCw size={14} /> Try Again
          </button>
          <button
            onClick={() => navigate('/roleplay')}
            className="flex items-center gap-2 rounded-xl bg-muted px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/80 transition-colors"
          >
            <PlayCircle size={14} /> Try Another
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 rounded-xl bg-muted px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/80 transition-colors"
          >
            <Home size={14} /> Back to Home
          </button>
        </div>

      </div>
    </div>
  )
}
