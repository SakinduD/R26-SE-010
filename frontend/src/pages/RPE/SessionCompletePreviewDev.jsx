import { useEffect } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import SessionComplete from './SessionComplete'

/*
 * SessionCompletePreviewDev — dev-only visual QA aid for SessionComplete.jsx.
 * That page only renders real content when it receives router state from an
 * actual finished session (RolePlaySession.jsx / RolePlaySessionV2.jsx's
 * navigate() call) — there's no way to land on it fresh without one, and
 * its real route (/roleplay/session/complete) sits inside AppLayout, which
 * requires a logged-in session.
 *
 * This renders the real, unmodified SessionComplete component directly, on
 * this dev-only route instead (outside AppLayout — no auth needed), after
 * attaching the same nav-state shape a real session hand-off would via a
 * same-URL history replace. Registered in App.jsx behind
 * import.meta.env.DEV, same as EnvironmentPreviewDev — stripped from
 * production builds.
 *
 * Usage: /dev/session-complete-preview?variant=success|npc_exit|ended_by_user|max_turns_success|max_turns_failure
 */

const PREVIEW_SESSION_ID = 'dev-preview-session'

const VARIANTS = {
  success: {
    trustScore: 82, escalationLevel: 1, outcome: 'success',
    endReason: 'trust_sustained', currentTurn: 6, recommendedTurns: 8,
  },
  npc_exit: {
    trustScore: 22, escalationLevel: 5, outcome: 'failure',
    endReason: 'npc_exit', currentTurn: 4, recommendedTurns: 8,
  },
  ended_by_user: {
    trustScore: 48, escalationLevel: 2, outcome: 'ended_by_user',
    endReason: 'user_exit_intent', currentTurn: 3, recommendedTurns: 8,
  },
  max_turns_success: {
    trustScore: 71, escalationLevel: 2, outcome: 'success',
    endReason: 'max_turns_reached', currentTurn: 8, recommendedTurns: 8, maxTurns: 8,
  },
  max_turns_failure: {
    trustScore: 39, escalationLevel: 3, outcome: 'failure',
    endReason: 'max_turns_reached', currentTurn: 8, recommendedTurns: 8, maxTurns: 8,
  },
}

export default function SessionCompletePreviewDev() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const variantKey = params.get('variant') || 'success'
  const variant = VARIANTS[variantKey] || VARIANTS.success

  useEffect(() => {
    // "." alone resolves to just the pathname and silently drops the
    // ?variant= query string from the URL on this replace — keep the
    // search string explicit so switching ?variant= actually takes effect
    // instead of freezing on whichever variant first mounted this route.
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: {
        sessionId: PREVIEW_SESSION_ID,
        scenarioTitle: 'Difficult Feedback: Missed Deadline',
        npcRole: 'Manager',
        totalTurns: 8,
        ...variant,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantKey])

  if (location.state?.sessionId !== PREVIEW_SESSION_ID) return null
  return <SessionComplete />
}
