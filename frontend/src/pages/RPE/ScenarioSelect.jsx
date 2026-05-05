import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, RefreshCw, Sparkles, ChevronDown, ChevronUp, Brain } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import ScenarioCard from '@/components/RPE/ScenarioCard'
import ScenarioDetailModal from '@/components/RPE/ScenarioDetailModal'
import { cn } from '@/lib/utils'

const DIFFICULTY_FILTERS = ['all', 'beginner', 'intermediate', 'advanced']

const DIFFICULTY_COLORS = {
  beginner:     'bg-emerald-100 text-emerald-700',
  intermediate: 'bg-amber-100 text-amber-700',
  advanced:     'bg-red-100 text-red-700',
}

const MAX_SKILL_PILLS = 8

export default function ScenarioSelect() {
  const navigate = useNavigate()

  const [allScenarios, setAllScenarios]           = useState([])
  const [filteredScenarios, setFilteredScenarios] = useState([])
  const [recommendedOrder, setRecommendedOrder]   = useState([])
  const [activeFilter, setActiveFilter]           = useState('all')
  const [activeSkillFilter, setActiveSkillFilter] = useState(null)
  const [activeSortMode, setActiveSortMode]       = useState('default')
  const [selectedScenario, setSelectedScenario]   = useState(null)
  const [startingId, setStartingId]               = useState(null)
  const [isLoading, setIsLoading]                 = useState(true)
  const [error, setError]                         = useState(null)
  const [showCompare, setShowCompare]             = useState(false)
  const [showAllSkills, setShowAllSkills]         = useState(false)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const [data, recs] = await Promise.all([
          rpeService.getScenarios(),
          rpeService.getApaRecommendations('guest_user').catch(() => []),
        ])
        setAllScenarios(data)
        setFilteredScenarios(data)
        setRecommendedOrder(recs.map((s) => s.scenario_id))
      } catch (err) {
        setError(err.message || 'Failed to load scenarios')
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const allSkills = useMemo(() => {
    const set = new Set()
    allScenarios.forEach((s) => {
      const skills = s.target_skills ?? s.apa_metadata?.target_skills ?? []
      skills.forEach((sk) => set.add(sk))
    })
    return [...set]
  }, [allScenarios])

  const visibleSkills = showAllSkills ? allSkills : allSkills.slice(0, MAX_SKILL_PILLS)

  const applySortMode = (list, mode) => {
    if (mode === 'difficulty') {
      return [...list].sort((a, b) => {
        const wa = a.difficulty_weight ?? a.apa_metadata?.difficulty_weight ?? 1.0
        const wb = b.difficulty_weight ?? b.apa_metadata?.difficulty_weight ?? 1.0
        return wa - wb
      })
    }
    if (mode === 'recommended' && recommendedOrder.length > 0) {
      return [...list].sort((a, b) => {
        const ia = recommendedOrder.indexOf(a.scenario_id)
        const ib = recommendedOrder.indexOf(b.scenario_id)
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      })
    }
    return list
  }

  const displayedScenarios = useMemo(
    () => applySortMode(filteredScenarios, activeSortMode),
    [filteredScenarios, activeSortMode, recommendedOrder]
  )

  const handleDifficultyFilter = async (level) => {
    setActiveFilter(level)
    setActiveSkillFilter(null)
    setError(null)
    setIsLoading(true)
    try {
      const data = level === 'all'
        ? await rpeService.getScenarios()
        : await rpeService.getScenariosByDifficulty(level)
      setFilteredScenarios(data)
    } catch (err) {
      setError(err.message || 'Failed to filter scenarios')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSkillFilter = async (skill) => {
    if (activeSkillFilter === skill) {
      setActiveSkillFilter(null)
      setActiveFilter('all')
      setFilteredScenarios(allScenarios)
      return
    }
    setActiveSkillFilter(skill)
    setActiveFilter('all')
    setError(null)
    setIsLoading(true)
    try {
      const data = await rpeService.getScenariosBySkill(skill)
      setFilteredScenarios(data)
    } catch (err) {
      setError(err.message || 'Failed to filter by skill')
    } finally {
      setIsLoading(false)
    }
  }

  const clearAllFilters = () => {
    setActiveFilter('all')
    setActiveSkillFilter(null)
    setFilteredScenarios(allScenarios)
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

  const handleStart = async (scenario) => {
    setStartingId(scenario.scenario_id)
    setError(null)
    try {
      const response = await rpeService.startSession(scenario.scenario_id, 'guest_user')
      navigate('/roleplay/session', {
        state: {
          sessionId:                   response.session_id,
          openingNpcLine:              response.opening_npc_line,
          scenarioTitle:               response.scenario_title,
          difficulty:                  response.difficulty,
          conflictType:                response.conflict_type,
          totalTurns:                  response.total_turns,
          npcRole:                     scenario.npc_role || scenario.conflict_type,
          failureEscalationThreshold:  scenario.end_conditions?.failure_escalation_threshold,
        },
      })
    } catch (err) {
      setError(err.message || 'Failed to start session')
      setStartingId(null)
    }
  }

  const isFiltered = activeFilter !== 'all' || !!activeSkillFilter

  return (
    <div className="min-h-screen bg-background">

      {/* Hero header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                <Brain className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Role-Play Scenarios</h1>
                <p className="mt-1 text-muted-foreground text-sm">
                  Practice workplace soft skills with AI-powered simulations
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-border bg-muted text-muted-foreground text-xs px-3 py-1.5 font-medium self-center tabular-nums">
              {allScenarios.length} scenarios
            </span>
          </div>

          {/* APA coming soon pill */}
          <div className="mt-4 flex items-center gap-2 px-3 py-1.5 bg-primary/8 border border-primary/20 rounded-full w-fit text-xs text-primary">
            <Sparkles size={11} className="text-primary/70 shrink-0" />
            <span className="font-medium">Personalised ordering coming soon</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">

        {/* Filter + sort bar */}
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex gap-2 flex-wrap">
            {DIFFICULTY_FILTERS.map((d) => (
              <button
                key={d}
                onClick={() => handleDifficultyFilter(d)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-semibold transition-all capitalize',
                  activeFilter === d && !activeSkillFilter
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
              >
                {d === 'all' ? 'All' : d}
              </button>
            ))}
          </div>

          <select
            value={activeSortMode}
            onChange={(e) => setActiveSortMode(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="default">Sort: Default</option>
            <option value="difficulty">Sort: By Difficulty</option>
            <option value="recommended">Sort: Recommended</option>
          </select>
        </div>

        {/* Skill filter row */}
        {allSkills.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">
              Filter by skill:
            </span>
            {visibleSkills.map((skill) => (
              <button
                key={skill}
                onClick={() => handleSkillFilter(skill)}
                className={cn(
                  'text-xs rounded-full px-3 py-1 transition-all capitalize font-medium',
                  activeSkillFilter === skill
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
              >
                {skill.replace(/_/g, ' ')}
              </button>
            ))}
            {allSkills.length > MAX_SKILL_PILLS && (
              <button
                onClick={() => setShowAllSkills((v) => !v)}
                className="text-xs text-primary hover:underline font-medium"
              >
                {showAllSkills ? 'Less' : `+${allSkills.length - MAX_SKILL_PILLS} more`}
              </button>
            )}
          </div>
        )}

        {/* Active filter summary */}
        {isFiltered && !isLoading && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            <span>Showing {displayedScenarios.length} of {allScenarios.length} scenarios</span>
            {activeFilter !== 'all' && (
              <span
                onClick={() => handleDifficultyFilter('all')}
                className="cursor-pointer rounded-full bg-accent text-accent-foreground px-2.5 py-0.5 hover:bg-accent/80 capitalize font-medium"
              >
                Difficulty: {activeFilter} ×
              </span>
            )}
            {activeSkillFilter && (
              <span
                onClick={() => handleSkillFilter(activeSkillFilter)}
                className="cursor-pointer rounded-full bg-accent text-accent-foreground px-2.5 py-0.5 hover:bg-accent/80 capitalize font-medium"
              >
                Skill: {activeSkillFilter.replace(/_/g, ' ')} ×
              </span>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-destructive">
            <AlertCircle size={16} className="shrink-0" />
            <span className="text-sm flex-1">{error}</span>
            <button
              onClick={() => handleDifficultyFilter(activeFilter)}
              className="flex items-center gap-1 text-sm font-semibold underline hover:no-underline"
            >
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}

        {/* Skeleton loading */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                <div className="h-1 bg-muted" />
                <div className="p-5 space-y-3">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="flex gap-2">
                    <div className="h-5 bg-muted rounded-full w-20" />
                    <div className="h-5 bg-muted rounded-full w-16" />
                  </div>
                  <div className="flex gap-1">
                    <div className="h-5 bg-accent/40 rounded-full w-16" />
                    <div className="h-5 bg-accent/40 rounded-full w-20" />
                  </div>
                  <div className="h-9 bg-muted rounded-lg w-full mt-2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Scenario grid */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedScenarios.length === 0 ? (
              <div className="col-span-3 text-center py-20">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
                  <Brain className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground text-sm mb-3">No scenarios match this filter</p>
                <button
                  onClick={clearAllFilters}
                  className="text-sm text-primary underline hover:no-underline font-medium"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              displayedScenarios.map((scenario) => (
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

        {/* Difficulty comparison table */}
        {!isLoading && allScenarios.length > 0 && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <button
              onClick={() => setShowCompare((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
            >
              <span>Compare all scenarios</span>
              {showCompare ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
            </button>
            {showCompare && (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Scenario', 'Difficulty', 'Turns', 'Min Trust', 'NPC Exits At', 'NPC Softens At'].map((h) => (
                        <th key={h} className="px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {allScenarios.map((s) => {
                      const coop = s.npc_behaviour?.trust_thresholds?.cooperative
                        ?? s.apa_metadata?.npc_behaviour?.trust_thresholds?.cooperative
                        ?? '—'
                      const criteria = s.success_criteria ?? {}
                      return (
                        <tr key={s.scenario_id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 font-semibold text-foreground whitespace-nowrap">{s.title}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              'rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
                              DIFFICULTY_COLORS[s.difficulty] ?? 'bg-muted text-muted-foreground'
                            )}>
                              {s.difficulty}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{s.turns}</td>
                          <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{criteria.min_trust_score ?? '—'}</td>
                          <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                            {s.end_conditions?.failure_escalation_threshold != null
                              ? `${s.end_conditions.failure_escalation_threshold}/5`
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">trust ≥ {coop}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Detail modal */}
      <ScenarioDetailModal
        scenario={selectedScenario}
        onClose={() => setSelectedScenario(null)}
        onStart={handleStart}
        isStarting={startingId === selectedScenario?.scenario_id}
      />
    </div>
  )
}
