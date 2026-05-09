import React, { useEffect, useRef, useState } from 'react'
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
  Award,
  AlertTriangle,
  ArrowRight,
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Cache: avoid re-fetching on tab switch
  const [overallCache, setOverallCache] = useState(null) // { recommendations, evidence }
  const [sessionCache, setSessionCache] = useState({})   // { [sessionId]: { recommendations, evidence } }

  // Refs track whether a fetch has started — avoids including cache objects in effect deps
  const hasFetchedOverall = useRef(false)
  const hasFetchedSession = useRef({})  // { [sessionId]: true }

  // Derive display data from caches
  const recommendations = mode === 'overall'
    ? (overallCache?.recommendations || [])
    : (sessionCache[selectedSession?.id]?.recommendations || [])
  const evidence = mode === 'overall'
    ? (overallCache?.evidence || null)
    : (sessionCache[selectedSession?.id]?.evidence || null)

  // Clear caches and fetch flags when user identity changes
  useEffect(() => {
    setOverallCache(null)
    setSessionCache({})
    hasFetchedOverall.current = false
    hasFetchedSession.current = {}
  }, [connectedUserId])

  useEffect(() => {
    if (!isAuthenticated || !connectedUserId) return

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
        if (allSessions.length > 0) setSelectedSession(allSessions[0])
      } catch (err) {
        console.error('Failed to load sessions:', err)
      }
    }

    loadSessions()
  }, [isAuthenticated, connectedUserId, isAuthLoading])

  // Load session recommendations only when session changes AND not yet fetched
  useEffect(() => {
    if (mode !== 'session' || !selectedSession) return
    if (hasFetchedSession.current[selectedSession.id]) return

    hasFetchedSession.current[selectedSession.id] = true

    const fetchSession = async () => {
      setLoading(true)
      setError('')
      try {
        const data = await analyticsService.getMentoringRecommendationsBySession(selectedSession.id, false)
        setSessionCache(prev => ({ ...prev, [selectedSession.id]: { recommendations: data.recommendations || [], evidence: data.evidence || null } }))
      } catch (err) {
        hasFetchedSession.current[selectedSession.id] = false // allow retry
        setError(err.response?.data?.detail || err.message || 'Could not load recommendations')
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  }, [selectedSession, mode])

  // Load overall recommendations only once per user session (ref prevents re-fetch on tab switch)
  useEffect(() => {
    if (mode !== 'overall' || !isAuthenticated || !connectedUserId) return
    if (hasFetchedOverall.current) return

    hasFetchedOverall.current = true

    const fetchOverall = async () => {
      setLoading(true)
      setError('')
      try {
        const data = await analyticsService.getMentoringRecommendationsByUser(connectedUserId, false)
        setOverallCache({ recommendations: data.recommendations || [], evidence: data.evidence || null })
      } catch (err) {
        hasFetchedOverall.current = false // allow retry
        setError(err.response?.data?.detail || err.message || 'Could not load overall recommendations')
      } finally {
        setLoading(false)
      }
    }
    fetchOverall()
  }, [mode, isAuthenticated, connectedUserId])

  const handleRefresh = async () => {
    setLoading(true)
    setError('')
    try {
      if (mode === 'session' && selectedSession) {
        const data = await analyticsService.getMentoringRecommendationsBySession(selectedSession.id, true)
        setSessionCache(prev => ({ ...prev, [selectedSession.id]: { recommendations: data.recommendations || [], evidence: data.evidence || null } }))
      } else if (mode === 'overall') {
        const data = await analyticsService.getMentoringRecommendationsByUser(connectedUserId, true)
        setOverallCache({ recommendations: data.recommendations || [], evidence: data.evidence || null })
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Could not refresh recommendations')
    } finally {
      setLoading(false)
    }
  }

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
              onClick={handleRefresh}
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
          <div className="space-y-8">
            {/* Mode Selector - Modern Segmented Control */}
            <div className="flex justify-center">
              <div className="inline-flex items-center p-1 bg-muted/50 rounded-xl border border-border/50 backdrop-blur-sm">
                <button
                  onClick={() => setMode('session')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    mode === 'session'
                      ? 'bg-background shadow-sm text-foreground ring-1 ring-border/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                  }`}
                >
                  <Zap className={`h-4 w-4 ${mode === 'session' ? 'text-primary' : ''}`} />
                  This Session
                </button>
                <button
                  onClick={() => setMode('overall')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    mode === 'overall'
                      ? 'bg-background shadow-sm text-foreground ring-1 ring-border/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                  }`}
                >
                  <TrendingUp className={`h-4 w-4 ${mode === 'overall' ? 'text-primary' : ''}`} />
                  Overall Progress
                </button>
              </div>
            </div>

            {/* Session Selector */}
            {mode === 'session' && (
              <div className="bg-card/30 border border-border/50 rounded-xl p-5 backdrop-blur-sm">
                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Which practice session would you like to review?
                  </span>
                  <select 
                    value={selectedSession?.id || ''} 
                    onChange={(e) => {
                      const session = sessions.find(s => s.id === e.target.value)
                      setSelectedSession(session || null)
                    }}
                    className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all cursor-pointer"
                  >
                    <option value="" className="bg-background text-foreground">Select a session to see your feedback...</option>
                    {sessions.map(session => (
                      <option key={session.id} value={session.id} className="bg-background text-foreground">
                        {session.label} • {session.subtitle}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
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
              <div className="pt-2">
                {recommendations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-8 py-16 text-center">
                    <div className="mx-auto mb-4 h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center">
                      <Lightbulb className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground mb-2">You're all caught up!</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      {mode === 'session' 
                        ? 'We don\'t have any specific feedback for this session yet. Try selecting another one or complete a new practice session!' 
                        : 'Complete more practice sessions to unlock personalized coaching tips and insights.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Summaries Row */}
                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Prioritized Actions Summary */}
                      <div className="rounded-xl border border-border bg-card p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Zap className="h-5 w-5 text-primary" />
                          <h3 className="font-bold text-foreground">Prioritized mentoring actions</h3>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                          Recommendations combine blind spots, predicted risks, progress trends, feedback volume, session evidence, and LLM mentoring into one action plan.
                        </p>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-muted/50 rounded-lg p-3 border border-border/50 text-center">
                            <span className="block text-xs font-semibold text-muted-foreground mb-1">Actions</span>
                            <span className="text-lg font-bold text-foreground">{recommendations.length}</span>
                          </div>
                          <div className="flex-1 bg-rose-500/10 rounded-lg p-3 border border-rose-500/20 text-center">
                            <span className="block text-xs font-semibold text-rose-500 mb-1">High</span>
                            <span className="text-lg font-bold text-rose-500">{recommendations.filter(r => r.priority === 'high').length}</span>
                          </div>
                          <div className="flex-1 bg-amber-500/10 rounded-lg p-3 border border-amber-500/20 text-center">
                            <span className="block text-xs font-semibold text-amber-500 mb-1">Medium</span>
                            <span className="text-lg font-bold text-amber-500">{recommendations.filter(r => r.priority === 'medium').length}</span>
                          </div>
                          <div className="flex-1 bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20 text-center">
                            <span className="block text-xs font-semibold text-emerald-500 mb-1">Low</span>
                            <span className="text-lg font-bold text-emerald-500">{recommendations.filter(r => r.priority === 'low').length}</span>
                          </div>
                        </div>
                      </div>

                      {/* Evidence Summary */}
                      {evidence && (
                        <div className="rounded-xl border border-border bg-card p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <Target className="h-5 w-5 text-primary" />
                            <h3 className="font-bold text-foreground">Evidence Summary</h3>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {evidence.session_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Sessions</span>
                                <span className="text-base font-bold text-foreground">{evidence.session_count}</span>
                              </div>
                            )}
                            <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                              <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Feedback</span>
                              <span className="text-base font-bold text-foreground">{evidence.feedback_count || 0}</span>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                              <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Blind Spots</span>
                              <span className="text-base font-bold text-foreground">{evidence.blind_spot_count || 0}</span>
                            </div>
                            {evidence.high_risk_prediction_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">High Risk</span>
                                <span className="text-base font-bold text-foreground">{evidence.high_risk_prediction_count}</span>
                              </div>
                            )}
                            {evidence.improving_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Improving</span>
                                <span className="text-base font-bold text-foreground">{evidence.improving_count}</span>
                              </div>
                            )}
                            {evidence.declining_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Declining</span>
                                <span className="text-base font-bold text-foreground">{evidence.declining_count}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 pt-4 pb-2 border-b border-border/50">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Lightbulb className="h-4 w-4 text-primary" />
                      </div>
                      <h2 className="text-lg font-bold text-foreground">
                        {mode === 'session' ? 'Your Session Action Plan' : 'Your Growth Opportunities'}
                      </h2>
                      <span className="ml-auto bg-muted px-2.5 py-1 rounded-full text-xs font-semibold text-muted-foreground">
                        {recommendations.length} {recommendations.length === 1 ? 'Tip' : 'Tips'}
                      </span>
                    </div>
                    
                    <div className="grid gap-4 mt-4">
                      {recommendations.map((rec, idx) => (
                        <RecommendationCard key={idx} recommendation={rec} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function RecommendationCard({ recommendation }) {
  const [expanded, setExpanded] = useState(false)
  
  const priorityConfig = {
    high: {
      wrapper: 'from-rose-500/10 to-transparent border-rose-500/20 dark:from-rose-950/30 dark:border-rose-900/40',
      header: 'bg-rose-500/5',
      badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      icon: <AlertTriangle className="h-5 w-5 text-rose-500" />,
      label: 'Focus Here First',
      actionBtn: 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400'
    },
    medium: {
      wrapper: 'from-amber-500/10 to-transparent border-amber-500/20 dark:from-amber-950/30 dark:border-amber-900/40',
      header: 'bg-amber-500/5',
      badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      icon: <Target className="h-5 w-5 text-amber-500" />,
      label: 'Good to Practice',
      actionBtn: 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400'
    },
    low: {
      wrapper: 'from-emerald-500/10 to-transparent border-emerald-500/20 dark:from-emerald-950/30 dark:border-emerald-900/40',
      header: 'bg-emerald-500/5',
      badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      icon: <Award className="h-5 w-5 text-emerald-500" />,
      label: 'Doing Great!',
      actionBtn: 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400'
    },
  }

  const config = priorityConfig[recommendation.priority] || priorityConfig.medium
  
  return (
    <div className={`overflow-hidden rounded-2xl border bg-card transition-all duration-300 ${expanded ? 'shadow-md ring-1 ring-foreground/5' : 'hover:shadow-sm'} ${config.wrapper} bg-gradient-to-br`}>
      {/* Clickable Header */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className={`p-5 cursor-pointer flex gap-4 items-start select-none transition-colors hover:bg-foreground/[0.02] ${expanded ? config.header : ''}`}
      >
        <div className="mt-0.5 p-2 rounded-xl bg-background shadow-sm border border-border/50">
          {config.icon}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wider ${config.badge}`}>
              {config.label}
            </span>
            {recommendation.skill_area && recommendation.skill_area !== 'overall' && (
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                • {recommendation.skill_area.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold text-foreground leading-tight mb-1.5">{recommendation.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{recommendation.reason}</p>
        </div>
        
        <div className="flex-shrink-0 mt-2">
          <div className={`p-1.5 rounded-full transition-colors ${expanded ? 'bg-background shadow-sm' : 'hover:bg-muted'}`}>
            <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform duration-300 ${expanded ? 'rotate-90 text-foreground' : ''}`} />
          </div>
        </div>
      </div>

      {/* Expandable Content */}
      <div className={`grid transition-all duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="p-5 pt-2 pb-6 border-t border-border/50 space-y-6">
            
            {/* Context/Explanation */}
            <div className="pl-12">
              <div className="flex items-start gap-3">
                <Lightbulb className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">Why this matters</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{recommendation.detail}</p>
                </div>
              </div>
            </div>

            {/* Actionable Step */}
            <div className="pl-12">
              <div className="rounded-xl bg-background border border-border/60 p-4 shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-primary/60"></div>
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Zap className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground mb-1.5">Your Action Plan</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed font-medium">{recommendation.next_action}</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
