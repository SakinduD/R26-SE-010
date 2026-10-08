import { AlertTriangle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * ConversationStateIndicatorV2 — the ONE compact "whose turn is it / what's
 * happening" cue for the live session (spec: "Do not place multiple
 * competing status labels around the screen"). Sits in a fixed slot between
 * the stage and the dialogue/panel area, always mounted whenever the
 * session isn't complete, so its height never causes a layout jump —only
 * its label/tone changes.
 *
 * Pure presentation: every value it renders is derived from state
 * RolePlaySessionV2.jsx already owns (voiceState, isListening,
 * isTranscribing, userInput, interaction.type) — see that file's
 * `conversationState` useMemo for the mapping. Nothing here invents a
 * signal that isn't already real.
 */

// Text is natural-case here; the visual all-caps treatment ("YOUR TURN",
// "SPEAKING", ...) is a CSS text-transform on .rps2-state-indicator, same
// convention as .rps2-npc-role/.rps2-dialogue-meta elsewhere in this page —
// keeps the strings themselves grep-able/sentence-cased in code.
const STATE_META = {
  ready:        { label: 'Your turn', dot: 'ready', emphasize: true },
  listening:    { label: 'Listening', dot: 'live' },
  transcribing: { label: 'Transcribing', dot: 'pulse' },
  review:       { label: 'Review response', dot: null },
  processing:   { label: 'Thinking…', dot: 'pulse' },
  reacting:     { label: 'Considering your response', dot: 'pulse' },
  speaking:     { label: 'Speaking', dot: 'live' },
  // Action-oriented, not "Handoff request" — this state covers every
  // deliverable_choice turn (committing to a deadline, negotiating a
  // dependency, agreeing to send a document, ...), and the backend has no
  // field distinguishing which of those it is. See HandoffPrompt.jsx's own
  // comment for the same reasoning applied to the cards themselves.
  choice:       { label: 'Choose your response', dot: null, icon: true },
  content:      { label: 'Provide the content', dot: null, icon: true },
  directInput:  { label: 'Respond', dot: null, icon: true },
}

export default function ConversationStateIndicatorV2({ state, errorMessage, onRetry }) {
  if (errorMessage) {
    return (
      <div className="rps2-state-indicator error" role="alert">
        <AlertTriangle size={13} strokeWidth={2} aria-hidden />
        <span>{errorMessage}</span>
        <button type="button" className="rps2-state-retry" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  const meta = STATE_META[state]
  if (!meta) return <div className="rps2-state-indicator empty" aria-hidden />

  return (
    <div className={cn('rps2-state-indicator', meta.emphasize && 'emphasize')} aria-live="polite">
      {meta.icon && <Sparkles size={12} strokeWidth={2} aria-hidden />}
      {meta.dot === 'live' && <span className="rps2-state-dot live" aria-hidden />}
      {meta.dot === 'pulse' && (
        <span className="rps2-state-dots" aria-hidden><span /><span /><span /></span>
      )}
      <span>{meta.label}</span>
    </div>
  )
}
