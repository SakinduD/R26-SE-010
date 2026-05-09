import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Lightbulb,
  RefreshCw,
  ChevronRight,
  Target,
  Calendar,
  TrendingUp,
  Zap,
  AlertCircle,
  CheckCircle,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import { useAnalyticsIdentity } from './analyticsAuth'

export default function AnalyticsRecommendationsNew() {
  const params = useParams()
  const { userId: connectedUserId, userLabel, isAuthLoading, isAuthenticated } = useAnalyticsIdentity(params.userId)
  
  const [mode, setMode] = useState('session')
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated || !connectedUserId) {
      return
    }

    const loadSessions = async () => {
      try {
        const rpeData = await analyticsService.getComponentRpeSessions()
        const mcaData = await analyticsService.getComponentMcaSessions(50, 0)

        const allSessions = [
          ...(Array.isArray(rpeData) ? rpeData : []).map(s => ({
            id: s.session_id,
            label: `${s.scenario_id || 'Practice Session'}`,
            subtitle: `Role-Play Exercise • ${new Date(s.started_at).toLocaleDateString()} ${new Date(s.started_at).toLocaleTimeString()}`,
            type: 'rpe',
            timestamp: s.started_at,
          })),
          ...(Array.isArray(mcaData) ? mcaData : []).map(s => ({
            id: s.id,
            label: `${s.mode || 'Conversation'} Session`,
            subtitle: `Interview Practice • ${new Date(s.started_at).toLocaleDateString()} ${new Date(s.started_at).toLocaleTimeString()}`,
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

    loadSessions()
  }, [isAuthenticated, connectedUserId, isAuthLoading])

  useEffect(() => {
    const loadSessionRecommendations = async () => {
      if (!selectedSession) return
      
      setLoading(true)
      setError('')
      
      try {
        const data = await analyticsService.getMentoringRecommendationsBySession(selectedSession.id)
        setRecommendations(data.recommendations || [])
      } catch (err) {
        const errorMsg = err.response?.data?.detail || err.message || 'Could not load recommendations'
        setError(errorMsg)
      } finally {
        setLoading(false)
      }
    }

    if (mode === 'session') {
      loadSessionRecommendations()
    }
  }, [selectedSession, mode])

  const loadOverallRecommendations = async () => {
    setLoading(true)
    setError('')
    
    try {
      const data = await analyticsService.getMentoringRecommendationsByUser(connectedUserId)
      setRecommendations(data.recommendations || [])
    } catch (err) {
      setError('Could not load overall recommendations')
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
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">Feedback & Recommendations</p>
            <h1 className="text-lg font-bold">Your Coaching Insights</h1>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <AnalyticsNav />
            <Button 
              onClick={() => mode === 'overall' ? loadOverallRecommendations() : undefined}
              className="h-10 px-5 text-sm font-semibold"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {isAuthLoading && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Loading your data...</p>
          </div>
        )}

        {!isAuthLoading && !isAuthenticated && (
          <div className="rounded-xl border-2 border-red-500/50 bg-red-500/10 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-red-300">Not Logged In</p>
              <p className="text-red-400 text-xs mt-0.5">Please sign in to see your personalized coaching recommendations.</p>
            </div>
          </div>
        )}

        {!isAuthLoading && isAuthenticated && connectedUserId && (
          <>
            {/* Mode Selector */}
            <div className="mb-6 flex gap-2">
              <button
                onClick={() => setMode('session')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md border transition-colors ${
                  mode === 'session'
                    ? 'border-primary bg-primary text-primary-foreground font-semibold'
                    : 'border-border bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <Zap className="h-4 w-4" />
                This Session
              </button>
              <button
                onClick={() => setMode('overall')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md border transition-colors ${
                  mode === 'overall'
                    ? 'border-primary bg-primary text-primary-foreground font-semibold'
                    : 'border-border bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <TrendingUp className="h-4 w-4" />
                Overall Progress
              </button>
            </div>

            {/* Session Selector */}
            {mode === 'session' && (
              <label className="mb-6 grid gap-1 text-xs text-muted-foreground">
                <span className="font-semibold flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Choose a Practice Session
                </span>
                <select 
                  value={selectedSession?.id || ''} 
                  onChange={(e) => {
                    const session = sessions.find(s => s.id === e.target.value)
                    setSelectedSession(session || null)
                  }}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary"
                >
                  <option value="">Select a session...</option>
                  {sessions.map(session => (
                    <option key={session.id} value={session.id}>
                      {session.label} • {session.subtitle}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Error Message */}
            {error && (
              <div className="mb-6 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-destructive text-sm">Error Loading Recommendations</p>
                  <p className="text-destructive/80 text-xs mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-muted-foreground">Loading your recommendations...</p>
              </div>
            )}

            {/* Recommendations Display */}
            {!loading && (
              <>
                {recommendations.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-muted/30 px-8 py-12 text-center">
                    <Lightbulb className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
                    <p className="font-semibold text-foreground">No recommendations yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mode === 'session' ? 'Select a session above to see your personalized feedback' : 'Complete more practice sessions to get detailed recommendations'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {mode === 'session' ? `Session Feedback • ${recommendations.length} Tips` : `Overall Progress • ${recommendations.length} Areas to Focus`}
                      </p>
                    </div>
                    {recommendations.map((rec, idx) => (
                      <RecommendationCard key={idx} recommendation={rec} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function RecommendationCard({ recommendation }) {
  const [expanded, setExpanded] = useState(false)
  
  const priorityConfig = {
    high: {
      bg: 'bg-red-50 dark:bg-red-950/30',
      border: 'border-red-300 dark:border-red-900/50',
      badge: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
      icon: '🔴',
      label: 'High Priority'
    },
    medium: {
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      border: 'border-amber-300 dark:border-amber-900/50',
      badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
      icon: '🟡',
      label: 'Medium Priority'
    },
    low: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      border: 'border-emerald-300 dark:border-emerald-900/50',
      badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300',
      icon: '🟢',
      label: 'Keep It Up'
    },
  }

  const config = priorityConfig[recommendation.priority] || priorityConfig.medium
  
  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className={`rounded-xl border ${config.border} ${config.bg} p-4 transition-all cursor-pointer hover:border-opacity-60`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{config.icon}</span>
            <span className={`rounded-md px-2 py-1 text-xs font-bold ${config.badge}`}>
              {config.label}
            </span>
          </div>
          <h3 className="font-bold text-sm text-foreground">{recommendation.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{recommendation.reason}</p>
        </div>
        <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform flex-shrink-0 mt-0.5 ${expanded ? 'rotate-90' : ''}`} />
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-current border-opacity-10 pt-3">
          <div>
            <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              What This Means
            </h4>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{recommendation.detail}</p>
          </div>
          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <h4 className="font-semibold text-sm text-foreground mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Your Next Step
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{recommendation.next_action}</p>
          </div>
          {recommendation.skill_area && (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Skill:</span> {recommendation.skill_area}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
