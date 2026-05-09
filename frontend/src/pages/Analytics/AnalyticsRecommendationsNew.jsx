import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Lightbulb,
  RefreshCw,
  ChevronRight,
  Target,
  CheckCircle2,
  Clock,
  User,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import { useAnalyticsIdentity } from './analyticsAuth'

export default function AnalyticsRecommendationsNew() {
  const params = useParams()
  const { userId: connectedUserId, userLabel, isAuthLoading, isAuthenticated } = useAnalyticsIdentity(params.userId)
  
  const [mode, setMode] = useState('session') // 'session' or 'overall'
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Load sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const rpeData = await analyticsService.getComponentRpeSessions()
        const mcaData = await analyticsService.getComponentMcaSessions(50, 0)

        const allSessions = [
          ...(Array.isArray(rpeData) ? rpeData : []).map(s => ({
            id: s.session_id,
            label: `RPE - ${s.scenario_id || 'Session'} - ${new Date(s.started_at).toLocaleString()}`,
            type: 'rpe',
            timestamp: s.started_at,
          })),
          ...(Array.isArray(mcaData) ? mcaData : []).map(s => ({
            id: s.id,
            label: `MCA - ${s.mode || 'Session'} - ${new Date(s.started_at).toLocaleString()}`,
            type: 'mca',
            timestamp: s.started_at,
          })),
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

        setSessions(allSessions)
        if (allSessions.length > 0) {
          setSelectedSession(allSessions[0])
        }
      } catch (err) {
        console.error('Failed to load sessions:', err)
      }
    }

    if (isAuthenticated && connectedUserId) {
      loadSessions()
    }
  }, [isAuthenticated, connectedUserId])

  // Load recommendations when session is selected
  useEffect(() => {
    const loadSessionRecommendations = async () => {
      if (!selectedSession) return
      
      setLoading(true)
      setError('')
      
      try {
        const data = await analyticsService.getMentoringRecommendationsBySession(selectedSession.id)
        setRecommendations(data.recommendations || [])
      } catch (err) {
        setError('Unable to load recommendations. Please try again.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    if (mode === 'session') {
      loadSessionRecommendations()
    }
  }, [selectedSession, mode])

  // Load overall recommendations
  const loadOverallRecommendations = async () => {
    setLoading(true)
    setError('')
    
    try {
      const data = await analyticsService.getMentoringRecommendationsByUser(connectedUserId)
      setRecommendations(data.recommendations || [])
    } catch (err) {
      setError('Unable to load overall recommendations. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (mode === 'overall' && isAuthenticated) {
      loadOverallRecommendations()
    }
  }, [mode, isAuthenticated, connectedUserId])

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Coaching Dashboard</p>
              <h1 className="mt-1 text-3xl font-bold text-white">My Recommendations</h1>
            </div>
            <div className="flex gap-2">
              <AnalyticsNav />
              <Button 
                onClick={() => selectedSession ? undefined : loadOverallRecommendations()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        {/* Mode Selector */}
        <div className="mb-8 grid grid-cols-2 gap-4">
          <button
            onClick={() => setMode('session')}
            className={`rounded-xl border-2 p-4 transition-all ${
              mode === 'session'
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
            }`}
          >
            <Lightbulb className="mb-2 h-6 w-6" />
            <p className="font-semibold">This Session</p>
            <p className="text-xs text-slate-400">Specific feedback</p>
          </button>
          <button
            onClick={() => setMode('overall')}
            className={`rounded-xl border-2 p-4 transition-all ${
              mode === 'overall'
                ? 'border-purple-500 bg-purple-500/10 text-white'
                : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
            }`}
          >
            <Target className="mb-2 h-6 w-6" />
            <p className="font-semibold">Overall Growth</p>
            <p className="text-xs text-slate-400">Long-term progress</p>
          </button>
        </div>

        {/* Session Selector (only show in session mode) */}
        {mode === 'session' && (
          <div className="mb-8">
            <label className="block text-sm font-semibold text-white mb-3">Select a Session</label>
            <select
              value={selectedSession?.id || ''}
              onChange={(e) => {
                const session = sessions.find(s => s.id === e.target.value)
                setSelectedSession(session)
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Choose a session...</option>
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-400">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-slate-400">Loading recommendations...</p>
          </div>
        )}

        {/* Recommendations */}
        {!loading && (
          <>
            {recommendations.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/30 px-6 py-12 text-center">
                <Lightbulb className="mx-auto mb-3 h-8 w-8 text-slate-500" />
                <p className="text-slate-400">No recommendations available yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  {mode === 'session' ? 'Select a session to view recommendations' : 'Complete more sessions to get personalized recommendations'}
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {recommendations.map((rec, idx) => (
                  <RecommendationCard key={idx} recommendation={rec} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function RecommendationCard({ recommendation }) {
  const [expanded, setExpanded] = useState(false)
  
  const priorityColors = {
    high: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', badge: 'bg-red-500/20 text-red-300' },
    medium: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', badge: 'bg-yellow-500/20 text-yellow-300' },
    low: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', badge: 'bg-green-500/20 text-green-300' },
  }

  const colors = priorityColors[recommendation.priority] || priorityColors.medium
  
  return (
    <div className={`rounded-xl border-2 ${colors.border} ${colors.bg} p-4 transition-all hover:border-opacity-100 cursor-pointer`} onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colors.badge}`}>
              {recommendation.priority.toUpperCase()}
            </span>
            {recommendation.skill_area && (
              <span className="text-xs text-slate-400">{recommendation.skill_area}</span>
            )}
          </div>
          <h3 className="mt-2 text-lg font-bold text-white">{recommendation.title}</h3>
          <p className="mt-1 text-sm text-slate-300">{recommendation.reason}</p>
        </div>
        <ChevronRight className={`h-6 w-6 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-slate-700/50 pt-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Details</p>
            <p className="mt-1 text-sm text-slate-300">{recommendation.detail}</p>
          </div>
          <div className="rounded-lg bg-slate-900/50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-400">Next Action</p>
            <p className="mt-1 text-sm text-slate-200">{recommendation.next_action}</p>
          </div>
          {recommendation.source && (
            <p className="text-xs text-slate-500">Source: {recommendation.source}</p>
          )}
        </div>
      )}
    </div>
  )
}
