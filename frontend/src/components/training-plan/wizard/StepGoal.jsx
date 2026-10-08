import React, { useRef } from 'react'
import Card from '@/components/ui/Card'
import ChipToggle from '@/components/ui/ChipToggle'
import { GOAL_TEXT_MAX, GOAL_TEXT_MIN } from '@/lib/validation/trainingPlan'

/**
 * Starter sentences, not a taxonomy. Each chip drops an editable sentence into
 * the textarea; the learner is expected to rewrite it in their own words, and
 * nothing downstream keys off which chip was used.
 */
export const PRESETS = [
  {
    label: 'Giving difficult feedback',
    text: "I want to practise giving difficult feedback to someone on my team who isn't meeting expectations.",
  },
  {
    label: 'Pushing back on scope creep',
    text: 'I want to practise pushing back on my manager when scope creeps mid-sprint.',
  },
  {
    label: 'Salary negotiation',
    text: 'I want to practise negotiating my salary when my manager says the budget is already fixed.',
  },
  {
    label: 'Presenting to senior stakeholders',
    text: 'I want to practise presenting my work to senior stakeholders who interrupt with hard questions.',
  },
  {
    label: 'Handling an upset client',
    text: 'I want to practise handling a client who is upset that we missed a delivery date.',
  },
  {
    label: 'Saying no to extra work',
    text: "I want to practise saying no to extra work when I'm already at capacity.",
  },
  {
    label: 'Disagreeing in a team meeting',
    text: 'I want to practise disagreeing with a teammate in a meeting without making it personal.',
  },
  {
    label: 'Owning a mistake',
    text: 'I want to practise owning a mistake I made in front of my team without over-apologising.',
  },
]

export default function StepGoal({ value, onChange, error, headingRef }) {
  const textareaRef = useRef(null)
  const count = value?.length ?? 0
  const tooShort = count > 0 && count < GOAL_TEXT_MIN
  const tooLong = count > GOAL_TEXT_MAX

  const counterColor = tooLong
    ? 'var(--danger)'
    : tooShort
    ? 'var(--warning)'
    : 'var(--text-tertiary)'

  const applyPreset = (text) => {
    onChange(text)
    // Drop the caret at the end so the learner can keep typing straight away.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(text.length, text.length)
    })
  }

  return (
    <Card>
      <h2 ref={headingRef} tabIndex={-1} className="t-h2" style={{ margin: 0, outline: 'none' }}>
        What do you want to practise?
      </h2>
      <p className="t-cap" style={{ marginTop: 6, marginBottom: 18, lineHeight: 1.55 }}>
        Describe the situation in your own words — who's involved, what makes it hard. The more
        specific you are, the better we can shape it.
      </p>

      <div className="field">
        <label htmlFor="goal_text" className="field-label">
          Your goal
        </label>
        <textarea
          id="goal_text"
          name="goal_text"
          ref={textareaRef}
          className="input textarea"
          style={{ minHeight: 132 }}
          rows={5}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={GOAL_TEXT_MAX + 50}
          placeholder="e.g. I want to practise pushing back on my manager when scope creeps mid-sprint."
          data-error={error ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby="goal_text_counter goal_text_error"
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'baseline',
          }}
        >
          <span id="goal_text_error" role="alert" className="field-error" style={{ minHeight: 16 }}>
            {error || ''}
          </span>
          <span
            id="goal_text_counter"
            className="t-cap"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: counterColor }}
            aria-live="polite"
          >
            {count}/{GOAL_TEXT_MAX}
            {tooShort ? ` · ${GOAL_TEXT_MIN - count} more` : ''}
          </span>
        </div>
      </div>

      <div className="divider" style={{ margin: '18px 0 14px' }} />

      <div className="t-over" style={{ marginBottom: 10 }}>
        Need a starting point?
      </div>
      <div
        role="group"
        aria-label="Starter sentences"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
      >
        {PRESETS.map((preset) => (
          <ChipToggle key={preset.label} onClick={() => applyPreset(preset.text)}>
            {preset.label}
          </ChipToggle>
        ))}
      </div>
      <p className="t-cap" style={{ marginTop: 10, marginBottom: 0 }}>
        These just fill the box with a sentence you can edit — you're not locked into any of them.
      </p>
    </Card>
  )
}
