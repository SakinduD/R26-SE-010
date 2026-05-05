import { Loader2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_COLORS = {
  beginner:     'bg-green-100 text-green-700',
  intermediate: 'bg-yellow-100 text-yellow-700',
  advanced:     'bg-red-100 text-red-700',
}

const getDifficultyStars = (weight) => {
  if (weight <= 1.0) return { label: '⭐ Easy start',       cls: 'text-green-500' }
  if (weight <= 1.5) return { label: '⭐⭐ Moderate',       cls: 'text-yellow-500' }
  if (weight <= 2.0) return { label: '⭐⭐⭐ Challenging',  cls: 'text-orange-500' }
  return              { label: '⭐⭐⭐⭐ Expert',           cls: 'text-red-500' }
}

export default function ScenarioCard({ scenario, onStart, onViewDetail, isStarting }) {
  const skills = scenario.target_skills ?? scenario.apa_metadata?.target_skills ?? []
  const weight = scenario.difficulty_weight ?? scenario.apa_metadata?.difficulty_weight ?? 1.0
  const stars  = getDifficultyStars(weight)
  const visibleSkills = skills.slice(0, 3)
  const extraSkills   = skills.length - 3

  const handleCardClick = () => onViewDetail(scenario)
  const stopBubble = (e) => e.stopPropagation()

  return (
    <div
      onClick={handleCardClick}
      className="rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer p-5 flex flex-col gap-3"
    >
      {/* Top row — title + difficulty badge */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 text-base leading-snug">{scenario.title}</h3>
        <span className={cn(
          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
          DIFFICULTY_COLORS[scenario.difficulty] ?? 'bg-gray-100 text-gray-600'
        )}>
          {scenario.difficulty}
        </span>
      </div>

      {/* Middle row — conflict type + turns */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="bg-gray-100 text-gray-500 text-xs rounded-full px-2 py-0.5">
          {scenario.conflict_type}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-xs text-gray-400">~{scenario.recommended_turns ?? scenario.turns} turns</span>
          {scenario.max_turns && (
            <span className="text-xs text-gray-300">up to {scenario.max_turns} max</span>
          )}
        </div>
      </div>

      {/* End condition hint */}
      {scenario.end_conditions?.success_trust_threshold != null && (
        <span className="text-xs text-gray-300 italic">
          Resolves when trust ≥ {scenario.end_conditions.success_trust_threshold}
        </span>
      )}

      {/* Skill tags */}
      {visibleSkills.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-1">Skills</p>
          <div className="flex flex-wrap gap-1">
            {visibleSkills.map((skill) => (
              <span key={skill} className="bg-blue-50 text-blue-600 text-xs rounded-full px-2 py-0.5">
                {skill.replace(/_/g, ' ')}
              </span>
            ))}
            {extraSkills > 0 && (
              <span className="text-xs text-gray-400">+{extraSkills} more</span>
            )}
          </div>
        </div>
      )}

      {/* Difficulty weight stars */}
      <p className={cn('text-xs font-medium', stars.cls)}>{stars.label}</p>

      {/* Bottom row — View Details + Start */}
      <div className="mt-auto flex items-center justify-between gap-2" onClick={stopBubble}>
        <button
          onClick={() => onViewDetail(scenario)}
          className="text-blue-600 text-sm underline hover:no-underline"
        >
          View Details
        </button>
        <button
          onClick={() => onStart(scenario)}
          disabled={isStarting}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isStarting
            ? <><Loader2 size={13} className="animate-spin" /> Starting…</>
            : <><ChevronRight size={13} /> Start</>}
        </button>
      </div>
    </div>
  )
}
