import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, Brain, ChevronDown, ChevronUp,
  Loader2, RefreshCw, Sparkles, Target, TrendingUp,
} from 'lucide-react'
import { getMyTrainingPlan, generateTrainingPlan, getAdjustmentHistory } from '@/lib/api/pedagogy'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import { cn } from '@/lib/utils'

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true'

// --------------------------------------------------------------------------
// Label maps
// --------------------------------------------------------------------------

const TONE_LABEL = { gentle: 'Supportive', direct: 'Direct', challenging: 'Challenging' }
const PACING_LABEL = { slow: 'Relaxed', moderate: 'Moderate', fast: 'Fast' }
const COMPLEXITY_LABEL = { simple: 'Simple', moderate: 'Moderate', complex: 'Complex' }
const NPC_LABEL = {
  warm_supportive: 'Warm & Supportive',
  professional: 'Professional',
  demanding_critical: 'Demanding',
  analytical_probing: 'Analytical',
}
const FEEDBACK_LABEL = { encouraging: 'Encouraging', balanced: 'Balanced', blunt: 'Blunt' }

const TONE_COLOR = {
  gentle: 'bg-emerald-500/10 text-emerald-600',
  direct: 'bg-blue-500/10 text-blue-600',
  challenging: 'bg-orange-500/10 text-orange-600',
}
const FEEDBACK_COLOR = {
  encouraging: 'bg-emerald-500/10 text-emerald-600',
  balanced: 'bg-blue-500/10 text-blue-600',
  blunt: 'bg-orange-500/10 text-orange-600',
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function StrategyChip({ label, value, colorMap }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold w-fit', colorMap?.[value] ?? 'bg-muted text-foreground')}>
        {value}
      </span>
    </div>
  )
}

