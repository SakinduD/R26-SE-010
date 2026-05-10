import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity, ArrowRight, Brain, Loader2, RefreshCw, Sparkles, Target, TrendingUp,
} from 'lucide-react'
import { getMyTrainingPlan, generateTrainingPlan, getAdjustmentHistory } from '@/lib/api/pedagogy'
import { getMyBaseline } from '@/lib/api/baseline'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Banner from '@/components/ui/Banner'
import ScoreBar from '@/components/ui/ScoreBar'
import EmptyState from '@/components/ui/EmptyState'
import AccordionItem from '@/components/ui/AccordionItem'
import ChipToggle from '@/components/ui/ChipToggle'

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

const TONE_VARIANT = { gentle: 'success', direct: 'info', challenging: 'warning' }
const FEEDBACK_VARIANT = { encouraging: 'success', balanced: 'info', blunt: 'warning' }

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function StrategyChip({ label, value, variant = 'neutral' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="t-over">{label}</span>
      <span style={{ width: 'fit-content' }}>
        <Badge variant={variant}>{value}</Badge>
      </span>
    </div>
  )
}

function DifficultyBar({ value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="t-cap">Difficulty</span>
        <span className="score-num fg" style={{ fontSize: 13 }}>{value}/10</span>
      </div>
      <ScoreBar value={value * 10} gradient />
    </div>
  )
}

function StrategyCard({ strategy, difficulty }) {
  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
            }}
          >
            <Brain size={14} strokeWidth={1.8} />
          </div>
          <div className="t-h3" style={{ margin: 0 }}>Your teaching strategy</div>
        </div>

        <DifficultyBar value={difficulty} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px 16px',
            paddingTop: 16,
          }}
        >
          <StrategyChip
            label="Tone"
            value={TONE_LABEL[strategy.tone] ?? strategy.tone}
            variant={TONE_VARIANT[strategy.tone] ?? 'neutral'}
          />
          <StrategyChip
            label="Pacing"
            value={PACING_LABEL[strategy.pacing] ?? strategy.pacing}
          />
          <StrategyChip
            label="Scenario complexity"
            value={COMPLEXITY_LABEL[strategy.complexity] ?? strategy.complexity}
          />
          <StrategyChip
            label="NPC personality"
            value={NPC_LABEL[strategy.npc_personality] ?? strategy.npc_personality}
          />
          <StrategyChip
            label="Feedback style"
            value={FEEDBACK_LABEL[strategy.feedback_style] ?? strategy.feedback_style}
            variant={FEEDBACK_VARIANT[strategy.feedback_style] ?? 'neutral'}
          />
        </div>

        {strategy.rationale?.length > 0 && (
          <>
            <div className="divider" style={{ margin: '16px 0' }} />
            <p className="t-cap" style={{ lineHeight: 1.55 }}>
              <span className="fg" style={{ fontWeight: 500 }}>Why: </span>
              {strategy.rationale.join(' · ')}
            </p>
          </>
        )}
      </Card>
    </motion.div>
  )
}

function ScenarioCard({ scenario, generationSource }) {
  if (!scenario || scenario.scenario_id === 'none') return null
  const badge = generationSource === 'rpe_library'
    ? { label: 'From library', variant: 'info' }
    : generationSource === 'rpe_then_gemini'
    ? { label: 'AI-personalised', variant: 'accent' }
    : { label: 'AI-generated', variant: 'accent' }

  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
              }}
            >
              <Target size={14} strokeWidth={1.8} />
            </div>
            <div className="t-h3" style={{ margin: 0 }}>Recommended scenario</div>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>

        <div style={{ marginBottom: 8 }}>
          <p className="fg" style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>{scenario.title}</p>
          {scenario.npc_role && (
            <p className="t-cap" style={{ marginTop: 2 }}>NPC: {scenario.npc_role}</p>
          )}
        </div>

        {scenario.context && (
          <p className="t-cap" style={{ lineHeight: 1.6, marginTop: 8 }}>{scenario.context}</p>
        )}

        {scenario.target_skills?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {scenario.target_skills.map((s) => (
              <ChipToggle key={s} staticOnly>
                <span style={{ textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</span>
              </ChipToggle>
            ))}
          </div>
        )}

        {scenario.opening_npc_line && (
          <>
            <div className="divider" style={{ margin: '16px 0 12px' }} />
            <p
              className="t-body"
              style={{ fontStyle: 'italic', color: 'var(--text-secondary)', margin: 0 }}
            >
              "{scenario.opening_npc_line}"
            </p>
          </>
        )}
      </Card>
    </motion.div>
  )
}

