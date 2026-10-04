import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Joyride, STATUS } from 'react-joyride'
import { AlertCircle, RefreshCw, Sparkles, Brain, History, Clock, Zap, BarChart2, X } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { useAuth } from '@/lib/auth/context'
import ScenarioCard from '@/components/RPE/ScenarioCard'
import ScenarioDetailModal from '@/components/RPE/ScenarioDetailModal'
import ActiveSessionLimitModal from '@/components/RPE/ActiveSessionLimitModal'
import { cn } from '@/lib/utils'
import { joyrideOptions, joyrideStyles } from '@/lib/tour/joyrideTheme'
import { useOnceTour } from '@/lib/tour/useOnceTour'

// First-visit walkthrough of this landing page — see useOnceTour for how
// "only once" is actually guaranteed. Kept separate from the in-session tour
// (RolePlaySession.jsx has its own), since the meters/mic/nudges it explains
// aren't visible until a scenario is actually running.
const TOUR_SEEN_KEY = 'rpe_tour_scenario_select_seen'

const scenarioSelectTourSteps = [
  {
    target: '[data-tour="rpe-welcome"]',
    title: 'Welcome to the Practice Lab',
    content: "Rehearse real workplace conversations with an AI character before they happen for real. Quick tour, four stops.",
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="rpe-personalized-btn"]',
    title: 'Personalized scenarios',
    content: 'Builds a scenario from your own Training Plan goals instead of the general library — tailored to what you\'re actually working on.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="rpe-categories"]',
    title: 'Pick what to practice',
    content: 'Filter by the skill you want to work on or by difficulty. Beginner scenarios are more forgiving; advanced ones escalate faster.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="rpe-compare-btn"]',
    title: 'Compare scenarios',
    content: 'See every scenario side-by-side — difficulty, category, skills practiced, length — before picking one.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="rpe-scenario-grid"]',
    title: "You're ready",
    content: 'Open any card to preview the situation and choose who you\'re talking to, then start the simulation.',
    placement: 'top',
  },
]

const DIFFICULTY_TONE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

// "What do you want to practice?" — replaces the old raw skill-tag filter
// with a handful of plain categories every scenario carries (see
// rpe_scenario_service.infer_category for how this is assigned). Difficulty
// lives in this same chip row now too, instead of its own separate control.
const CATEGORIES = [
  'Difficult Conversations', 'Negotiation', 'Conflict',
  'Assertiveness', 'Client Management', 'Leadership',
]
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced']

