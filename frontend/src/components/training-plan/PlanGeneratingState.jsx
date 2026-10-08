import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Brain, Target, Compass, PenLine } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import Card from '@/components/ui/Card'
import Banner from '@/components/ui/Banner'

/**
 * Staged progress for plan generation (an LLM call, so not instant).
 *
 * Honesty note: the backend returns one response with no progress stream, so
 * these stages are OPTIMISTIC and time-driven. They describe work the request
 * genuinely performs, in the order plan_service performs it, and the final
 * stage never flips to "done" on its own — only a real response completes it.
 * If the request outruns the schedule we stop advancing and say so, rather
 * than looping an animation that implies progress isn't happening.
 */

export const STAGES = [
  { id: 'profile', label: 'Reading your personality profile', icon: Brain, atMs: 0 },
  { id: 'goal', label: 'Understanding your goal', icon: Target, atMs: 1800 },
  { id: 'strategy', label: 'Selecting teaching strategy', icon: Compass, atMs: 5000 },
  { id: 'compose', label: 'Composing your plan', icon: PenLine, atMs: 8500 },
]

/** Past this, stop pretending we know what's happening and say we're waiting. */
export const STILL_WORKING_AFTER_MS = 25000

const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

function StageRow({ stage, state, reduceMotion }) {
  const Icon = stage.icon
  const isDone = state === 'done'
  const isActive = state === 'active'

  const color = isDone
    ? 'var(--success)'
    : isActive
    ? 'var(--accent)'
    : 'var(--text-quaternary)'

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        opacity: state === 'pending' ? 0.5 : 1,
        transition: reduceMotion ? 'none' : 'opacity var(--dur-base) var(--ease)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color,
          background: isActive ? 'var(--accent-soft)' : 'var(--bg-elevated)',
          border: `1px solid ${isActive ? 'var(--accent-muted)' : 'var(--border-subtle)'}`,
        }}
      >
        {isDone ? (
          <Check size={13} strokeWidth={2} />
        ) : isActive && !reduceMotion ? (
          <Loader2 size={13} strokeWidth={1.8} className="animate-spin" />
        ) : (
          <Icon size={13} strokeWidth={1.8} />
        )}
      </span>
      <span
        style={{
          fontSize: 14,
          color: isDone || isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
        }}
      >
        {stage.label}
      </span>
    </li>
  )
}

export default function PlanGeneratingState({ startedAt }) {
  const reduceMotion = useReducedMotion()
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(startedAt ?? Date.now())

  useEffect(() => {
    startRef.current = startedAt ?? Date.now()
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 250)
    return () => clearInterval(id)
  }, [startedAt])

  const stillWorking = elapsed >= STILL_WORKING_AFTER_MS

  // The last stage stays "active" forever — only a real response ends it.
  const activeIndex = useMemo(() => {
    let index = 0
    for (let i = 0; i < STAGES.length; i += 1) {
      if (elapsed >= STAGES[i].atMs) index = i
    }
    return index
  }, [elapsed])

  const activeLabel = STAGES[activeIndex]?.label ?? ''

  return (
    <Card>
      <div style={{ marginBottom: 6 }}>
        <div className="t-h3" style={{ margin: 0 }}>
          Building your plan
        </div>
        <p className="t-cap" style={{ marginTop: 4 }}>
          This takes a few seconds — we're combining your goal with your personality profile.
        </p>
      </div>

      {/* Decorative: the single live region below is what gets announced. */}
      <ul
        style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}
        aria-hidden="true"
      >
        {STAGES.map((stage, i) => (
          <StageRow
            key={stage.id}
            stage={stage}
            state={i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending'}
            reduceMotion={reduceMotion}
          />
        ))}
      </ul>

      <span
        aria-live="polite"
        aria-busy="true"
        style={VISUALLY_HIDDEN}
      >
        {stillWorking ? 'Still working on your plan' : activeLabel}
      </span>

      {stillWorking && (
        <div style={{ marginTop: 14 }}>
          <Banner variant="warning">
            <div className="fg" style={{ fontWeight: 500 }}>
              Still working…
            </div>
            <div className="t-cap" style={{ marginTop: 2 }}>
              This is taking longer than usual. Your request is still running — leaving this
              page will cancel it.
            </div>
          </Banner>
        </div>
      )}
    </Card>
  )
}
