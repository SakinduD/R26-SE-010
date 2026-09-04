import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import TrustMicroIndicator from './TrustMicroIndicator'

// 'choice' = a ResponseChoiceCardsV2 pick (label is the option's own
// label). 'content' = actual user-typed/pasted content via
// ContentRequestInputV2 (label is a generic contentType-derived phrase,
// never a fabricated specific title) — kept visually distinct so a real
// paragraph the learner pasted is never mistaken for "chose a suggested
// reply", and never represented as a file attachment either (there is no
// file upload system here — see ContentRequestInputV2's own header comment).
//
// 'choice' kicker reads "Response", not "Handoff" — this covers every
// deliverable_choice pick regardless of what it's actually about
// (deadline commitment, dependency negotiation, agreeing to send a
// document, ...) and the backend has no field distinguishing which. See
// HandoffPrompt.jsx's own comment for the same reasoning.
const TURN_KIND_KICKER = { choice: 'Response', content: 'Content provided' }

// One reconstructed exchange — the NPC line this turn opened with, and the
// learner's reply to it. Deliberately NOT a chat bubble pair: editorial
// blocks, NPC left-aligned / YOU right-aligned so the alternation is
// scannable at a glance, comfortable reading width, turn number small and
// out of the way. Forwards its ref so ConversationReplayV2 can scroll a
// specific turn into view (Important Moments / trust sparkline clicks).
const ConversationTurnV2 = forwardRef(function ConversationTurnV2({
  turnNumber, npcMessage, npcEmotion, npcName, userMessage, deliverableLabel, turnKind,
  mode, markers, trust, previousTrust, direction, explanation, isTyping,
  selectable, selected, highlighted, onSelect,
}, ref) {
  const Wrapper = selectable ? 'button' : 'div'
  const wrapperProps = selectable
    ? { type: 'button', onClick: onSelect, 'aria-pressed': selected }
    : {}

  return (
    <Wrapper
      ref={ref}
      className={cn('crv2-turn', selected && 'selected', selectable && 'selectable', highlighted && 'flash')}
      {...wrapperProps}
    >
      <div className="crv2-turn-marker" aria-hidden>
        <span className="crv2-turn-dot" />
      </div>

      <div className="crv2-turn-body">
        {turnNumber != null && <p className="crv2-turn-number">Turn {String(turnNumber).padStart(2, '0')}</p>}

        {npcMessage && (
          <div className="crv2-block npc">
            <p className="crv2-block-role">
              {npcName}{npcEmotion && npcEmotion !== 'neutral' ? <span className="crv2-emotion"> · {npcEmotion}</span> : null}
            </p>
            <p className="crv2-block-text">&ldquo;{npcMessage}&rdquo;</p>
          </div>
        )}

        {userMessage && (
          <div className="crv2-block user">
            <p className="crv2-block-role">You</p>
            {deliverableLabel && (
              <p className={cn('crv2-handoff-tag', turnKind === 'content' && 'content')}>
                <span className="crv2-handoff-kicker">{TURN_KIND_KICKER[turnKind] || 'Response'}</span>
                {deliverableLabel}
              </p>
            )}
            <p className="crv2-block-text">&ldquo;{userMessage}&rdquo;</p>

            {mode === 'replay' && markers && markers.length > 0 && (
              <div className="crv2-markers">
                {markers.map((m, i) => (
                  <span key={i} className={`crv2-marker ${m.tone}`}>{m.symbol} {m.text}</span>
                ))}
              </div>
            )}

            {mode === 'replay' && trust != null && (
              <TrustMicroIndicator value={trust} previous={previousTrust} direction={direction} />
            )}
          </div>
        )}

        {isTyping && (
          <div className="crv2-block npc">
            <p className="crv2-block-role">{npcName}</p>
            <div className="crv2-typing"><span /><span /><span /></div>
          </div>
        )}

        {selected && explanation && (
          <div className="crv2-why">
            <p className="crv2-why-label">Why this mattered</p>
            <p className="crv2-why-text">{explanation}</p>
          </div>
        )}
      </div>
    </Wrapper>
  )
})

export default ConversationTurnV2
