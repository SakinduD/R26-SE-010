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
import { analyticsService } from '../../services/analytics/analyticsService'
// REDESIGN: AnalyticsNav removed — sidebar Progress section now handles navigation
import AnalyticsLoadButton from './AnalyticsLoadButton'
import AnalyticsSessionSelect from './AnalyticsSessionSelect'
import { useAnalyticsIdentity } from './analyticsAuth'
import { loadComponentSessionOptions, selectPreferredComponentSession } from './analyticsIntegrationUtils'

export default function AnalyticsRecommendationsNew() {
  const params = useParams()
  const { userId: connectedUserId, userLabel, isAuthLoading, isAuthenticated } = useAnalyticsIdentity(params.userId)
  
  const [mode, setMode] = useState('session')
  const [sessionOptions, setSessionOptions] = useState([])
  const [sessionId, setSessionId] = useState('')
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
    : (sessionCache[sessionId]?.recommendations || [])

  // Present only when a reflection was about more than practice. See
  // reflection_support.py for why this is not one of the recommendations.
  const supportPath = mode === 'overall'
    ? (overallCache?.supportPath || null)
    : (sessionCache[sessionId]?.supportPath || null)
  const evidence = mode === 'overall'
    ? (overallCache?.evidence || null)
    : (sessionCache[sessionId]?.evidence || null)

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
        const options = await loadComponentSessionOptions(analyticsService, connectedUserId)
        setSessionOptions(options)
        setSessionId((current) => current || selectPreferredComponentSession(options)?.id || '')
      } catch (err) {
        console.error('Failed to load sessions:', err)
        setSessionOptions([])
      }
    }

    loadSessions()
  }, [isAuthenticated, connectedUserId, isAuthLoading])

  // Load session recommendations only when session changes AND not yet fetched
  useEffect(() => {
    if (mode !== 'session' || !sessionId) return
    if (hasFetchedSession.current[sessionId]) return

    hasFetchedSession.current[sessionId] = true

    const fetchSession = async () => {
      setLoading(true)
      setError('')
      try {
        const data = await analyticsService.getMentoringRecommendationsBySession(sessionId, false)
        setSessionCache(prev => ({ ...prev, [sessionId]: { recommendations: data.recommendations || [], evidence: data.evidence || null, supportPath: data.support_path || null } }))
      } catch (err) {
        hasFetchedSession.current[sessionId] = false // allow retry
        setError(err.response?.data?.detail || err.message || 'Could not load recommendations')
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  }, [sessionId, mode])

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
        setOverallCache({ recommendations: data.recommendations || [], evidence: data.evidence || null, supportPath: data.support_path || null })
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
      if (mode === 'session' && sessionId) {
        const data = await analyticsService.getMentoringRecommendationsBySession(sessionId, true)
        setSessionCache(prev => ({ ...prev, [sessionId]: { recommendations: data.recommendations || [], evidence: data.evidence || null, supportPath: data.support_path || null } }))
      } else if (mode === 'overall') {
        const data = await analyticsService.getMentoringRecommendationsByUser(connectedUserId, true)
        setOverallCache({ recommendations: data.recommendations || [], evidence: data.evidence || null, supportPath: data.support_path || null })
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
            <AnalyticsLoadButton loading={loading} onClick={handleRefresh}>
              Refresh
            </AnalyticsLoadButton>
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

        {/* REDESIGN: not-logged-in state — border-red-500/50 → border-danger/50, bg-red-500/10 → bg-danger/10, text-red-300 → text-danger */}
        {!isAuthLoading && !isAuthenticated && (
          <div className="rounded-xl border-2 border-danger/50 bg-danger/10 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-danger mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-danger">Not Logged In</p>
              <p className="text-t-secondary text-xs mt-0.5">Please sign in to see your personalized coaching recommendations.</p>
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
                <div className="grid gap-3 text-sm">
                  <span className="font-semibold text-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Which practice session would you like to review?
                  </span>
                  <AnalyticsSessionSelect
                    value={sessionId}
                    options={sessionOptions}
                    onChange={setSessionId}
                    label="Session"
                    minWidthClass="w-full max-w-xl"
                  />
                </div>
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
                          <h3 className="font-bold text-foreground">What to work on</h3>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                          {mode === 'session'
                            ? 'Built from this session alone: where your rating differed from what was measured, and what you scored.'
                            : 'Built from your whole history: declining skills, predicted risks, and patterns in how you rate yourself.'}
                        </p>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-muted/50 rounded-lg p-3 border border-border/50 text-center">
                            <span className="block text-xs font-semibold text-muted-foreground mb-1">Actions</span>
                            <span className="text-lg font-bold text-foreground">{recommendations.length}</span>
                          </div>
                          {/* REDESIGN: rose/amber/emerald priority pills → danger/warning/success tokens */}
                          <div className="flex-1 bg-danger/10 rounded-lg p-3 border border-danger/20 text-center">
                            <span className="block text-xs font-semibold text-danger mb-1">High</span>
                            <span className="text-lg font-bold text-danger">{recommendations.filter(r => r.priority === 'high').length}</span>
                          </div>
                          <div className="flex-1 bg-warning/10 rounded-lg p-3 border border-warning/20 text-center">
                            <span className="block text-xs font-semibold text-warning mb-1">Medium</span>
                            <span className="text-lg font-bold text-warning">{recommendations.filter(r => r.priority === 'medium').length}</span>
                          </div>
                          <div className="flex-1 bg-success/10 rounded-lg p-3 border border-success/20 text-center">
                            <span className="block text-xs font-semibold text-success mb-1">Low</span>
                            <span className="text-lg font-bold text-success">{recommendations.filter(r => r.priority === 'low').length}</span>
                          </div>
                        </div>
                      </div>

                      {/* Evidence Summary */}
                      {evidence && (
                        <div className="rounded-xl border border-border bg-card p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <Target className="h-5 w-5 text-primary" />
                            <h3 className="font-bold text-foreground">What we looked at</h3>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {evidence.session_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Sessions</span>
                                <span className="text-base font-bold text-foreground">{evidence.session_count}</span>
                              </div>
                            )}
                            {/* "Feedback" beside "Sessions 118" read as "you gave
                                392 pieces of feedback". Two thirds of those rows
                                are notes this codebase wrote itself. What the
                                learner did is rate themselves — after 30 sessions
                                overall, on 4 skills within one session. */}
                            <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                              <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                                {mode === 'session' ? 'Skills you rated' : 'Times you rated yourself'}
                              </span>
                              <span className="text-base font-bold text-foreground">{evidence.feedback_count || 0}</span>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                              <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Gaps found</span>
                              <span className="text-base font-bold text-foreground">{evidence.blind_spot_count || 0}</span>
                            </div>
                            {evidence.high_risk_prediction_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Needs work now</span>
                                <span className="text-base font-bold text-foreground">{evidence.high_risk_prediction_count}</span>
                              </div>
                            )}
                            {evidence.improving_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Getting better</span>
                                <span className="text-base font-bold text-foreground">{evidence.improving_count}</span>
                              </div>
                            )}
                            {evidence.declining_count !== undefined && (
                              <div className="bg-muted/50 rounded-lg p-2 border border-border/50">
                                <span className="block text-[10px] uppercase font-semibold text-muted-foreground">Slipping</span>
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

                    <SupportPathNotice path={supportPath} />
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

/**
 * The one thing this page says about a reflection that was not about practice.
 *
 * Below the advice, not above it: it is not a recommendation, it is not ranked
 * against them, and it does not replace them. Quiet on purpose - a red alarm over
 * someone's sentence about their own life reads as the software reacting to them,
 * and a learner who works out that certain words trigger something will write
 * blander reflections from then on.
 *
 * It offers phone numbers and says nothing about the person.
 */
function SupportPathNotice({ path }) {
  // A shape check, not just a null check. There is no error boundary in this
  // app, so one undefined field here takes the whole page down.
  if (!path?.message || !path.contacts?.length) return null

  return (
    <div
      className="mt-4"
      style={{
        padding: '14px 16px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-elevated)',
      }}
    >
      <p className="t-cap" style={{ margin: 0, lineHeight: 1.65 }}>{path.message}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px', marginTop: 12 }}>
        {path.contacts.map((contact) => (
          <div key={contact.number}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="fg" style={{ fontSize: 13, fontWeight: 600 }}>{contact.name}</span>
              {/* Text, not a tel: link - on a laptop that opens nothing useful,
                  and this number needs to be readable and dialled from a phone. */}
              <span className="fg" style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {contact.number}
              </span>
            </div>
            <div className="t-cap" style={{ fontSize: 11 }}>{contact.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecommendationCard({ recommendation }) {
  const [expanded, setExpanded] = useState(false)
  
  // REDESIGN: rose/amber/emerald → danger/warning/success semantic tokens
  const priorityConfig = {
    high: {
      wrapper: 'from-danger/10 to-transparent border-danger/20',
      header: 'bg-danger/5',
      badge: 'bg-danger/10 text-danger border-danger/20',
      icon: <AlertTriangle className="h-5 w-5 text-danger" />,
      label: 'Focus Here First',
      actionBtn: 'bg-danger/10 text-danger hover:bg-danger/20'
    },
    medium: {
      wrapper: 'from-warning/10 to-transparent border-warning/20',
      header: 'bg-warning/5',
      badge: 'bg-warning/10 text-warning border-warning/20',
      icon: <Target className="h-5 w-5 text-warning" />,
      label: 'Good to Practice',
      actionBtn: 'bg-warning/10 text-warning hover:bg-warning/20'
    },
    // "low" is how urgent this item is, not how the learner is doing. Labelled
    // "Doing Great!" it sat in green above a card reading "15-point
    // overestimation" - praise stamped on a gap. The badge now says where the
    // item sits in the queue and leaves the verdict to the card.
    low: {
      wrapper: 'from-info/10 to-transparent border-info/20',
      header: 'bg-info/5',
      badge: 'bg-info/10 text-info border-info/20',
      icon: <Lightbulb className="h-5 w-5 text-info" />,
      label: 'When You Have Time',
      actionBtn: 'bg-info/10 text-info hover:bg-info/20'
    },
  }

  const config = priorityConfig[recommendation.priority] || priorityConfig.medium
  
  // REDESIGN: removed shadow-md/shadow-sm from card — borders + gradient wrapper provide depth
  return (
    <div className={`overflow-hidden rounded-2xl border bg-card transition-all duration-300 ${config.wrapper} bg-gradient-to-br`}>
      {/* Clickable Header */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className={`p-5 cursor-pointer flex gap-4 items-start select-none transition-colors hover:bg-foreground/[0.02] ${expanded ? config.header : ''}`}
      >
        <div className="mt-0.5 p-2 rounded-xl bg-background border border-border/50">
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
          <div className={`p-1.5 rounded-full transition-colors ${expanded ? 'bg-background' : 'hover:bg-muted'}`}>
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
              <div className="rounded-xl bg-background border border-border/60 p-4 relative overflow-hidden group">
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
