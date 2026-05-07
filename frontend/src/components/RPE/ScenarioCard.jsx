import { Loader2, ChevronRight, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_STYLES = {
  beginner:     { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-400' },
  intermediate: { badge: 'bg-amber-100 text-amber-700',    bar: 'bg-amber-400'   },
  advanced:     { badge: 'bg-red-100 text-red-700',         bar: 'bg-red-400'     },
}

const getDifficultyStars = (weight) => {
  if (weight <= 1.0) return { label: 'Easy start',    cls: 'text-emerald-600' }
  if (weight <= 1.5) return { label: 'Moderate',      cls: 'text-amber-600'   }
  if (weight <= 2.0) return { label: 'Challenging',   cls: 'text-orange-600'  }
  return              { label: 'Expert',          cls: 'text-red-600'     }
}

export default function ScenarioCard({ scenario, onStart, onViewDetail, isStarting }) {
  const skills       = scenario.target_skills ?? scenario.apa_metadata?.target_skills ?? []
  const weight       = scenario.difficulty_weight ?? scenario.apa_metadata?.difficulty_weight ?? 1.0
  const stars        = getDifficultyStars(weight)
  const diff         = DIFFICULTY_STYLES[scenario.difficulty] ?? { badge: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' }
  const visibleSkills = skills.slice(0, 3)
  const extraSkills   = skills.length - 3

  return (
    <div
      onClick={() => onViewDetail(scenario)}
      className="group rounded-xl border border-border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-200 cursor-pointer flex flex-col overflow-hidden"
    >
      {/* Difficulty accent bar */}
      <div className={cn('h-1 w-full', diff.bar)} />

      <div className="p-5 flex flex-col gap-3 flex-1">

        {/* Title + difficulty badge */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground text-base leading-snug group-hover:text-primary transition-colors">
            {scenario.title}
          </h3>
          <span className={cn(
            'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
            diff.badge
          )}>
            {scenario.difficulty}
          </span>
        </div>

        {/* Conflict type + turns */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="bg-muted text-muted-foreground text-xs rounded-full px-2.5 py-0.5 font-medium">
            {scenario.conflict_type}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-muted-foreground">~{scenario.recommended_turns ?? scenario.turns} turns</span>
            {scenario.max_turns && (
              <span className="text-[10px] text-muted-foreground/60">up to {scenario.max_turns} max</span>
            )}
          </div>
        </div>

        {/* End condition hints */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {scenario.end_conditions?.success_trust_threshold != null && (
            <span className="text-[11px] text-muted-foreground/70 italic">
              Resolves at trust ≥ {scenario.end_conditions.success_trust_threshold}
            </span>
          )}
          {scenario.end_conditions?.failure_escalation_threshold != null && (
            <span className="text-[11px] text-red-400/80 italic">
              NPC exits at escalation ≥ {scenario.end_conditions.failure_escalation_threshold}/5
            </span>
          )}
        </div>

        {/* Skill tags */}
        {visibleSkills.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Skills</p>
            <div className="flex flex-wrap gap-1">
              {visibleSkills.map((skill) => (
                <span key={skill} className="bg-accent text-accent-foreground text-xs rounded-full px-2.5 py-0.5 font-medium">
                  {skill.replace(/_/g, ' ')}
                </span>
              ))}
              {extraSkills > 0 && (
                <span className="text-xs text-muted-foreground self-center">+{extraSkills} more</span>
              )}
            </div>
          </div>
        )}

        {/* Difficulty weight */}
        <p className={cn('text-xs font-semibold flex items-center gap-1', stars.cls)}>
          <Zap size={11} className="fill-current" />
          {stars.label}
        </p>

        {/* Actions */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onViewDetail(scenario)}
            className="text-primary text-sm font-medium hover:underline underline-offset-2"
          >
            View Details
          </button>
          <button
            onClick={() => onStart(scenario)}
            disabled={isStarting}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm shadow-primary/20"
          >
            {isStarting
              ? <><Loader2 size={13} className="animate-spin" /> Starting…</>
              : <><ChevronRight size={13} /> Start</>}
          </button>
        </div>

      </div>
    </div>
  )
}