export default function ScenarioSelect() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const planId = searchParams.get('planId')
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()

  const [planImporting, setPlanImporting] = useState(!!planId)
  const [planError, setPlanError]         = useState(null)

  const [allScenarios, setAllScenarios]                     = useState([])
  const [activeSourceFilter, setActiveSourceFilter]         = useState('all') // 'all' | 'generated' | 'library'
  // Pre-applied from ?difficulty=/?category= — the "Try a Harder Scenario" /
  // "Practice Another Skill" links on the feedback screen land here.
  const [activeDifficultyFilter, setActiveDifficultyFilter] = useState(() => searchParams.get('difficulty') || null)
  const [activeCategoryFilter, setActiveCategoryFilter]     = useState(() => searchParams.get('category') || null)
  const [selectedScenario, setSelectedScenario]   = useState(null)
  const [startingId, setStartingId]               = useState(null)
  const [isLoading, setIsLoading]                 = useState(true)
  const [error, setError]                         = useState(null)
  const [showCompare, setShowCompare]             = useState(false)
  const [heroDetail, setHeroDetail]               = useState(null)
  const [blockedSessions, setBlockedSessions]     = useState(null)

  useEffect(() => {
    if (!showCompare) return
    const handleKey = (e) => { if (e.key === 'Escape') setShowCompare(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showCompare])

  const loadScenarios = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await rpeService.getScenarios()
      setAllScenarios(data)
    } catch (err) {
      setError(err.message || "We couldn't load the scenarios right now.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadScenarios()
  }, [])

  // Only ever auto-run once the grid has actually rendered (so the last
  // step's target exists) and only for a browser that hasn't seen it before.
  const [runTour, stopTour] = useOnceTour({
    storagePrefix: TOUR_SEEN_KEY,
    email: user?.email,
    ready: !isLoading && !planImporting,
  })

  const handleTourCallback = (data) => {
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(data.status)) {
      stopTour()
    }
  }

  // ?planId=<id> entry point from StartRolePlayButton on the Training Plan
  // detail page — generates a scenario from that plan, then previews it in
  // the same detail modal every other scenario gets before you commit to it,
  // instead of dropping you straight into a live session with no preview.
  useEffect(() => {
    if (!planId || authLoading) return
    if (!isAuthenticated) {
      setPlanImporting(false)
      setPlanError('Sign in to start a role-play from your training plan.')
      return
    }

    let cancelled = false
    const run = async () => {
      setPlanImporting(true)
      setPlanError(null)
      try {
        // Generates only — no session yet. The response is already a full
        // ScenarioDetail, so it goes straight into the same detail modal
        // every other scenario gets, avatar/name picker included; "Enter
        // Simulation" from there calls handleStart like any other scenario.
        const detail = await rpeService.generateFromPlan(planId)
        if (cancelled) return

        setSelectedScenario({ ...detail, is_generated: true })
        setPlanImporting(false)
        // Drop ?planId= so refreshing the page doesn't regenerate the scenario.
        navigate('/roleplay', { replace: true })
      } catch (err) {
        if (!cancelled) {
          setPlanError(err.message || "We couldn't create a scenario from this plan.")
          setPlanImporting(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [planId, isAuthenticated, authLoading, navigate])

  const generatedScenarios = useMemo(() => allScenarios.filter((s) => s.is_generated), [allScenarios])
  const libraryScenarios   = useMemo(() => allScenarios.filter((s) => !s.is_generated), [allScenarios])

  const sourceScenarios = useMemo(() => {
    if (activeSourceFilter === 'generated') return generatedScenarios
    if (activeSourceFilter === 'library') return libraryScenarios
    return allScenarios
  }, [activeSourceFilter, allScenarios, generatedScenarios, libraryScenarios])

  const filteredScenarios = useMemo(() => {
    let list = sourceScenarios
    if (activeDifficultyFilter) list = list.filter((s) => s.difficulty === activeDifficultyFilter)
    if (activeCategoryFilter) list = list.filter((s) => s.category === activeCategoryFilter)
    return list
  }, [sourceScenarios, activeDifficultyFilter, activeCategoryFilter])

  const isFiltered = activeSourceFilter !== 'all' || !!activeDifficultyFilter || !!activeCategoryFilter

  // The hero card only exists for a user who actually has a personalized
  // scenario — no generic/first-scenario fallback. A user with none just
  // sees the "Get a Personalized Scenario" button and the regular grid.
  const heroScenario = generatedScenarios[0] ?? null

  useEffect(() => {
    if (!heroScenario) { setHeroDetail(null); return }
    let cancelled = false
    rpeService.getScenarioDetail(heroScenario.scenario_id)
      .then((detail) => { if (!cancelled) setHeroDetail(detail) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [heroScenario?.scenario_id])

  // The hero card above already shows heroScenario in full — don't repeat it
  // in the grid below (personalized scenarios sit in that same grid now,
  // flagged with their own badge; the "Personalized" source tab still isolates
  // them if you want just those).
  const gridScenarios = useMemo(
    () => filteredScenarios.filter((s) => s.scenario_id !== heroScenario?.scenario_id),
    [filteredScenarios, heroScenario]
  )

  const handleDifficultyFilter = (level) => {
    setActiveDifficultyFilter((prev) => (prev === level ? null : level))
  }

  const handleCategoryFilter = (category) => {
    setActiveCategoryFilter((prev) => (prev === category ? null : category))
  }

  const clearAllFilters = () => {
    setActiveSourceFilter('all')
    setActiveDifficultyFilter(null)
    setActiveCategoryFilter(null)
  }

  const handleViewDetail = async (scenario) => {
    setSelectedScenario(scenario)
    try {
      const detail = await rpeService.getScenarioDetail(scenario.scenario_id)
      setSelectedScenario(detail)
    } catch {
      // keep summary-level data already set
    }
  }

  // customization is only present when starting from the detail modal's
  // avatar/name picker — a plain "Start" click straight off a scenario card
  // skips that screen entirely, so it stays undefined and everything falls
  // back to exactly the pre-existing default behaviour (random avatar pick,
  // scenario's own npc_role as the name).
  const handleStart = async (scenario, customization) => {
    setStartingId(scenario.scenario_id)
    setError(null)
    try {
      const response = await rpeService.startSession(
        scenario.scenario_id,
        isAuthenticated && user ? user.id : null,
        customization?.npcName
      )
      navigate(`/roleplay/session/${response.session_id}`, {
        state: {
          sessionId:                   response.session_id,
          openingNpcLine:              response.opening_npc_line,
          scenarioTitle:               response.scenario_title,
          difficulty:                  response.difficulty,
          conflictType:                response.conflict_type,
          category:                    scenario.category,
          // Real scenario text ("the real-life situation line", per
          // ScenarioSummary's own field comment) — the closest honest
          // source for "scenario objective" the backend exposes today. Set
          // once here, never overwritten per-turn — see
          // conversationIntelligenceV2.js's createInitialIntelligence.
          context:                     scenario.context,
          totalTurns:                  response.total_turns,
          npcRole:                     scenario.npc_role || scenario.conflict_type,
          npcGender:                   response.npc_gender,
          npcName:                     response.npc_name,
          avatarId:                    customization?.avatarId,
          failureEscalationThreshold:  response.failure_escalation_threshold,
        },
      })
    } catch (err) {
      if (err.code === 'active_session_limit') {
        setBlockedSessions(err.activeSessions)
        setSelectedScenario(null)
      } else {
        setError(err.message || 'Failed to start session')
      }
      setStartingId(null)
    }
  }

  const scenarioTitleFor = (scenarioId) =>
    allScenarios.find((s) => s.scenario_id === scenarioId)?.title || scenarioId

  if (planImporting) {
    return (
      <div className="rpe-cinema">
        <div className="plan-import-screen">
          <div className="plan-import-spinner" />
          <p className="plan-import-title">Building your scenario…</p>
          <p className="plan-import-sub">Generating a role-play from your training plan.</p>
        </div>
        <style>{`
          .rpe-cinema{ min-height:calc(100vh - 48px); background:#0D1117; color:#F0F6FC;
            font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif; }
          .plan-import-screen{ min-height:calc(100vh - 48px); display:flex; flex-direction:column;
            align-items:center; justify-content:center; gap:16px; text-align:center; padding:24px; }
          .plan-import-spinner{ width:36px; height:36px; border-radius:50%; border:2.5px solid #30363D;
            border-top-color:#4493F8; animation:planImportSpin .8s linear infinite; }
          @keyframes planImportSpin{ to{ transform:rotate(360deg); } }
          .plan-import-title{ font-size:16px; font-weight:700; margin:0; }
          .plan-import-sub{ font-size:13px; color:#8B949E; margin:0; }
          :root[data-theme="light"] .rpe-cinema{ background:#F5F3FD; color:#241E38; }
          :root[data-theme="light"] .plan-import-spinner{ border-color:#D9CFF5; border-top-color:#3D6FE0; }
          :root[data-theme="light"] .plan-import-sub{ color:#5E5678; }
        `}</style>
      </div>
    )
  }

  return (
    <div className="rpe-cinema">

      <Joyride
        steps={scenarioSelectTourSteps}
        run={runTour}
        continuous
        showSkipButton
        showProgress
        callback={handleTourCallback}
        options={joyrideOptions}
        styles={joyrideStyles}
      />

      {planError && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="banner danger">
            <AlertCircle size={16} strokeWidth={1.8} />
            <span style={{ flex: 1 }}>{planError}</span>
          </div>
        </div>
      )}

      <div className="hero-band">
        <div className="hero-inner">
          <div className="hero-row">
            <div data-tour="rpe-welcome">
              <p className="eyebrow">Practice Lab</p>
              <h1 className="hero-title">Practice Lab</h1>
              <p className="hero-sub">Practice real workplace conversations before they happen.</p>
            </div>
            <div className="hero-actions">
              <button type="button" onClick={() => navigate('/training-plan/new')} className="my-sessions-btn accent" data-tour="rpe-personalized-btn">
                <Sparkles size={13} strokeWidth={1.8} /> Get a Personalized Scenario
              </button>
              <button type="button" onClick={() => navigate('/roleplay/my-sessions')} className="my-sessions-btn">
                <History size={13} strokeWidth={1.8} /> My Journey
              </button>
              {!isLoading && allScenarios.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCompare((v) => !v)}
                  className={cn('my-sessions-btn', showCompare && 'active')}
                  aria-expanded={showCompare}
                  data-tour="rpe-compare-btn"
                >
                  <BarChart2 size={13} strokeWidth={1.8} /> Compare All Scenarios
                </button>
              )}
              <span className="pill neutral">{allScenarios.length} scenarios</span>
            </div>
          </div>
        </div>
      </div>

      <div className="page">

        {!authLoading && !isAuthenticated && (
          <div className="banner warning">
            You are browsing as a guest.{' '}
            <a href="/signin" className="banner-link">Sign in</a>{' '}
            to save your session history.
          </div>
        )}

        {!isLoading && heroScenario && (
          <div className="challenge-card">
            <div className="challenge-main">
              <div className="challenge-badge">
                <Sparkles size={11} strokeWidth={2} /> Personalized for you
              </div>

              <h2 className="challenge-title">{heroScenario.title}</h2>

              <p className="challenge-situation">
                {heroDetail?.context ?? heroScenario.context ?? 'Loading the situation…'}
              </p>
              <button type="button" className="challenge-more" onClick={() => handleViewDetail(heroDetail ?? heroScenario)}>
                Read more
              </button>

              <div className="challenge-facts">
                <div className="challenge-fact">
                  <span className="fact-label">Your role</span>
                  <span className="fact-val">You, the employee in this conversation</span>
                </div>
                <div className="challenge-fact">
                  <span className="fact-label">Their role</span>
                  <span className="fact-val">{heroDetail?.npc_role ?? '…'}</span>
                </div>
                <div className="challenge-fact">
                  <span className="fact-label">Objective</span>
                  <span className="fact-val">Build trust and keep tension under control until the situation resolves</span>
                </div>
              </div>

              {(heroDetail?.target_skills?.length ?? 0) > 0 && (
                <div className="challenge-skills">
                  {heroDetail.target_skills.slice(0, 3).map((s) => (
                    <span key={s} className="skill-chip">{s.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              )}

              <div className="challenge-meta">
                <span className={cn('diff-badge', DIFFICULTY_TONE[heroScenario.difficulty] ?? 'neutral')}>
                  <span className="dot" />{heroScenario.difficulty}
                </span>
                <span className="challenge-time">
                  <Clock size={12} strokeWidth={1.8} /> ~{Math.round((heroScenario.recommended_turns ?? heroScenario.turns ?? 6) * 1.5)} min
                </span>
              </div>
            </div>

            <div className="challenge-side">
              <button
                type="button"
                onClick={() => handleStart(heroDetail ?? heroScenario)}
                disabled={startingId === heroScenario.scenario_id}
                className="challenge-cta"
              >
                <Zap size={16} strokeWidth={2} />
                {startingId === heroScenario.scenario_id ? 'Starting…' : 'Start Simulation'}
              </button>
            </div>
          </div>
        )}

        {generatedScenarios.length > 0 && (
          <div className="seg-control source-seg">
            <button
              type="button"
              className={cn('seg-btn', activeSourceFilter === 'all' && 'active')}
              onClick={() => setActiveSourceFilter('all')}
            >
              All <span className="seg-count">{allScenarios.length}</span>
            </button>
            <button
              type="button"
              className={cn('seg-btn', 'seg-btn-accent', activeSourceFilter === 'generated' && 'active')}
              onClick={() => setActiveSourceFilter('generated')}
            >
              <Sparkles size={12} strokeWidth={2} /> Personalized <span className="seg-count">{generatedScenarios.length}</span>
            </button>
            <button
              type="button"
              className={cn('seg-btn', activeSourceFilter === 'library' && 'active')}
              onClick={() => setActiveSourceFilter('library')}
            >
              Library <span className="seg-count">{libraryScenarios.length}</span>
            </button>
          </div>
        )}

        <div className="category-block" data-tour="rpe-categories">
          <p className="category-prompt">What do you want to practice?</p>
          <div className="category-row">
            {CATEGORIES.map((category) => {
              const count = allScenarios.filter((s) => s.category === category).length
              if (count === 0) return null
              return (
                <button
                  key={category}
                  type="button"
                  className={cn('chip', activeCategoryFilter === category && 'active')}
                  onClick={() => handleCategoryFilter(category)}
                >
                  {category} <span className="chip-count">{count}</span>
                </button>
              )
            })}

            {DIFFICULTIES.some((d) => allScenarios.some((s) => s.difficulty === d)) && (
              <span className="chip-divider" />
            )}

            {DIFFICULTIES.map((d) => {
              const count = allScenarios.filter((s) => s.difficulty === d).length
              if (count === 0) return null
              return (
                <button
                  key={d}
                  type="button"
                  className={cn('chip', activeDifficultyFilter === d && 'active')}
                  onClick={() => handleDifficultyFilter(d)}
                >
                  {d.charAt(0).toUpperCase() + d.slice(1)} <span className="chip-count">{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        {showCompare && (
          <div className="cmp-modal-backdrop" onClick={() => setShowCompare(false)}>
            <div className="cmp-modal" onClick={(e) => e.stopPropagation()}>
              <div className="cmp-modal-header">
                <h2 className="cmp-modal-title">Compare all scenarios</h2>
                <button type="button" onClick={() => setShowCompare(false)} className="cmp-modal-close" aria-label="Close">
                  <X size={16} strokeWidth={1.8} />
                </button>
              </div>
              <div className="cmp-modal-body">
                <div className="compare-table-wrap">
                  <table className="compare-table">
                    <thead>
                      <tr>
                        {['Scenario', 'Difficulty', 'Category', 'Skills Practiced', 'Exchanges'].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allScenarios.map((s) => (
                        <tr key={s.scenario_id}>
                          <td className="cmp-title">{s.title}</td>
                          <td><span className={cn('diff-badge', DIFFICULTY_TONE[s.difficulty] ?? 'neutral')}><span className="dot" />{s.difficulty}</span></td>
                          <td>{s.category}</td>
                          <td className="cmp-skills">
                            {(s.target_skills ?? []).length > 0
                              ? s.target_skills.map((sk) => sk.replace(/_/g, ' ')).join(', ')
                              : '—'}
                          </td>
                          <td className="cmp-num">~{s.turns}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {isFiltered && !isLoading && (
          <div className="active-filters">
            <span className="filter-summary">
              Showing {filteredScenarios.length} of {allScenarios.length} scenarios
            </span>
            {activeSourceFilter !== 'all' && (
              <button type="button" onClick={() => setActiveSourceFilter('all')} className="pill accent clickable">
                {activeSourceFilter === 'generated' ? 'Personalized' : 'Library'} ×
              </button>
            )}
            {activeDifficultyFilter && (
              <button type="button" onClick={() => handleDifficultyFilter(activeDifficultyFilter)} className="pill accent clickable">
                Difficulty: {activeDifficultyFilter} ×
              </button>
            )}
            {activeCategoryFilter && (
              <button type="button" onClick={() => handleCategoryFilter(activeCategoryFilter)} className="pill accent clickable">
                {activeCategoryFilter} ×
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="banner danger">
            <AlertCircle size={16} strokeWidth={1.8} />
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" onClick={loadScenarios} className="retry-btn">
              <RefreshCw size={12} strokeWidth={1.8} /> Retry
            </button>
          </div>
        )}

        {isLoading && (
          <div className="grid-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="skel-card">
                <div className="skel" style={{ height: 16, width: '75%', marginBottom: 12 }} />
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <div className="skel" style={{ height: 18, width: 80, borderRadius: 999 }} />
                  <div className="skel" style={{ height: 18, width: 64, borderRadius: 999 }} />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  <div className="skel" style={{ height: 18, width: 64, borderRadius: 999 }} />
                  <div className="skel" style={{ height: 18, width: 80, borderRadius: 999 }} />
                </div>
                <div className="skel" style={{ height: 36, width: '100%', borderRadius: 8 }} />
              </div>
            ))}
          </div>
        )}

        {!isLoading && (
          <div className="grid-3" data-tour="rpe-scenario-grid">
            {gridScenarios.length === 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                {activeSourceFilter === 'generated' && generatedScenarios.length > 0 ? (
                  // Your only personalized scenario(s) are already the hero
                  // card above (gridScenarios always excludes it) — this
                  // isn't "you have none", so don't show that empty state.
                  <div className="empty-state">
                    <Sparkles size={28} strokeWidth={1.6} />
                    <p className="empty-desc">Your personalized scenario is shown above.</p>
                  </div>
                ) : activeSourceFilter === 'generated' ? (
                  <div className="empty-state">
                    <Sparkles size={28} strokeWidth={1.6} />
                    <p className="empty-title">No personalized scenarios yet</p>
                    <p className="empty-desc">Generate one from your training plan to get a scenario tailored to your goals.</p>
                    <button type="button" onClick={() => navigate('/training-plan')} className="btn-c secondary">Go to Training Plan</button>
                  </div>
                ) : (
                  <div className="empty-state">
                    <Brain size={28} strokeWidth={1.6} />
                    <p className="empty-title">No scenarios match this filter</p>
                    <p className="empty-desc">Remove a filter or two to see more scenarios.</p>
                    <button type="button" onClick={clearAllFilters} className="btn-c secondary">Clear filters</button>
                  </div>
                )}
              </div>
            ) : (
              gridScenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.scenario_id}
                  scenario={scenario}
                  onStart={handleStart}
                  onViewDetail={handleViewDetail}
                  isStarting={startingId === scenario.scenario_id}
                />
              ))
            )}
          </div>
        )}

      </div>

      <ScenarioDetailModal
        scenario={selectedScenario}
        onClose={() => setSelectedScenario(null)}
        onStart={handleStart}
        isStarting={startingId === selectedScenario?.scenario_id}
      />

      <ActiveSessionLimitModal
        sessions={blockedSessions}
        scenarioTitle={scenarioTitleFor}
        onClose={() => setBlockedSessions(null)}
      />

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
          background:var(--bg);
          color:var(--text-hi);
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .rpe-cinema button, .rpe-cinema select{ font-family:inherit; }
        .rpe-cinema .cap{ text-transform:capitalize; }

        .rpe-cinema .hero-band{
          border-bottom:1px solid var(--border);
          background:radial-gradient(120% 140% at 0% 0%, rgba(124,58,237,0.08) 0%, transparent 55%), var(--surface);
        }
        .rpe-cinema .hero-inner{ max-width:1600px; margin:0 auto; padding:40px 20px 32px; }
        .rpe-cinema .hero-row{ display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
        .rpe-cinema .hero-actions{ display:flex; align-items:center; gap:10px; }
        .rpe-cinema .my-sessions-btn{
          display:inline-flex; align-items:center; gap:6px; background:var(--surface-hi); border:1px solid var(--border);
          color:var(--text-hi); font-size:12px; font-weight:650; padding:8px 14px; border-radius:9px; cursor:pointer;
          transition:border-color .2s var(--ease), background .2s var(--ease);
        }
        .rpe-cinema .my-sessions-btn:hover{ border-color:var(--primary); background:var(--primary-glow); }
        .rpe-cinema .my-sessions-btn.accent{ background:linear-gradient(135deg, var(--accent), #9B6BFF); border-color:transparent; color:#fff; }
        .rpe-cinema .my-sessions-btn.accent:hover{ filter:brightness(1.08); border-color:transparent; background:linear-gradient(135deg, var(--accent), #9B6BFF); }
        .rpe-cinema .my-sessions-btn.active{ border-color:var(--primary); background:var(--primary-glow); color:var(--primary); }
        .rpe-cinema .eyebrow{ font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--primary); margin:0 0 8px; }
        .rpe-cinema .hero-title{ font-size:28px; font-weight:800; letter-spacing:-0.01em; margin:0; }
        .rpe-cinema .hero-sub{ font-size:13.5px; color:var(--text-med); margin:8px 0 0; }

        .rpe-cinema .page{ max-width:1600px; margin:0 auto; padding:28px 20px 64px; display:flex; flex-direction:column; gap:20px; }

        .rpe-cinema .pill{
          display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:650;
          padding:5px 12px; border-radius:100px; border:1px solid transparent; white-space:nowrap;
        }
        .rpe-cinema .pill.accent{  color:var(--accent);  background:var(--accent-glow);  border-color:rgba(124,58,237,0.3); text-transform:capitalize; }
        .rpe-cinema .pill.neutral{ color:var(--text-med); background:var(--surface-hi); border-color:var(--border); }
        .rpe-cinema .pill.clickable{ cursor:pointer; }
        .rpe-cinema .pill.clickable:hover{ filter:brightness(1.25); }

        /* Difficulty is the one place semantic color earns its keep — kept
           muted (neutral chip background, colored dot) rather than a bright
           filled pill, so it doesn't compete with the purple accent. */
        .rpe-cinema .diff-badge{
          display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:650;
          padding:3px 10px; border-radius:100px; text-transform:capitalize; flex-shrink:0; white-space:nowrap;
          background:var(--surface-hi); border:1px solid var(--border); color:var(--text-hi);
        }
        .rpe-cinema .diff-badge .dot{ width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .rpe-cinema .diff-badge.success .dot{ background:var(--success); }
        .rpe-cinema .diff-badge.warning .dot{ background:var(--warning); }
        .rpe-cinema .diff-badge.danger  .dot{ background:var(--danger); }
        .rpe-cinema .diff-badge.neutral .dot{ background:var(--text-low); }

        .rpe-cinema .banner{
          display:flex; align-items:center; gap:10px; border-radius:12px; padding:12px 16px; font-size:13px; border:1px solid transparent;
        }
        .rpe-cinema .banner.warning{ background:var(--warning-glow); border-color:rgba(210,153,34,0.3); color:#E3B341; }
        .rpe-cinema .banner.danger{ background:var(--danger-glow); border-color:rgba(248,81,73,0.3); color:#FF9490; }
        .rpe-cinema .banner-link{ color:inherit; font-weight:700; text-decoration:underline; }

        .rpe-cinema .seg-control{ display:inline-flex; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:3px; gap:2px; }
        .rpe-cinema .seg-btn{
          background:transparent; border:none; cursor:pointer; color:var(--text-med);
          font-size:12.5px; font-weight:600; padding:7px 14px; border-radius:8px; transition:all .2s var(--ease);
        }
        .rpe-cinema .seg-btn:hover{ color:var(--text-hi); }
        .rpe-cinema .seg-btn.active{ background:var(--primary); color:#fff; }

        .rpe-cinema .source-seg{ padding:4px; gap:3px; }
        .rpe-cinema .source-seg .seg-btn{ display:inline-flex; align-items:center; gap:6px; padding:8px 15px; }
        .rpe-cinema .source-seg .seg-btn-accent.active{ background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff; }
        .rpe-cinema .source-seg .seg-btn-accent:not(.active){ color:var(--accent); }
        .rpe-cinema .seg-count{
          font-size:10.5px; font-weight:700; background:rgba(255,255,255,0.14);
          padding:1px 6px; border-radius:100px; font-variant-numeric:tabular-nums;
        }
        .rpe-cinema .source-seg .seg-btn:not(.active) .seg-count{ background:var(--surface-hi); color:var(--text-low); }

        .rpe-cinema .category-block{ display:flex; flex-direction:column; gap:10px; }
        .rpe-cinema .category-prompt{ font-size:13.5px; font-weight:650; color:var(--text-hi); margin:0; }
        .rpe-cinema .category-row{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .rpe-cinema .micro-label{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-low); flex-shrink:0; }
        .rpe-cinema .chip{
          display:inline-flex; align-items:center; gap:6px;
          background:var(--surface); border:1px solid var(--border); color:var(--text-med);
          font-size:12.5px; font-weight:600; padding:7px 14px; border-radius:100px; cursor:pointer;
          transition:all .2s var(--ease);
        }
        .rpe-cinema .chip:hover:not(:disabled){ border-color:var(--text-med); color:var(--text-hi); }
        .rpe-cinema .chip.active{ background:var(--primary-glow); border-color:rgba(68,147,248,0.5); color:var(--primary); }
        .rpe-cinema .chip:disabled{ opacity:.4; cursor:default; }
        .rpe-cinema .chip-count{
          font-size:10px; font-weight:700; background:var(--surface-hi); color:var(--text-low);
          padding:1px 6px; border-radius:100px; font-variant-numeric:tabular-nums;
        }
        .rpe-cinema .chip.active .chip-count{ background:rgba(68,147,248,0.2); color:var(--primary); }
        .rpe-cinema .chip-divider{ width:1px; align-self:stretch; background:var(--border); margin:0 2px; }

        .rpe-cinema .challenge-card{
          position:relative; background:linear-gradient(160deg, rgba(124,58,237,0.1), var(--surface) 60%);
          border:1px solid rgba(124,58,237,0.3); border-radius:20px; padding:28px 30px;
          display:flex; align-items:center; gap:28px; overflow:hidden;
        }
        @media (max-width:760px){ .rpe-cinema .challenge-card{ flex-direction:column; align-items:stretch; } }
        .rpe-cinema .challenge-card::before{
          content:""; position:absolute; top:-40%; right:-10%; width:280px; height:280px; border-radius:50%;
          background:radial-gradient(circle, rgba(124,58,237,0.18), transparent 70%); pointer-events:none;
        }
        .rpe-cinema .challenge-main{ flex:1; min-width:0; display:flex; flex-direction:column; gap:14px; }
        .rpe-cinema .challenge-side{ flex-shrink:0; display:flex; }
        @media (max-width:760px){ .rpe-cinema .challenge-side{ justify-content:stretch; } .rpe-cinema .challenge-side .challenge-cta{ width:100%; justify-content:center; } }

        .rpe-cinema .challenge-badge{
          display:inline-flex; align-items:center; gap:6px; align-self:flex-start;
          font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
          color:var(--accent); background:var(--accent-glow); border:1px solid rgba(124,58,237,0.35);
          padding:5px 12px; border-radius:100px;
        }
        .rpe-cinema .challenge-title{ font-size:22px; font-weight:800; letter-spacing:-0.01em; margin:0; }
        .rpe-cinema .challenge-situation{
          font-size:14px; line-height:1.6; color:var(--text-med); margin:0; max-width:640px;
          display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
        }
        .rpe-cinema .challenge-more{
          align-self:flex-start; background:none; border:none; cursor:pointer; padding:0; margin-top:-8px;
          color:var(--accent); font-size:12.5px; font-weight:650;
        }
        .rpe-cinema .challenge-more:hover{ text-decoration:underline; }

        .rpe-cinema .challenge-facts{ display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-top:6px; }
        @media (max-width:760px){ .rpe-cinema .challenge-facts{ grid-template-columns:1fr; } }
        .rpe-cinema .challenge-fact{ display:flex; flex-direction:column; gap:4px; }
        .rpe-cinema .fact-label{ font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-low); }
        .rpe-cinema .fact-val{ font-size:13px; color:var(--text-hi); font-weight:600; }

        .rpe-cinema .challenge-skills{ display:flex; flex-wrap:wrap; gap:6px; }
        .rpe-cinema .skill-chip{
          font-size:11px; font-weight:600; color:var(--text-med); background:var(--surface-hi);
          border:1px solid var(--border); padding:3px 10px; border-radius:100px; text-transform:capitalize;
        }

        .rpe-cinema .challenge-meta{ display:flex; align-items:center; gap:12px; margin-top:4px; }
        .rpe-cinema .challenge-time{ display:inline-flex; align-items:center; gap:5px; font-size:12.5px; color:var(--text-med); font-weight:600; }

        .rpe-cinema .challenge-cta{
          display:inline-flex; align-items:center; gap:8px;
          border:none; cursor:pointer; background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff;
          font-size:14px; font-weight:700; padding:14px 26px; border-radius:12px; white-space:nowrap;
          box-shadow:0 10px 28px rgba(124,58,237,0.35); transition:filter .2s var(--ease), transform .2s var(--ease);
        }
        .rpe-cinema .challenge-cta:hover:not(:disabled){ filter:brightness(1.08); transform:translateY(-1px); }
        .rpe-cinema .challenge-cta:disabled{ opacity:.6; cursor:default; }

        .rpe-cinema .active-filters{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .rpe-cinema .filter-summary{ font-size:12px; color:var(--text-med); }

        .rpe-cinema .retry-btn{
          display:inline-flex; align-items:center; gap:5px; background:none; border:1px solid rgba(248,81,73,0.35);
          color:inherit; font-size:11.5px; font-weight:650; padding:6px 12px; border-radius:8px; cursor:pointer; flex-shrink:0;
        }
        .rpe-cinema .retry-btn:hover{ background:rgba(248,81,73,0.15); }

        .rpe-cinema .grid-3{ display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; }
        @media (min-width:1440px){ .rpe-cinema .grid-3{ grid-template-columns:repeat(4, 1fr); } }
        @media (max-width:980px){ .rpe-cinema .grid-3{ grid-template-columns:repeat(2, 1fr); } }
        @media (max-width:640px){ .rpe-cinema .grid-3{ grid-template-columns:1fr; } }

        .rpe-cinema .skel-card{ background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px; }
        .rpe-cinema .skel{ background:linear-gradient(90deg, var(--surface-hi) 25%, var(--border) 50%, var(--surface-hi) 75%); background-size:200% 100%; border-radius:6px; animation:cinemaShimmer 1.4s ease-in-out infinite; }
        @keyframes cinemaShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

        .rpe-cinema .empty-state{
          display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
          background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:48px 24px; color:var(--text-med);
        }
        .rpe-cinema .empty-title{ font-size:15px; font-weight:700; color:var(--text-hi); margin:6px 0 0; }
        .rpe-cinema .empty-desc{ font-size:13px; margin:0 0 10px; max-width:340px; }

        .rpe-cinema .btn-c{
          display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650;
          padding:9px 16px; border-radius:10px; cursor:pointer; border:1px solid transparent;
          transition:filter .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease);
        }
        .rpe-cinema .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
        .rpe-cinema .btn-c.secondary:hover{ border-color:var(--text-med); }

        .rpe-cinema .cmp-modal-backdrop{
          position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; padding:16px;
          background:var(--cmp-modal-backdrop, rgba(6,8,12,0.72)); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        }
        :root[data-theme="light"] .rpe-cinema .cmp-modal-backdrop{ --cmp-modal-backdrop: rgba(36,30,56,0.35); }
        .rpe-cinema .cmp-modal{
          background:var(--surface); border:1px solid var(--border); border-radius:16px;
          max-width:920px; width:100%; max-height:85vh; overflow-y:auto;
          box-shadow:0 30px 70px rgba(0,0,0,0.5);
          opacity:0; transform:translateY(16px) scale(0.98);
          animation: rpeCmpModalIn .25s cubic-bezier(0.22,1,0.36,1) forwards;
        }
        @keyframes rpeCmpModalIn{ to{ opacity:1; transform:none; } }
        .rpe-cinema .cmp-modal-header{
          position:sticky; top:0; z-index:1; background:var(--surface); border-bottom:1px solid var(--border);
          padding:18px 24px; display:flex; align-items:center; justify-content:space-between; gap:12px;
          border-radius:16px 16px 0 0;
        }
        .rpe-cinema .cmp-modal-title{ font-size:16px; font-weight:750; margin:0; color:var(--text-hi); }
        .rpe-cinema .cmp-modal-close{
          flex-shrink:0; background:none; border:none; cursor:pointer; color:var(--text-med);
          padding:6px; border-radius:8px; display:flex; transition:background .2s ease, color .2s ease;
        }
        .rpe-cinema .cmp-modal-close:hover{ background:var(--surface-hi); color:var(--text-hi); }
        .rpe-cinema .cmp-modal-body{ padding:8px; }
        .rpe-cinema .compare-table-wrap{ overflow-x:auto; }
        .rpe-cinema .compare-table{ width:100%; font-size:12px; text-align:left; border-collapse:collapse; }
        .rpe-cinema .compare-table thead{ background:var(--surface-hi); }
        .rpe-cinema .compare-table th{
          padding:12px 16px; color:var(--text-low); font-weight:700; text-transform:uppercase; letter-spacing:.08em; font-size:10px; white-space:nowrap;
        }
        .rpe-cinema .compare-table td{ padding:10px 16px; border-top:1px solid var(--border); color:var(--text-med); }
        .rpe-cinema .cmp-title{ color:var(--text-hi); font-weight:600; white-space:nowrap; }
        .rpe-cinema .cmp-num{ font-variant-numeric:tabular-nums; }
        .rpe-cinema .cmp-skills{ text-transform:capitalize; min-width:220px; }

        /* Light theme — this page defines its own dark "cinema" palette
           above instead of reading the app's shared tokens, so it needs its
           own override block rather than picking up index.css's
           data-theme="light" automatically. Same variable names, light
           values, drawn from the app's lavender secondary ramp. */
        :root[data-theme="light"] .rpe-cinema{
          --bg:            #F5F3FD;
          --surface:       #FFFFFF;
          --surface-hi:    #EFEAFB;
          --border:        #D9CFF5;
          --primary:       #3D6FE0;
          --primary-glow:  rgba(61,111,224,0.10);
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
        }
        :root[data-theme="light"] .rpe-cinema .banner.warning{ color:#8A5A00; }
        :root[data-theme="light"] .rpe-cinema .banner.danger{ color:#B42318; }
      `}</style>
    </div>
  )
}
