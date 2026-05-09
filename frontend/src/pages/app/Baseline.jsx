import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity, ArrowRight, CheckCircle2, Loader2,
  Mic, Sparkles, Users,
} from 'lucide-react'
import { getMyBaseline, injectDemoPersona, listDemoPersonas, skipBaseline } from '@/lib/api/pedagogy'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import { cn } from '@/lib/utils'

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true'

function MetricPill({ label, value, color }) {
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/30 p-3 space-y-0.5 text-center">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={cn('text-xl font-bold tabular-nums', color)}>{value}</p>
    </div>
  )
}

function BaselineSummaryCard({ baseline }) {
  const stressColor = baseline.stress_indicator > 0.6 ? 'text-orange-500' : 'text-emerald-500'
  const confColor = baseline.confidence_indicator < 0.3 ? 'text-orange-500' : 'text-emerald-500'

  return (
    <motion.div
      variants={fadeInUp}
      className="rounded-xl border border-emerald-400/40 bg-emerald-500/5 p-5 space-y-4"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-emerald-500" />
        <h2 className="text-sm font-semibold text-foreground">Baseline recorded</h2>
      </div>

      <div className="flex gap-3">
        <MetricPill
          label="Stress"
          value={`${Math.round((baseline.stress_indicator ?? 0) * 100)}%`}
          color={stressColor}
        />
        <MetricPill
          label="Confidence"
          value={`${Math.round((baseline.confidence_indicator ?? 0) * 100)}%`}
          color={confColor}
        />
        {baseline.duration_seconds != null && (
          <MetricPill
            label="Duration"
            value={`${baseline.duration_seconds}s`}
            color="text-foreground"
          />
        )}
      </div>

      {baseline.dominant_emotions?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
            Dominant emotions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {baseline.dominant_emotions.map((e) => (
              <span
                key={e}
                className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground capitalize"
              >
                {e}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-emerald-700 border-t border-emerald-400/30 pt-3">
        Your plan has been calibrated using this baseline evidence.
      </p>
    </motion.div>
  )
}

function DemoInjector({ onInjected }) {
  const [personas, setPersonas] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(null)

  useEffect(() => {
    listDemoPersonas()
      .then(setPersonas)
      .catch(() => setPersonas([]))
  }, [])

  async function handleInject(personaId) {
    setLoading(true)
    setActive(personaId)
    try {
      await injectDemoPersona(personaId)
      onInjected()
    } catch {
      setLoading(false)
      setActive(null)
    }
  }

  if (!personas.length) return null

  return (
    <motion.div
      variants={fadeInUp}
      className="rounded-xl border border-violet-400/40 bg-violet-500/5 p-5 space-y-3"
    >
      <div className="flex items-center gap-2">
        <Users className="size-4 text-violet-500" />
        <p className="text-sm font-semibold text-foreground">Demo mode — inject a persona</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Instantly load a pre-canned OCEAN profile + baseline for demonstration purposes.
      </p>
      <div className="flex flex-col gap-2">
        {personas.map((p) => (
          <button
            key={p.id}
            onClick={() => handleInject(p.id)}
            disabled={loading}
            className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3 text-left hover:bg-muted/30 transition-colors disabled:opacity-60"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-violet-500/10">
              {loading && active === p.id
                ? <Loader2 className="size-3.5 animate-spin text-violet-500" />
                : <Sparkles className="size-3.5 text-violet-500" />
              }
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">{p.label}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                {p.description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

export default function Baseline() {
  const { isLoading: authLoading } = useProtectedRoute()
  const navigate = useNavigate()
  const [baseline, setBaseline] = useState(undefined)
  const [loading, setLoading] = useState(true)

  function fetchBaseline() {
    setLoading(true)
    getMyBaseline()
      .then((b) => {
        setBaseline(b)
        setLoading(false)
      })
      .catch(() => {
        setBaseline(null)
        setLoading(false)
      })
  }

  useEffect(() => {
    if (authLoading) return
    fetchBaseline()
  }, [authLoading])

  function handleDemoInjected() {
    fetchBaseline()
    navigate('/training-plan')
  }

  if (loading || authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hasBaseline = baseline !== null
  const [skipping, setSkipping] = useState(false)

  async function handleSkip() {
    setSkipping(true)
    try {
      await skipBaseline()
    } catch {
      // generate_training_plan will 404 if no survey — let TrainingPlan page handle it
    }
    navigate('/training-plan')
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-xl space-y-6"
    >
      {/* Header */}
      <motion.div variants={fadeInUp} className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Baseline voice session
        </h1>
        <p className="text-sm text-muted-foreground">
          A 3-minute voice assessment calibrates your training plan with real
          vocal and emotional evidence — on top of your personality profile.
        </p>
      </motion.div>

      {/* What it does */}
      {!hasBaseline && (
        <motion.div
          variants={fadeInUp}
          className="rounded-xl border border-border/60 bg-card p-5 shadow-sm space-y-3"
        >
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
              <Mic className="size-4 text-primary" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">How it works</h2>
          </div>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {[
              'Respond to 2–3 practice prompts in the Multimodal Coach (MCA) module.',
              'Your vocal tone, pacing, and emotional signals are analysed.',
              'APM uses the results to fine-tune your starting difficulty, NPC style, and focus skills.',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="shrink-0 flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ul>
          <div className="border-t border-border/40 pt-3">
            <Link
              to="/multimodal-analysis"
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-all"
            >
              <Activity className="size-4" />
              Go to voice assessment
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </motion.div>
      )}

      {/* Baseline already recorded */}
      {hasBaseline && <BaselineSummaryCard baseline={baseline} />}

      {/* Demo persona injector */}
      {IS_DEMO && <DemoInjector onInjected={handleDemoInjected} />}

      {/* CTAs */}
      <motion.div variants={fadeInUp} className="pt-2 pb-8 space-y-3">
        {hasBaseline ? (
          <Link
            to="/training-plan"
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-all"
          >
            View your calibrated plan
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <button
            onClick={handleSkip}
            disabled={skipping}
            className="group flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-card px-5 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all disabled:opacity-60"
          >
            {skipping ? <Loader2 className="size-4 animate-spin" /> : null}
            Skip — generate plan without baseline
          </button>
        )}
        <Link
          to="/dashboard"
          className="group flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs text-muted-foreground hover:text-foreground transition-all"
        >
          Continue to dashboard
        </Link>
      </motion.div>
    </motion.div>
  )
}