function HistoryEntry({ entry, index }) {
  const diffDelta = entry.new_difficulty - entry.previous_difficulty
  const triggerLabel = {
    survey: 'Survey submitted',
    session_end: 'Session ended',
    live_signal: 'Live signal',
    manual: 'Manual',
  }
  const deltaVariant = diffDelta > 0 ? 'success' : diffDelta < 0 ? 'warning' : 'neutral'

  return (
    <AccordionItem
      defaultOpen={index === 0}
      title={triggerLabel[entry.trigger] ?? entry.trigger}
      subtitle={new Date(entry.created_at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
      badge={
        <Badge variant={deltaVariant}>
          {diffDelta > 0 ? `+${diffDelta}` : diffDelta} difficulty
        </Badge>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div className="t-cap">
            <span style={{ color: 'var(--text-tertiary)' }}>Difficulty: </span>
            <span className="score-num fg" style={{ fontWeight: 500 }}>
              {entry.previous_difficulty} → {entry.new_difficulty}
            </span>
          </div>
          <div className="t-cap">
            <span style={{ color: 'var(--text-tertiary)' }}>Tone: </span>
            <span className="fg" style={{ fontWeight: 500 }}>
              {TONE_LABEL[entry.previous_strategy?.tone] ?? entry.previous_strategy?.tone}
              {' → '}
              {TONE_LABEL[entry.new_strategy?.tone] ?? entry.new_strategy?.tone}
            </span>
          </div>
        </div>
        {entry.rationale && (
          <p className="t-cap" style={{ lineHeight: 1.55 }}>{entry.rationale}</p>
        )}
      </div>
    </AccordionItem>
  )
}

function PersonalizationBriefCard({ brief }) {
  if (!brief) return null
  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
            }}
          >
            <Sparkles size={14} strokeWidth={1.8} />
          </div>
          <div className="t-h3" style={{ margin: 0 }}>Why this plan?</div>
          {brief.has_baseline_evidence && (
            <span style={{ marginLeft: 'auto' }}>
              <Badge variant="success">Baseline calibrated</Badge>
            </span>
          )}
        </div>

        <p className="t-body fg" style={{ lineHeight: 1.6, margin: 0 }}>{brief.summary}</p>

        {brief.drivers?.length > 0 && (
          <>
            <div className="divider" style={{ margin: '16px 0' }} />
            <div className="t-over" style={{ marginBottom: 8 }}>Key factors</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {brief.drivers.map((d, i) => (
                <li key={i} className="t-cap" style={{ display: 'flex', gap: 8, lineHeight: 1.55 }}>
                  <span style={{ color: 'var(--accent)', flexShrink: 0 }}>·</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {brief.priority_skills?.length > 0 && (
          <>
            <div className="divider" style={{ margin: '16px 0' }} />
            <div className="t-over" style={{ marginBottom: 8 }}>Focus skills</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {brief.priority_skills.map((s) => (
                <ChipToggle key={s} staticOnly active>
                  <span style={{ textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</span>
                </ChipToggle>
              ))}
            </div>
          </>
        )}

        {brief.difficulty_rationale && (
          <>
            <div className="divider" style={{ margin: '16px 0' }} />
            <p className="t-cap" style={{ lineHeight: 1.55 }}>{brief.difficulty_rationale}</p>
          </>
        )}
      </Card>
    </motion.div>
  )
}

// summary = plan.baseline_summary_json (derived fields from orchestrator)
// snapshot = raw BaselineSnapshotOut from GET /apa/baseline/me
function BaselineEvidenceCard({ summary, snapshot }) {
  // No baseline recorded at all
  if (!summary?.has_baseline && !snapshot) return null

  const isSkipped = snapshot?.mca_session_id === 'skipped'

  // Skipped state — default variant, nudge to complete
  if (isSkipped) {
    return (
      <motion.div variants={fadeInUp}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-tertiary)',
              }}
            >
              <Activity size={14} strokeWidth={1.8} />
            </div>
            <div className="t-h3" style={{ margin: 0 }}>Baseline evidence</div>
            <span style={{ marginLeft: 'auto' }}>
              <Badge variant="neutral">Skipped</Badge>
            </span>
          </div>
          <p className="t-cap" style={{ lineHeight: 1.55, marginBottom: 14 }}>
            Your plan is based on your personality profile only. Complete the voice baseline to
            unlock more accurate difficulty calibration and scenario selection.
          </p>
          <Link to="/baseline" className="btn btn-secondary" style={{ display: 'inline-flex' }}>
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Activity size={13} strokeWidth={1.8} />
              Complete baseline now
            </span>
          </Link>
        </Card>
      </motion.div>
    )
  }

  // Completed state — accent variant with evidence metrics
  if (!summary?.has_baseline) return null
  const stress = Math.round((summary.stress_indicator ?? 0) * 100)
  const confidence = Math.round((summary.confidence_indicator ?? 0) * 100)
  const stressColor = stress > 60 ? 'var(--warning)' : 'var(--success)'
  const confColor = confidence < 30 ? 'var(--warning)' : 'var(--success)'

  return (
    <motion.div variants={fadeInUp}>
      <Card variant="accent">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'color-mix(in oklch, var(--success) 12%, transparent)',
              border: '1px solid color-mix(in oklch, var(--success) 25%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--success)',
            }}
          >
            <Activity size={14} strokeWidth={1.8} />
          </div>
          <div className="t-h3" style={{ margin: 0 }}>Baseline evidence</div>
          <span style={{ marginLeft: 'auto' }}>
            <Badge variant="success">Used in calibration</Badge>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{
            padding: 14, background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius)', textAlign: 'center',
          }}>
            <div className="t-over" style={{ marginBottom: 6 }}>Stress</div>
            <div className="score-num" style={{ fontSize: 22, fontWeight: 500, color: stressColor }}>
              {stress}%
            </div>
          </div>
          <div style={{
            padding: 14, background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius)', textAlign: 'center',
          }}>
            <div className="t-over" style={{ marginBottom: 6 }}>Confidence</div>
            <div className="score-num" style={{ fontSize: 22, fontWeight: 500, color: confColor }}>
              {confidence}%
            </div>
          </div>
        </div>

        {summary.dominant_emotions?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {summary.dominant_emotions.map((e) => (
              <ChipToggle key={e} staticOnly>
                <span style={{ textTransform: 'capitalize' }}>{e}</span>
              </ChipToggle>
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  )
}

function AdjustmentHistorySection({ history }) {
  if (!history?.length) {
    return (
      <motion.div variants={fadeInUp}>
        <Card>
          <EmptyState
            icon={TrendingUp}
            title="No adjustments yet"
            description="Your plan will adapt after each practice session."
          />
        </Card>
      </motion.div>
    )
  }

  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <div className="t-h3" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px' }}>
          <TrendingUp size={16} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
          Plan adjustments ({history.length})
        </div>
        {history.map((entry, i) => (
          <HistoryEntry key={entry.id} entry={entry} index={i} />
        ))}
      </Card>
    </motion.div>
  )
}

// --------------------------------------------------------------------------
// Main page
// --------------------------------------------------------------------------

export default function TrainingPlan() {
  const { isLoading: authLoading } = useProtectedRoute()
  const [plan, setPlan]         = useState(undefined) // undefined = loading, null = not found
  const [history, setHistory]   = useState([])
  const [snapshot, setSnapshot] = useState(undefined) // undefined = loading, null = none
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (authLoading) return
    Promise.all([getMyTrainingPlan(), getAdjustmentHistory(), getMyBaseline()])
      .then(([p, h, b]) => {
        setPlan(p)
        setHistory(h ?? [])
        setSnapshot(b)
      })
      .catch(() => {
        setPlan(null)
        setHistory([])
        setSnapshot(null)
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
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setGenerating(false)
    }
  }

  const isLoading = authLoading || plan === undefined

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '50vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    )
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page"
    >
      <PageHead
        eyebrow="Adaptive Pedagogy"
        title="Your training plan"
        sub="Personalised to your Big Five profile — adapts after every session."
      />

      {/* Demo banner */}
      {IS_DEMO && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <Banner variant="info">
            <div>
              <div className="fg" style={{ fontWeight: 500 }}>
                Demo mode — Adaptive Pedagogy thesis demonstration
              </div>
              <div className="t-cap" style={{ marginTop: 2 }}>
                Two personas (high-N/low-E introvert and low-N/high-E extrovert) will receive
                different strategies and starting difficulties, proving the adaptation thesis end-to-end.
              </div>
            </div>
          </Banner>
        </motion.div>
      )}

      {/* No plan yet */}
      {plan === null && (
        <motion.div variants={fadeInUp}>
          <Card>
            <EmptyState
              icon={Sparkles}
              title="No plan yet"
              description="Generate your personalised training plan based on your personality profile."
              action={
                <>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className="btn btn-primary btn-lg"
                  >
                    <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {generating ? (
                        <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} strokeWidth={1.8} />
                      )}
                      {generating ? 'Generating…' : 'Generate Scenario'}
                    </span>
                  </button>
                  <Link to="/survey/results" className="btn btn-ghost btn-lg">
                    <span className="btn-label">View profile first →</span>
                  </Link>
                </>
              }
            />
            {error && (
              <div style={{ marginTop: 12 }}>
                <Banner variant="danger">{error}</Banner>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Plan loaded */}
      {plan && (
        <div className="col stagger" style={{ gap: 16 }}>
          {plan.generation_status === 'pending' && (
            <Banner variant="warning">Plan is being generated — refresh in a moment.</Banner>
          )}

          <PersonalizationBriefCard brief={plan.brief_json} />
          <BaselineEvidenceCard summary={plan.baseline_summary_json} snapshot={snapshot} />
          <StrategyCard strategy={plan.strategy} difficulty={plan.difficulty} />
          <ScenarioCard scenario={plan.primary_scenario} generationSource={plan.generation_source} />
          <AdjustmentHistorySection history={history} />

          {/* Actions */}
          <motion.div
            variants={fadeInUp}
            style={{ display: 'flex', gap: 12, paddingTop: 8, paddingBottom: 32 }}
          >
            <Link to="/roleplay" className="btn btn-primary btn-lg" style={{ flex: 1 }}>
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Start practice session
                <ArrowRight size={14} strokeWidth={1.8} />
              </span>
            </Link>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="btn btn-secondary btn-lg"
              title="Regenerate training plan"
              aria-label="Regenerate training plan"
            >
              <span className="btn-label">
                {generating ? (
                  <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} strokeWidth={1.8} />
                )}
              </span>
            </button>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
