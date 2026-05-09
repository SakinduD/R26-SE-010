import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { cn } from '@/lib/utils'

const DIFFICULTY_FILTERS = ['all', 'beginner', 'intermediate', 'advanced']

const DIFFICULTY_COLORS = {
  beginner:     'bg-green-100 text-green-700',
  intermediate: 'bg-yellow-100 text-yellow-700',
  advanced:     'bg-red-100 text-red-700',
}

export default function ScenarioSelect() {
  const navigate = useNavigate()
  const [scenarios, setScenarios] = useState([])
  const [selectedDifficulty, setSelectedDifficulty] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [startingId, setStartingId] = useState(null)

  const fetchScenarios = async (difficulty = 'all') => {
    setIsLoading(true)
    setError(null)
    try {
      const data = difficulty === 'all'
        ? await rpeService.getScenarios()
        : await rpeService.getScenariosByDifficulty(difficulty)
      setScenarios(data)
    } catch (err) {
      setError(err.message || 'Failed to load scenarios')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { fetchScenarios() }, [])

  const handleFilterChange = (difficulty) => {
    setSelectedDifficulty(difficulty)
    fetchScenarios(difficulty)
  }

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

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Role-Play Scenarios</h1>
          <p className="mt-1 text-gray-500">
            Choose a scenario to practice your workplace soft skills
          </p>
        </div>

        {/* Difficulty filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {DIFFICULTY_FILTERS.map((d) => (
            <button
              key={d}
              onClick={() => handleFilterChange(d)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize',
                selectedDifficulty === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {d === 'all' ? 'All' : d}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            <AlertCircle size={16} className="shrink-0" />
            <span className="text-sm flex-1">{error}</span>
            <button
              onClick={() => fetchScenarios(selectedDifficulty)}
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
              <div
                key={n}
                className="rounded-xl border border-gray-200 bg-white p-5 space-y-3 animate-pulse"
              >
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="flex gap-2">
                  <div className="h-5 bg-gray-100 rounded-full w-20" />
                  <div className="h-5 bg-gray-100 rounded-full w-24" />
                </div>
                <div className="h-3 bg-gray-100 rounded w-16" />
                <div className="h-9 bg-gray-100 rounded-lg w-full mt-2" />
              </div>
            ))}
          </div>
        )}

        {/* Scenario cards */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scenarios.length === 0 && (
              <p className="col-span-3 text-center text-gray-400 py-16 text-sm">
                No scenarios found for this filter.
              </p>
            )}
            {scenarios.map((scenario) => (
              <div
                key={scenario.scenario_id}
                className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow"
              >
                <div>
                  <h3 className="font-semibold text-gray-900">{scenario.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                      DIFFICULTY_COLORS[scenario.difficulty] ?? 'bg-gray-100 text-gray-600'
                    )}>
                      {scenario.difficulty}
                    </span>
                    <span className="rounded-full bg-gray-100 text-gray-600 px-2.5 py-0.5 text-xs">
                      {scenario.conflict_type}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400">{scenario.turns} turns</p>
                <button
                  onClick={() => handleStart(scenario)}
                  disabled={!!startingId}
                  className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {startingId === scenario.scenario_id ? (
                    <><Loader2 size={14} className="animate-spin" /> Starting…</>
                  ) : (
                    <><ChevronRight size={14} /> Start Scenario</>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
