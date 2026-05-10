import { useState, useEffect } from 'react'
import { X, Loader2, ChevronRight, ChevronDown, ChevronUp, CheckCircle, XCircle, Clock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

// REDESIGN: emerald/amber/red/slate → semantic tokens
const DIFFICULTY_STYLES = {
  beginner:     'bg-success/10 text-success',
  intermediate: 'bg-warning/10 text-warning',
  advanced:     'bg-danger/10 text-danger',
}

const getDifficultyLabel = (weight) => {
  if (weight <= 1.0) return 'Easy start'
  if (weight <= 1.5) return 'Moderate'
  if (weight <= 2.0) return 'Challenging'
  return 'Expert'
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
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl border border-border max-w-lg w-full max-h-[88vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header with gradient */}
        <div className="sticky top-0 bg-gradient-to-r from-primary/8 to-card border-b border-border px-6 py-4 rounded-t-2xl flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground leading-snug">{scenario.title}</h2>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
                DIFFICULTY_STYLES[scenario.difficulty] ?? 'bg-muted text-muted-foreground'
              )}>
                {scenario.difficulty}
              </span>
              <span className="bg-muted text-muted-foreground text-xs rounded-full px-2.5 py-0.5 font-medium">
                {scenario.conflict_type}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Situation */}
          {scenario.context && (
            <section>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                What's the situation?
              </p>
              <p className="text-sm text-foreground leading-relaxed">{scenario.context}</p>
            </section>
          )}

          {/* NPC Profile */}
          <section className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              You'll be talking to
            </p>
            <p className="font-semibold text-foreground">{scenario.npc_role}</p>
            {scenario.npc_personality && (
              <p className="text-sm text-muted-foreground italic mt-0.5">{scenario.npc_personality}</p>
            )}
            {scenario.opening_npc_line && (
              <div className="mt-3 bg-elevated rounded-lg px-3 py-2.5 border-l-[3px] border-primary/60">
                <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-widest">Opening line</p>
                <p className="text-sm text-foreground italic">"{scenario.opening_npc_line}"</p>
              </div>
            )}
          </section>

          {/* Skills */}
          {(skills.length > 0 || traits.length > 0) && (
            <section>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                Skills you'll practice
              </p>
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {skills.map((s) => (
                    <span key={s} className="bg-accent text-accent-foreground text-xs rounded-full px-3 py-1 font-medium">
                      {s.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
              {traits.length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-widest">Big Five relevance</p>
                  <div className="flex flex-wrap gap-1">
                    {traits.map((t) => (
                      <span key={t} className="bg-secondary/10 text-secondary text-xs rounded-full px-2.5 py-0.5 capitalize font-medium">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Session info */}
          <section>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              Session Info
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Recommended</p>
                <p className="text-sm font-semibold text-foreground">{scenario.recommended_turns ?? scenario.turns} turns</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Maximum</p>
                <p className="text-sm font-semibold text-foreground">{scenario.max_turns ?? (scenario.recommended_turns ?? scenario.turns)} turns</p>
              </div>
              {criteria.min_trust_score != null && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Min Trust</p>
                  <p className="text-sm font-semibold text-success">{criteria.min_trust_score}</p>
                </div>
              )}
              {criteria.max_escalation_level != null && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Max Escalation</p>
                  <p className="text-sm font-semibold text-warning">{criteria.max_escalation_level}/5</p>
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Zap size={11} className="text-primary fill-current" />
              <span className="text-xs font-semibold text-primary">{getDifficultyLabel(weight)}</span>
            </div>
          </section>

          {/* How does this session end? */}
          {(() => {
            const ec = scenario.end_conditions ?? {}
            const successThreshold  = ec.success_trust_threshold     ?? 70
            const consecutiveTurns  = ec.success_consecutive_turns    ?? 2
            const failureEscalation = ec.failure_escalation_threshold ?? 5
            const maxT = scenario.max_turns ?? (scenario.recommended_turns ?? scenario.turns)
            return (
              <section>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                  How does this session end?
                </p>
                <div className="space-y-2">
                  <div className="rounded-lg border border-success/20 bg-success/5 px-3 py-2.5 flex items-start gap-2.5">
                    <CheckCircle className="text-success w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-sm text-foreground">
                      Build trust above <span className="font-semibold">{successThreshold}</span> for{' '}
                      <span className="font-semibold">{consecutiveTurns}</span> consecutive turns
                    </p>
                  </div>
                  <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5 flex items-start gap-2.5">
                    <XCircle className="text-danger w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-sm text-foreground">
                      Escalation reaches <span className="font-semibold">{failureEscalation}/5</span> — the NPC walks out
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 flex items-start gap-2.5">
                    <Clock className="text-muted-foreground w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      Maximum of <span className="font-semibold text-foreground">{maxT}</span> turns — scored on final trust and escalation
                    </p>
                  </div>
                </div>
              </section>
            )
          })()}

          {/* NPC Behaviour thresholds — collapsible */}
          {(Object.keys(trustThr).length > 0 || Object.keys(escThr).length > 0) && (
            <section>
              <button
                onClick={() => setShowThresholds((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
              >
                {showThresholds ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showThresholds ? 'Hide NPC thresholds' : 'Show NPC thresholds'}
              </button>
              {showThresholds && (
                <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
                  {Object.keys(trustThr).length > 0 && (
                    <div>
                      <p className="font-semibold text-foreground mb-1">Trust thresholds</p>
                      {Object.entries(trustThr).map(([k, v]) => (
                        <div key={k} className="flex justify-between py-0.5">
                          <span className="capitalize">{k}</span>
                          <span className="font-medium text-foreground">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {Object.keys(escThr).length > 0 && (
                    <div>
                      <p className="font-semibold text-foreground mb-1">Escalation thresholds</p>
                      {Object.entries(escThr).map(([k, v]) => (
                        <div key={k} className="flex justify-between py-0.5">
                          <span className="capitalize">{k}</span>
                          <span className="font-medium text-foreground">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex gap-3 justify-end px-6 py-4 bg-card border-t border-border rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground rounded-lg hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart(scenario)}
            disabled={isStarting}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