function DifficultyBar({ value }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Difficulty</span>
        <span className="text-xs font-semibold tabular-nums">{value}/10</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500"
          initial={{ width: 0 }}
          animate={{ width: `${value * 10}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
        />
      </div>
    </div>
  )
}

function StrategyCard({ strategy, difficulty }) {
  return (
    <motion.div
      variants={fadeInUp}
      className="rounded-xl border border-border/60 bg-card p-5 shadow-sm space-y-4"
    >
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
          <Brain className="size-4 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Your teaching strategy</h2>
      </div>

      <DifficultyBar value={difficulty} />

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1">
        <StrategyChip label="Tone" value={TONE_LABEL[strategy.tone] ?? strategy.tone} colorMap={TONE_COLOR} />
        <StrategyChip label="Pacing" value={PACING_LABEL[strategy.pacing] ?? strategy.pacing} />
        <StrategyChip label="Scenario complexity" value={COMPLEXITY_LABEL[strategy.complexity] ?? strategy.complexity} />
        <StrategyChip label="NPC personality" value={NPC_LABEL[strategy.npc_personality] ?? strategy.npc_personality} />
        <StrategyChip label="Feedback style" value={FEEDBACK_LABEL[strategy.feedback_style] ?? strategy.feedback_style} colorMap={FEEDBACK_COLOR} />
      </div>

      {strategy.rationale?.length > 0 && (
        <p className="text-xs text-muted-foreground border-t border-border/40 pt-3 leading-relaxed">
          <span className="font-medium text-foreground">Why: </span>
          {strategy.rationale.join(' · ')}
        </p>
      )}
    </motion.div>
  )
}

function ScenarioCard({ scenario, generationSource }) {
  if (!scenario || scenario.scenario_id === 'none') return null
  const badge = generationSource === 'rpe_library'
    ? { label: 'From library', cls: 'bg-blue-500/10 text-blue-600' }
    : generationSource === 'rpe_then_gemini'
    ? { label: 'AI-personalised', cls: 'bg-violet-500/10 text-violet-600' }
    : { label: 'AI-generated', cls: 'bg-violet-500/10 text-violet-600' }

  return (
    <motion.div
      variants={fadeInUp}
      className="rounded-xl border border-border/60 bg-card p-5 shadow-sm space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
            <Target className="size-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Recommended scenario</h2>
        </div>
        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold shrink-0', badge.cls)}>
          {badge.label}
        </span>
      </div>

      <div>
        <p className="text-base font-semibold text-foreground">{scenario.title}</p>
        {scenario.npc_role && (
          <p className="text-xs text-muted-foreground mt-0.5">NPC: {scenario.npc_role}</p>
        )}
      </div>

      {scenario.context && (
        <p className="text-xs text-muted-foreground leading-relaxed">{scenario.context}</p>
      )}

      {scenario.target_skills?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {scenario.target_skills.map((s) => (
            <span key={s} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {s.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {scenario.opening_npc_line && (
        <p className="text-xs italic text-muted-foreground border-t border-border/40 pt-3">
          "{scenario.opening_npc_line}"
        </p>
      )}
    </motion.div>
  )
}

function HistoryEntry({ entry, index }) {
  const [open, setOpen] = useState(index === 0)
  const diffDelta = entry.new_difficulty - entry.previous_difficulty
  const triggerLabel = { survey: 'Survey submitted', session_end: 'Session ended', live_signal: 'Live signal', manual: 'Manual' }

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[11px] font-medium rounded-md bg-muted px-2 py-0.5 shrink-0">
            {triggerLabel[entry.trigger] ?? entry.trigger}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {new Date(entry.created_at).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('text-xs font-semibold tabular-nums', diffDelta > 0 ? 'text-emerald-600' : diffDelta < 0 ? 'text-orange-600' : 'text-muted-foreground')}>
            {diffDelta > 0 ? `+${diffDelta}` : diffDelta} difficulty
          </span>
          {open ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2.5 border-t border-border/40 pt-3">
              <div className="flex items-center gap-6 text-xs">
                <div>
                  <span className="text-muted-foreground">Difficulty: </span>
                  <span className="font-semibold">{entry.previous_difficulty} → {entry.new_difficulty}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tone: </span>
                  <span className="font-semibold">
                    {TONE_LABEL[entry.previous_strategy?.tone] ?? entry.previous_strategy?.tone}
                    {' → '}
                    {TONE_LABEL[entry.new_strategy?.tone] ?? entry.new_strategy?.tone}
                  </span>
                </div>
              </div>
              {entry.rationale && (
                <p className="text-xs text-muted-foreground leading-relaxed">{entry.rationale}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AdjustmentHistorySection({ history }) {
  if (!history?.length) {
    return (
      <motion.div variants={fadeInUp} className="rounded-xl border border-dashed border-border/60 bg-card/50 p-5 text-center space-y-1">
        <TrendingUp className="size-5 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">No adjustments yet</p>
        <p className="text-xs text-muted-foreground">Your plan will adapt after each practice session.</p>
      </motion.div>
    )
  }

  return (
    <motion.div variants={fadeInUp} className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <TrendingUp className="size-4 text-primary" />
        Plan adjustments ({history.length})
      </h2>
      {history.map((entry, i) => (
        <HistoryEntry key={entry.id} entry={entry} index={i} />
      ))}
    </motion.div>
  )
}

// --------------------------------------------------------------------------
// Main page
// --------------------------------------------------------------------------

export default function TrainingPlan() {
  const { isLoading: authLoading } = useProtectedRoute()
  const [plan, setPlan] = useState(undefined)   // undefined = loading, null = not found
  const [history, setHistory] = useState([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (authLoading) return
    Promise.all([getMyTrainingPlan(), getAdjustmentHistory()])
      .then(([p, h]) => {
        setPlan(p)
        setHistory(h ?? [])
      })
      .catch(() => {
        setPlan(null)
        setHistory([])
      })
  }, [authLoading])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const p = await generateTrainingPlan()
      setPlan(p)
      const h = await getAdjustmentHistory()
      setHistory(h ?? [])
    } catch (err) {
      setError(
        err.response?.status === 404
          ? 'Complete the personality survey first, then come back to generate your plan.'
          : 'Something went wrong. Please try again.'
      )
    } finally {
      setGenerating(false)
    }
  }

  const isLoading = authLoading || plan === undefined

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-xl space-y-6"
    >
      {/* Demo banner */}
      {IS_DEMO && (
        <motion.div
          variants={fadeInUp}
          className="rounded-xl border border-violet-400/40 bg-violet-500/10 px-4 py-3 text-xs text-violet-700 space-y-0.5"
        >
          <p className="font-semibold">Demo mode — Adaptive Pedagogy thesis demonstration</p>
          <p className="text-violet-600/80">
            Two personas (high-N/low-E introvert and low-N/high-E extrovert) will receive different
            strategies and starting difficulties, proving the adaptation thesis end-to-end.
          </p>
        </motion.div>
      )}

      {/* Header */}
      <motion.div variants={fadeInUp} className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Your training plan
        </h1>
        <p className="text-sm text-muted-foreground">
          Personalised to your Big Five profile — adapts after every session.
        </p>
      </motion.div>

      {/* No plan yet */}
      {plan === null && (
        <motion.div
          variants={fadeInUp}
          className="rounded-xl border border-dashed border-border/60 bg-card/50 p-8 text-center space-y-4"
        >
          <Sparkles className="size-8 text-primary mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">No plan yet</p>
            <p className="text-xs text-muted-foreground">
              Generate your personalised training plan based on your personality profile.
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-all disabled:opacity-60"
          >
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? 'Generating…' : 'Generate plan'}
          </button>
          <Link to="/survey/results" className="block text-xs text-muted-foreground hover:text-foreground transition-colors">
            View your personality profile first →
          </Link>
        </motion.div>
      )}

      {/* Plan loaded */}
      {plan && (
        <>
          {plan.generation_status === 'pending' && (
            <motion.div variants={fadeInUp} className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
              Plan is being generated — refresh in a moment.
            </motion.div>
          )}

          <StrategyCard strategy={plan.strategy} difficulty={plan.difficulty} />
          <ScenarioCard scenario={plan.primary_scenario} generationSource={plan.generation_source} />
          <AdjustmentHistorySection history={history} />

          {/* Actions */}
          <motion.div variants={fadeInUp} className="flex gap-3 pt-2 pb-8">
            <Link
              to="/roleplay"
              className="group flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-all"
            >
              Start practice session
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all disabled:opacity-60"
              title="Regenerate training plan"
            >
              {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </button>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}
