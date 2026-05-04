import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, RefreshCw, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import ScenarioCard from '@/components/RPE/ScenarioCard'
import ScenarioDetailModal from '@/components/RPE/ScenarioDetailModal'
import { cn } from '@/lib/utils'

const DIFFICULTY_FILTERS = ['all', 'beginner', 'intermediate', 'advanced']

const DIFFICULTY_COLORS = {
  beginner:     'bg-green-100 text-green-700',
  intermediate: 'bg-yellow-100 text-yellow-700',
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

  // ── initial load ──────────────────────────────────────────────────────────
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

  // ── unique skills across all scenarios ───────────────────────────────────
  const allSkills = useMemo(() => {
    const set = new Set()
    allScenarios.forEach((s) => {
      const skills = s.target_skills ?? s.apa_metadata?.target_skills ?? []
      skills.forEach((sk) => set.add(sk))
    })
    return [...set]
  }, [allScenarios])

  const visibleSkills = showAllSkills ? allSkills : allSkills.slice(0, MAX_SKILL_PILLS)

  // ── apply sort to a list ──────────────────────────────────────────────────
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

  // ── filters ───────────────────────────────────────────────────────────────
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
      // deselect — show all
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

  // ── detail modal ──────────────────────────────────────────────────────────
  const handleViewDetail = async (scenario) => {
    setSelectedScenario(scenario)
    try {
      const detail = await rpeService.getScenarioDetail(scenario.scenario_id)
      setSelectedScenario(detail)
    } catch {
      // keep the summary-level data already set
    }
  }

  // ── start session ─────────────────────────────────────────────────────────
  const handleStart = async (scenario) => {
    setStartingId(scenario.scenario_id)
    setError(null)
    try {
      const response = await rpeService.startSession(scenario.scenario_id, 'guest_user')
      navigate('/roleplay/session', {
        state: {
          sessionId:      response.session_id,
          openingNpcLine: response.opening_npc_line,
          scenarioTitle:  response.scenario_title,
          difficulty:     response.difficulty,
          conflictType:   response.conflict_type,
          totalTurns:     response.total_turns,
          npcRole:        scenario.npc_role || scenario.conflict_type,
        },
      })
    } catch (err) {
      setError(err.message || 'Failed to start session')
      setStartingId(null)
    }
  }

  const isFiltered = activeFilter !== 'all' || !!activeSkillFilter

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Role-Play Scenarios</h1>
            <p className="mt-1 text-gray-500 text-sm">
              Practice your workplace soft skills with AI-powered simulations
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-gray-100 text-gray-500 text-xs px-3 py-1.5 font-medium self-center">
            {allScenarios.length} scenarios available
          </span>
        </div>

        {/* APA banner — small pill */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 border border-purple-100 rounded-full w-fit text-xs text-purple-600 mb-0">
          <Sparkles size={12} className="text-purple-400 shrink-0" />
          <span>Personalised scenario ordering coming soon</span>
        </div>

        {/* Filter + sort bar */}
        <div className="flex flex-wrap items-center gap-3 justify-between">
          {/* Difficulty filter pills */}
          <div className="flex gap-2 flex-wrap">
            {DIFFICULTY_FILTERS.map((d) => (
              <button
                key={d}
                onClick={() => handleDifficultyFilter(d)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize',
                  activeFilter === d && !activeSkillFilter
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {d === 'all' ? 'All' : d}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <select
            value={activeSortMode}
            onChange={(e) => setActiveSortMode(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="default">Sort: Default</option>
            <option value="difficulty">Sort: By Difficulty</option>
            <option value="recommended">Sort: Recommended</option>
          </select>
        </div>

        {/* Skill filter row */}
        {allSkills.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 shrink-0">Filter by skill:</span>
            {visibleSkills.map((skill) => (
              <button
                key={skill}
                onClick={() => handleSkillFilter(skill)}
                className={cn(
                  'text-xs rounded-full px-3 py-1 transition-colors capitalize',
                  activeSkillFilter === skill
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                {skill.replace(/_/g, ' ')}
              </button>
            ))}
            {allSkills.length > MAX_SKILL_PILLS && (
              <button
                onClick={() => setShowAllSkills((v) => !v)}
                className="text-xs text-blue-500 hover:underline"
              >
                {showAllSkills ? 'Less' : `+${allSkills.length - MAX_SKILL_PILLS} more`}
              </button>
            )}
          </div>
        )}

        {/* Active filter summary */}
        {isFiltered && !isLoading && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
            <span>Showing {displayedScenarios.length} of {allScenarios.length} scenarios</span>
            {activeFilter !== 'all' && (
              <span
                onClick={() => handleDifficultyFilter('all')}
                className="cursor-pointer rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 hover:bg-blue-200 capitalize"
              >
                Difficulty: {activeFilter} ×
              </span>
            )}
            {activeSkillFilter && (
              <span
                onClick={() => handleSkillFilter(activeSkillFilter)}
                className="cursor-pointer rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 hover:bg-blue-200 capitalize"
              >
                Skill: {activeSkillFilter.replace(/_/g, ' ')} ×
              </span>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            <AlertCircle size={16} className="shrink-0" />
            <span className="text-sm flex-1">{error}</span>
            <button
              onClick={() => handleDifficultyFilter(activeFilter)}
              className="flex items-center gap-1 text-sm font-medium underline hover:no-underline"
            >
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}

        {/* Skeleton loading */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="flex gap-2">
                  <div className="h-5 bg-gray-100 rounded-full w-20" />
                  <div className="h-5 bg-gray-100 rounded-full w-16" />
                </div>
                <div className="flex gap-1">
                  <div className="h-4 bg-blue-50 rounded-full w-16" />
                  <div className="h-4 bg-blue-50 rounded-full w-20" />
                </div>
                <div className="h-9 bg-gray-100 rounded-lg w-full mt-2" />
              </div>
            ))}
          </div>
        )}

        {/* Scenario grid */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedScenarios.length === 0 ? (
              <div className="col-span-3 text-center py-16">
                <p className="text-gray-400 text-sm mb-3">No scenarios match this filter</p>
                <button
                  onClick={clearAllFilters}
                  className="text-sm text-blue-600 underline hover:no-underline"
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
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
              onClick={() => setShowCompare((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span>Compare all scenarios</span>
              {showCompare ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showCompare && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-50 text-gray-400 uppercase tracking-wide">
                    <tr>
                      {['Scenario','Difficulty','Turns','Min Trust','Max Escalation','NPC Softens At'].map((h) => (
                        <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {allScenarios.map((s) => {
                      const coop = s.npc_behaviour?.trust_thresholds?.cooperative
                        ?? s.apa_metadata?.npc_behaviour?.trust_thresholds?.cooperative
                        ?? '—'
                      const criteria = s.success_criteria ?? {}
                      return (
                        <tr key={s.scenario_id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{s.title}</td>
                          <td className="px-4 py-2">
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                              DIFFICULTY_COLORS[s.difficulty] ?? 'bg-gray-100 text-gray-600'
                            )}>
                              {s.difficulty}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-600">{s.turns}</td>
                          <td className="px-4 py-2 text-gray-600">{criteria.min_trust_score ?? '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{criteria.max_escalation_level != null ? `${criteria.max_escalation_level}/5` : '—'}</td>
                          <td className="px-4 py-2 text-gray-600">trust ≥ {coop}</td>
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
