import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, RefreshCw, Home, PlayCircle } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'

const EMOTION_COLORS = {
  calm:       'bg-green-100 text-green-700',
  assertive:  'bg-blue-100 text-blue-700',
  anxious:    'bg-yellow-100 text-yellow-700',
  frustrated: 'bg-red-100 text-red-700',
  confused:   'bg-gray-100 text-gray-700',
}

const getTrustBarColor   = (s) => s >= 70 ? 'bg-green-500'  : s >= 40 ? 'bg-yellow-400'  : 'bg-red-500'
const getTrustTextColor  = (s) => s >= 70 ? 'text-green-600': s >= 40 ? 'text-yellow-500' : 'text-red-500'

export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, trustScore, escalationLevel, outcome,
    totalTurns, scenarioTitle, currentTurn,
  } = location.state || {}

  const [sessionData, setSessionData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
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
  const visibleTurns   = showAllTurns ? turns : turns.slice(0, 3)

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Outcome banner */}
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

        {/* Score cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: 'Final Trust',
              value: trustScore ?? '—',
              valueClass: getTrustTextColor(trustScore ?? 0),
              suffix: null,
            },
            {
              label: 'Escalation',
              value: escalationLevel ?? '—',
              valueClass: 'text-gray-800',
              suffix: '/5',
            },
            {
              label: 'Turns',
              value: currentTurn ?? '—',
              valueClass: 'text-gray-800',
              suffix: `/${totalTurns}`,
            },
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

        {/* Trust progression bar chart */}
        {!isLoading && trustHistory.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Trust Progression</h2>
            <div className="flex items-end gap-1.5" style={{ height: '88px' }}>
              {trustHistory.map((val, i) => (
                <div key={i} className="flex flex-col items-center gap-1 flex-1">
                  <div className="w-full flex flex-col justify-end" style={{ height: '72px' }}>
                    <div
                      className={cn('w-full rounded-t transition-all', getTrustBarColor(val))}
                      style={{ height: `${Math.max(2, (val / 100) * 72)}px` }}
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

        {/* Action buttons */}
        <div className="flex gap-3 justify-center flex-wrap pb-8">
          <button
            onClick={() => navigate('/roleplay')}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
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
