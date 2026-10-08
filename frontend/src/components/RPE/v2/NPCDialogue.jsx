import { motion } from 'framer-motion'
import { prefersReducedMotion } from '@/components/RPE/feedback/feedbackTheme'

// The NPC's current line as a floating caption near the bottom of the
// stage — real conversational text, not a chat bubble competing with the
// avatar. Shows the actual latest NPC message from the existing transcript
// state; never invents dialogue.
//
// The caller now owns the "is there anything to show" decision (wrapped in
// <AnimatePresence> with a per-turn `key`, see RolePlaySessionV2.jsx) —
// this component always assumes it's being asked to show a real line, so
// its whole job is presenting that line beautifully: a soft fade + drift
// on the way in, and the same in reverse on the way out, courtesy of
// framer-motion (already a dependency of this codebase — see
// FeedbackDashboard.jsx — not a new one introduced here). Motion is
// skipped in favor of a plain, near-instant opacity change under
// prefers-reduced-motion.
export default function NPCDialogue({ text, npcName, npcEmotion }) {
  const reduced = prefersReducedMotion()

  return (
    <motion.div
      className="rps2-dialogue-zone"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.985 }}
      transition={{ duration: reduced ? 0.12 : 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="rps2-dialogue-bubble" aria-live="polite">
        <p className="rps2-dialogue-meta">
          {npcName}
          {npcEmotion && npcEmotion !== 'neutral' && <span className="rps2-dialogue-emotion"> · {npcEmotion}</span>}
        </p>
        <p className="rps2-dialogue-text">&ldquo;{text}&rdquo;</p>
      </div>
    </motion.div>
  )
}
