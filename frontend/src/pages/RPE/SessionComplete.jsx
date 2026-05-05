import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, RefreshCw, Home, PlayCircle, BarChart2 } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { submitSessionFeedback } from '@/lib/api/pedagogy'
import { cn } from '@/lib/utils'

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

const EMOTION_COLORS = {
  calm:       'bg-green-100 text-green-700',
  assertive:  'bg-blue-100 text-blue-700',
  anxious:    'bg-yellow-100 text-yellow-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-gray-100 text-gray-700',
}

const getTrustBarColor  = (s) => s >= 70 ? 'bg-green-500'  : s >= 40 ? 'bg-yellow-400'  : 'bg-red-500'
const getTrustTextColor = (s) => s >= 70 ? 'text-green-600': s >= 40 ? 'text-yellow-500' : 'text-red-500'

const computeNpcTone = (trust) =>
  trust >= 70 ? 'cooperative' : trust >= 40 ? 'neutral' : 'hostile'

const NPC_TONE_CHIP = {
  cooperative: 'bg-green-100 text-green-700',
  neutral:     'bg-yellow-100 text-yellow-700',
  hostile:     'bg-red-100 text-red-700',
}

const dominantEmotion = (history) => {
  const counts = {}
  for (const e of history) counts[e] = (counts[e] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm'
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
  const visibleTurns   = showAllTurns ? turns : turns.slice(0, 3)

  const trustDeltas = trustHistory.slice(1).map((v, i) => v - trustHistory[i])
  const toneHistory = trustHistory.map(computeNpcTone)

  const dom = dominantEmotion(emotionHistory.slice(1))
  const trustInsight =
    finalTrust > 60
      ? '✅ You maintained strong trust throughout.'
      : finalTrust > 40
      ? '⚠ Trust was moderate. Try more assertive responses.'
      : '❌ Trust was low. Focus on staying calm and professional.'
  const escInsight =
    finalEsc <= 1
      ? '✅ You kept the conversation calm and controlled.'
      : finalEsc <= 3
      ? '⚠ Some tension arose. Try de-escalating earlier.'
      : '❌ High escalation. Avoid reactive or emotional responses.'
  const emotionInsight =
    dom === 'assertive' || dom === 'calm'
      ? '✅ Your tone was professional and composed.'
      : dom === 'anxious' || dom === 'confused'
      ? '⚠ You seemed uncertain. Practice confident phrasing.'
      : '❌ Frustration came through. Try staying solution-focused.'

  /* ── end-reason-aware outcome banner ─────────────────────────────── */
  const renderOutcomeBanner = () => {
    if (endReason === 'trust_sustained') {
      return (
        <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-center">
          <p className="text-2xl mb-1">🎉</p>
          <p className="text-xl font-bold text-green-700">Session Complete — Success!</p>
          <p className="text-sm text-green-600 mt-1">You built enough trust to resolve the situation.</p>
        </div>
      )
    }
    if (endReason === 'npc_exit') {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-center">
          <p className="text-2xl mb-1">💢</p>
          <p className="text-xl font-bold text-red-700">The Conversation Broke Down</p>
          <p className="text-sm text-red-600 mt-1">The NPC ended the session due to high escalation.</p>
          <p className="text-xs text-red-400 mt-1">Review your feedback to see where things escalated.</p>
        </div>
      )
    }
    if (endReason === 'max_turns_reached' && outcome === 'success') {
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-center">
          <p className="text-2xl mb-1">✅</p>
          <p className="text-xl font-bold text-blue-700">Session Complete</p>
          <p className="text-sm text-blue-600 mt-1">You reached the turn limit — scored on final results.</p>
        </div>
      )
    }
    if (endReason === 'max_turns_reached' && outcome === 'failure') {
      return (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-center">
          <p className="text-2xl mb-1">⏱</p>
          <p className="text-xl font-bold text-yellow-700">Maximum Turns Reached</p>
          <p className="text-sm text-yellow-600 mt-1">Check your feedback for improvement tips.</p>
        </div>
      )
    }
    // Fallback (no endReason — old sessions)
    return (
      <div className={cn(
        'rounded-xl border px-6 py-5 text-center',
        outcome === 'success'
          ? 'bg-green-50 border-green-200 text-green-800'
          : 'bg-red-50 border-red-200 text-red-800'
      )}>
        <p className="text-2xl font-bold">
          {outcome === 'success' ? '🎉 Session Complete — Success!' : 'Session Complete — Keep Practicing'}
        </p>
        <p className="text-sm mt-1 opacity-60">{scenarioTitle}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Outcome banner */}
        {renderOutcomeBanner()}

        {/* Score cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Final Trust',  value: trustScore ?? '—', valueClass: getTrustTextColor(trustScore ?? 0), suffix: null },
            { label: 'Escalation',   value: escalationLevel ?? '—', valueClass: 'text-gray-800', suffix: '/5' },
            { label: 'Turns',        value: currentTurn ?? '—', valueClass: 'text-gray-800', suffix: totalTurns ? `/${totalTurns}` : null },
          ].map(({ label, value, valueClass, suffix }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              <p className={cn('text-4xl font-bold', valueClass)}>
                {value}
                {suffix && <span className="text-lg text-gray-400">{suffix}</span>}
              </p>
            </div>
          ))}
        </div>

        {/* Session length context line */}
        {(recommendedTurns || maxTurns) && (
          <p className="text-xs text-gray-400 text-center -mt-2">
            Session lasted{' '}
            <span className={cn(
              'font-medium',
              (currentTurn ?? 0) <= (recommendedTurns ?? 6)
                ? 'text-green-500'
                : (currentTurn ?? 0) <= (maxTurns ?? 999)
                  ? 'text-yellow-500'
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
        {!isLoading && trustHistory.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Trust Progression</h2>
            <div className="relative flex items-end gap-2" style={{ height: '128px' }}>
              <div
                className="absolute left-0 right-0 border-t border-dashed border-gray-300 pointer-events-none"
                style={{ bottom: `${(50 / 100) * 96}px` }}
              />
              {trustHistory.map((val, i) => (
                <div key={i} className="flex flex-col items-center gap-1 flex-1">
                  <span className={cn('text-[10px] font-medium tabular-nums', getTrustTextColor(val))}>
                    {val}
                  </span>
                  <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                    <div
                      className={cn('w-full rounded-t transition-all', getTrustBarColor(val))}
                      style={{ height: `${Math.max(2, (val / 100) * 96)}px` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 tabular-nums">
                    {i === 0 ? 'S' : `T${i}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trust delta per turn */}
        {!isLoading && trustDeltas.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Trust Change Per Turn</h2>
            <div className="flex flex-wrap gap-2">
              {trustDeltas.map((d, i) => (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-bold',
                    d > 0 ? 'bg-green-100 text-green-700'
                    : d < 0 ? 'bg-red-100 text-red-600'
                    : 'bg-gray-100 text-gray-500'
                  )}
                >
                  T{i + 1}: {d > 0 ? `+${d}` : d === 0 ? '±0' : d}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* NPC tone journey */}
        {!isLoading && toneHistory.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">NPC Attitude Over Time</h2>
            <div className="flex flex-wrap gap-2">
              {toneHistory.map((tone, i) => (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                    NPC_TONE_CHIP[tone] ?? 'bg-gray-100 text-gray-600'
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
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Emotion History</h2>
            <div className="flex flex-wrap gap-2">
              {emotionHistory.map((em, i) => (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium',
                    EMOTION_COLORS[em] ?? EMOTION_COLORS.confused
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
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Turn by Turn</h2>
            <div className="space-y-2">
              {visibleTurns.map((t) => (
                <div
                  key={t.turn}
                  className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                >
                  <span className="text-xs font-mono text-gray-400 w-5 shrink-0">T{t.turn}</span>
                  <span className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                    EMOTION_COLORS[t.emotion] ?? EMOTION_COLORS.confused
                  )}>
                    {t.emotion}
                  </span>
                  <span className={cn('shrink-0 text-xs font-medium tabular-nums', getTrustTextColor(t.trust_score))}>
                    {t.trust_score}
                  </span>
                  <p className="text-xs text-gray-500 truncate">{t.user_input}</p>
                </div>
              ))}
            </div>
            {turns.length > 3 && (
              <button
                onClick={() => setShowAllTurns((v) => !v)}
                className="mt-3 flex items-center gap-1 text-xs text-blue-600 hover:underline"
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
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400 animate-pulse">
            Loading session data…
          </div>
        )}

        {/* Performance summary */}
        {!isLoading && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">How Did You Do?</h2>
            <ul className="space-y-2 text-sm text-gray-700">
              <li>{trustInsight}</li>
              <li>{escInsight}</li>
              <li>{emotionInsight}</li>
            </ul>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-center flex-wrap pb-8">
          <button
            onClick={() => navigate('/training-plan')}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            View updated plan
          </button>
          <button
            onClick={() => navigate(`/roleplay/feedback/${sessionId}`)}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-700 transition-colors"
          >
            <BarChart2 size={14} /> View Full Feedback
          </button>
          <button
            onClick={() => navigate('/roleplay')}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <RefreshCw size={14} /> Try Again
          </button>
          <button
            onClick={() => navigate('/roleplay')}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <PlayCircle size={14} /> Try Another
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Home size={14} /> Back to Home
          </button>
        </div>

      </div>
    </div>
  )
}
