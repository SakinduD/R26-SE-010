import { useState, useEffect } from 'react'
import { X, Loader2, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const DIFFICULTY_COLORS = {
  beginner:     'bg-green-100 text-green-700',
  intermediate: 'bg-yellow-100 text-yellow-700',
  advanced:     'bg-red-100 text-red-700',
}

const getDifficultyLabel = (weight) => {
  if (weight <= 1.0) return '⭐ Easy start'
  if (weight <= 1.5) return '⭐⭐ Moderate'
  if (weight <= 2.0) return '⭐⭐⭐ Challenging'
  return '⭐⭐⭐⭐ Expert'
}

export default function ScenarioDetailModal({ scenario, onClose, onStart, isStarting }) {
  const [showThresholds, setShowThresholds] = useState(false)

  useEffect(() => {
    if (!scenario) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [scenario, onClose])

  if (!scenario) return null

  const skills    = scenario.target_skills ?? scenario.apa_metadata?.target_skills ?? []
  const traits    = scenario.apa_metadata?.big_five_relevance ?? []
  const weight    = scenario.difficulty_weight ?? scenario.apa_metadata?.difficulty_weight ?? 1.0
  const criteria  = scenario.success_criteria ?? {}
  const behaviour = scenario.npc_behaviour ?? {}
  const trustThr  = behaviour.trust_thresholds ?? {}
  const escThr    = behaviour.escalation_thresholds ?? {}

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 leading-snug">{scenario.title}</h2>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                DIFFICULTY_COLORS[scenario.difficulty] ?? 'bg-gray-100 text-gray-600'
              )}>
                {scenario.difficulty}
              </span>
              <span className="bg-gray-100 text-gray-500 text-xs rounded-full px-2.5 py-0.5">
                {scenario.conflict_type}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Situation */}
        {scenario.context && (
          <section className="mb-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              What's the situation?
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">{scenario.context}</p>
          </section>
        )}

        {/* NPC Profile */}
        <section className="mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            You'll be talking to
          </p>
          <p className="font-semibold text-gray-900">{scenario.npc_role}</p>
          {scenario.npc_personality && (
            <p className="text-sm text-gray-500 italic mt-0.5">{scenario.npc_personality}</p>
          )}
          {scenario.opening_npc_line && (
            <div className="mt-3">
              <p className="text-xs text-gray-400 mb-1">Opening line:</p>
              <div className="bg-gray-50 border-l-4 border-gray-300 px-3 py-2 rounded-r-lg">
                <p className="text-sm text-gray-700 italic">"{scenario.opening_npc_line}"</p>
              </div>
            </div>
          )}
        </section>

        {/* Skills */}
        {(skills.length > 0 || traits.length > 0) && (
          <section className="mb-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Skills you'll practice
            </p>
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {skills.map((s) => (
                  <span key={s} className="bg-blue-50 text-blue-600 text-sm rounded-full px-3 py-1">
                    {s.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
            {traits.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Big Five relevance</p>
                <div className="flex flex-wrap gap-1">
                  {traits.map((t) => (
                    <span key={t} className="bg-purple-50 text-purple-600 text-xs rounded-full px-2 py-0.5 capitalize">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Session info */}
        <section className="mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Session Info
          </p>
          <div className="flex gap-6 text-sm text-gray-700 mb-2">
            <span><span className="text-gray-400">Turns: </span>{scenario.turns}</span>
            <span><span className="text-gray-400">Difficulty: </span>{getDifficultyLabel(weight)}</span>
          </div>
          {(criteria.min_trust_score != null || criteria.max_escalation_level != null) && (
            <div className="flex gap-6 text-sm text-gray-700">
              {criteria.min_trust_score != null && (
                <span><span className="text-gray-400">Min trust: </span>{criteria.min_trust_score}</span>
              )}
              {criteria.max_escalation_level != null && (
                <span><span className="text-gray-400">Max escalation: </span>{criteria.max_escalation_level}/5</span>
              )}
            </div>
          )}
        </section>

        {/* NPC Behaviour thresholds — collapsible */}
        {(Object.keys(trustThr).length > 0 || Object.keys(escThr).length > 0) && (
          <section className="mb-6">
            <button
              onClick={() => setShowThresholds((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showThresholds
                ? <><ChevronUp size={12} /> Hide NPC thresholds</>
                : <><ChevronDown size={12} /> Show NPC thresholds</>}
            </button>
            {showThresholds && (
              <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
                {Object.keys(trustThr).length > 0 && (
                  <div>
                    <p className="font-medium text-gray-500 mb-1">Trust thresholds</p>
                    {Object.entries(trustThr).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="capitalize">{k}</span><span>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(escThr).length > 0 && (
                  <div className="mt-2">
                    <p className="font-medium text-gray-500 mb-1">Escalation thresholds</p>
                    {Object.entries(escThr).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="capitalize">{k}</span><span>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Footer */}
        <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart(scenario)}
            disabled={isStarting}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isStarting
              ? <><Loader2 size={14} className="animate-spin" /> Starting…</>
              : <><ChevronRight size={14} /> Start Scenario</>}
          </button>
        </div>
      </div>
    </div>
  )
}
