import { useEffect, useId, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import './ContentRequestInputV2.css'

/*
 * ContentRequestInputV2 — the direct-input counterpart to
 * ResponseChoiceCardsV2, for the other interaction type: the NPC demanding
 * actual, literal content ("paste the exact paragraph", "what's the exact
 * filename") rather than a communication decision. See
 * frontend/src/lib/rpe/interaction.js for why these are two different
 * interactions and never the same UI.
 *
 * This component owns ONLY presentation + local validation/submit-guard
 * state. It never talks to rpeService itself — the caller's onSubmit is
 * expected to feed the exact, untouched (only trimmed) text straight into
 * the same handleSendWithText -> rpeService.sendTurn() pipeline every other
 * reply uses, so scoring evaluates the user's real content, never a label
 * or a placeholder.
 *
 * IMPORTANT: this is text input, not a file upload. There is no file
 * upload system in this session — the transcript must never represent a
 * typed/pasted answer as an attached file (see RolePlaySessionV2.jsx's
 * turnKind: 'content' vs 'handoff', and ConversationTurnV2's "Content
 * provided" kicker vs "Handoff").
 *
 * contentType picks the input shape:
 *   paragraph | section | evidence | long_text  -> textarea
 *   filename  | number  | short_text            -> single-line input
 *
 * Props: prompt, contentType, onSubmit(text), onCancel?, disabled?, maxLength?
 */

const TEXTAREA_TYPES = new Set(['paragraph', 'section', 'evidence', 'long_text'])
const DIRECT_INPUT_TYPES = new Set(['filename', 'number', 'short_text'])

const EYEBROW = {
  paragraph: 'Content request', section: 'Content request',
  evidence: 'Content request', long_text: 'Content request',
  filename: 'Direct request', number: 'Direct request', short_text: 'Direct request',
}

const DEFAULT_MAX_LENGTH = { textarea: 1200, input: 200 }

export default function ContentRequestInputV2({
  prompt, contentType, onSubmit, onCancel, disabled = false, maxLength, submitFailed,
}) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fieldId = useId()

  // A failed sendTurn no longer clears this interaction (the parent keeps
  // `interaction` as-is specifically so the learner's typed/pasted text —
  // still sitting in `value` below, untouched — doesn't have to be
  // retyped) — but without this, the Send button would be stuck reading
  // "Sending…" forever since nothing else resets `submitting`.
  useEffect(() => {
    if (submitFailed) setSubmitting(false)
  }, [submitFailed])

  const isTextarea = TEXTAREA_TYPES.has(contentType) || !DIRECT_INPUT_TYPES.has(contentType)
  const limit = maxLength ?? (isTextarea ? DEFAULT_MAX_LENGTH.textarea : DEFAULT_MAX_LENGTH.input)
  const trimmedLength = value.trim().length
  const isDisabled = disabled || submitting
  const canSend = trimmedLength > 0 && !isDisabled

  const handleSubmit = () => {
    if (!canSend) return
    setSubmitting(true)
    onSubmit(value.trim())
  }

  const handleTextareaKeyDown = (e) => {
    // Enter inserts a newline (this is often literally pasted multiline
    // text) — Cmd/Ctrl+Enter is the submit shortcut, matching the common
    // "compose box" convention instead of forcing a mouse click.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }
  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="crq2-wrap">
      <div className="crq2-prompt">
        <p className="crq2-prompt-eyebrow">{EYEBROW[contentType] || 'Content request'}</p>
        <p className="crq2-prompt-question">{prompt}</p>
      </div>

      <div className={cn('crq2-field', isDisabled && 'disabled')}>
        {isTextarea ? (
          <textarea
            id={fieldId}
            className="crq2-textarea"
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, limit))}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Type or paste it here…"
            maxLength={limit}
            disabled={isDisabled}
            aria-label={prompt}
            autoFocus
          />
        ) : (
          <input
            id={fieldId}
            type="text"
            inputMode={contentType === 'number' ? 'numeric' : 'text'}
            className="crq2-input"
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, limit))}
            onKeyDown={handleInputKeyDown}
            placeholder="Type it here…"
            maxLength={limit}
            disabled={isDisabled}
            aria-label={prompt}
            autoFocus
          />
        )}
        <span className="crq2-count">{value.length} / {limit}</span>
      </div>

      <div className="crq2-actions">
        {onCancel && (
          <button type="button" className="crq2-cancel" onClick={onCancel} disabled={isDisabled}>
            Cancel
          </button>
        )}
        <button type="button" className="crq2-send" onClick={handleSubmit} disabled={!canSend}>
          {submitting ? 'Sending…' : (
            <>
              {isTextarea ? 'Send content' : 'Send'}
              <ArrowRight size={15} strokeWidth={2} />
            </>
          )}
        </button>
      </div>
    </div>
  )
}
