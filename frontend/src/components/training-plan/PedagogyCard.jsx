import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { GraduationCap, ChevronDown } from 'lucide-react'
import { fadeInUp } from '@/lib/animations'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import CardHeader from './CardHeader'
import {
  COMPLEXITY_LABEL,
  FEEDBACK_LABEL,
  KOLB_LABEL,
  NPC_LABEL,
  PACING_LABEL,
  SUPPORT_LABEL,
  TONE_LABEL,
  humanise,
} from './constants'

function StrategyChip({ label, value, variant = 'neutral' }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="t-over">{label}</span>
      <span style={{ width: 'fit-content' }}>
        <Badge variant={variant}>{value}</Badge>
      </span>
    </div>
  )
}

/**
 * The "show your working" panel — collapsible, useful in a viva.
 * Renders the teaching strategy, support level, ZPD rationale, Kolb stage and
 * formative checkpoints the backend chose.
 */
export default function PedagogyCard({ pedagogy, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!pedagogy) return null

  const strategy = pedagogy.teaching_strategy ?? {}
  const bodyId = 'pedagogy-card-body'

  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          style={{
            width: '100%',
            background: 'transparent',
            border: 0,
            padding: 0,
            color: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <CardHeader
            icon={GraduationCap}
            title="How this plan teaches"
            right={
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  color: 'var(--text-tertiary)',
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform var(--dur-fast) var(--ease)',
                }}
              >
                <ChevronDown size={16} strokeWidth={1.6} />
              </span>
            }
          />
        </button>

        <p className="t-cap" style={{ margin: 0, lineHeight: 1.55 }}>
          {SUPPORT_LABEL[pedagogy.support_level] ?? humanise(pedagogy.support_level)} support ·{' '}
          {KOLB_LABEL[pedagogy.kolb_stage_focus] ?? humanise(pedagogy.kolb_stage_focus)}
        </p>

        {open && (
          <div id={bodyId}>
            <div className="divider" style={{ margin: '16px 0' }} />

            <div className="grid-2" style={{ gap: '12px 16px' }}>
              <StrategyChip label="Tone" value={TONE_LABEL[strategy.tone] ?? strategy.tone} />
              <StrategyChip label="Pacing" value={PACING_LABEL[strategy.pacing] ?? strategy.pacing} />
              <StrategyChip
                label="Complexity"
                value={COMPLEXITY_LABEL[strategy.complexity] ?? strategy.complexity}
              />
              <StrategyChip
                label="Partner style"
                value={NPC_LABEL[strategy.npc_personality] ?? strategy.npc_personality}
              />
              <StrategyChip
                label="Feedback"
                value={FEEDBACK_LABEL[strategy.feedback_style] ?? strategy.feedback_style}
              />
              <StrategyChip
                label="Support level"
                value={SUPPORT_LABEL[pedagogy.support_level] ?? humanise(pedagogy.support_level)}
              />
            </div>

            {pedagogy.hint_policy && (
              <>
                <div className="divider" style={{ margin: '16px 0' }} />
                <div className="t-over" style={{ marginBottom: 6 }}>
                  Hint policy
                </div>
                <p className="t-cap" style={{ margin: 0, lineHeight: 1.55 }}>
                  {pedagogy.hint_policy}
                </p>
              </>
            )}

            {pedagogy.zpd_rationale && (
              <>
                <div className="divider" style={{ margin: '16px 0' }} />
                <div className="t-over" style={{ marginBottom: 6 }}>
                  Why this difficulty
                </div>
                <p className="t-cap" style={{ margin: 0, lineHeight: 1.55 }}>
                  {pedagogy.zpd_rationale}
                </p>
              </>
            )}

            {pedagogy.formative_checkpoints?.length > 0 && (
              <>
                <div className="divider" style={{ margin: '16px 0' }} />
                <div className="t-over" style={{ marginBottom: 8 }}>
                  Checkpoints during the session
                </div>
                <ol
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {pedagogy.formative_checkpoints.map((c, i) => (
                    <li key={i} className="t-cap" style={{ lineHeight: 1.55 }}>
                      {c}
                    </li>
                  ))}
                </ol>
              </>
            )}

            {strategy.rationale?.length > 0 && (
              <>
                <div className="divider" style={{ margin: '16px 0' }} />
                <p className="t-cap" style={{ lineHeight: 1.55, margin: 0 }}>
                  <span className="fg" style={{ fontWeight: 500 }}>
                    Derived from:{' '}
                  </span>
                  {strategy.rationale.join(' · ')}
                </p>
              </>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  )
}
