import { useEffect, useMemo, useState } from 'react'
import gsap from 'gsap'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGsapScope } from '@/components/RPE/feedback/useGsapScope'
import { prefersReducedMotion } from '@/components/RPE/feedback/feedbackTheme'
import HandoffPrompt from './HandoffPrompt'
import './ResponseChoiceCardsV2.css'

/*
 * ResponseChoiceCardsV2 — isolated redesign of ResponseChoiceCards.jsx.
 * Same props, same backend contract, same scoring behavior — only the
 * presentation changes. ResponseChoiceCards.jsx is untouched; V1 keeps
 * using it exactly as before.
 *
 * options: [{ label, text, quality }] — quality is read only to confirm it
 * exists in the data (never displayed, never used for styling).
 */

// Identical Fisher-Yates to the original component (not exported there, so
// duplicated rather than modifying that file) — options always arrive
// strong/adequate/weak ordered; shuffling once per array is what keeps
// position from leaking the backend's own ranking.
function shuffled(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const SEND_DELAY_MS = 320

export default function ResponseChoiceCardsV2({ options, onChoose, submitFailed }) {
  const [sendingIndex, setSendingIndex] = useState(null)
  const displayOptions = useMemo(() => (options ? shuffled(options) : options), [options])

  // A failed sendTurn no longer clears this card set (the parent keeps
  // `interaction` as-is on failure specifically so the exact same 3 options
  // are still here to retry) — but without this, the picked card would be
  // stuck showing "Sending…" forever since nothing else resets it.
  useEffect(() => {
    if (submitFailed) setSendingIndex(null)
  }, [submitFailed])

  const scopeRef = useGsapScope(({ instant }) => {
    const cards = gsap.utils.toArray('.rcc2-card')
    if (instant) { gsap.set(cards, { opacity: 1, y: 0 }); return }
    gsap.fromTo(cards, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out', stagger: 0.09, delay: 0.15 })
  }, [displayOptions])

  if (!displayOptions || displayOptions.length === 0) return null

  const handlePick = (option, index) => {
    if (sendingIndex != null) return // no duplicate selection while one is already in flight
    setSendingIndex(index)
    if (prefersReducedMotion()) {
      onChoose(option)
      return
    }
    setTimeout(() => onChoose(option), SEND_DELAY_MS)
  }

  return (
    <div className="rcc2-wrap" ref={(el) => { scopeRef.current = el }}>
      <HandoffPrompt />

      <div className="rcc2-grid">
        {displayOptions.map((option, i) => {
          const isSending = sendingIndex === i
          const isFaded = sendingIndex != null && sendingIndex !== i
          return (
            <button
              key={i}
              type="button"
              className={cn('rcc2-card', isSending && 'sending', isFaded && 'faded')}
              onClick={() => handlePick(option, i)}
              disabled={sendingIndex != null}
              aria-label={`${option.label}: ${option.text}`}
            >
              <div className="rcc2-card-top">
                <span className="rcc2-card-label">{option.label}</span>
                <ArrowRight size={15} strokeWidth={2} className="rcc2-card-arrow" />
              </div>
              <p className="rcc2-card-text">&ldquo;{option.text}&rdquo;</p>
              {isSending && <span className="rcc2-card-sending">Sending…</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
