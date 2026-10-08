import { useCallback, useEffect, useState } from 'react'

// Shared "show this tour exactly once per browser" trigger — mirrors
// AppLayout's sidebar tour (frontend/src/pages/app/AppLayout.jsx), which is
// the one implementation of this that's actually held up: the seen-flag is
// set the moment the tour is about to run, not only once the learner
// finishes or skips it. The RPE/Dashboard tours originally only marked
// "seen" on a clean finish/skip callback, so navigating away mid-tour (the
// far more common way to leave one — clicking into a scenario, say) never
// set it, and the tour reappeared every visit after that. Setting it
// up-front like the sidebar does fixes that regardless of how the tour ends.
//
// User-scoped (falling back to a shared "guest" bucket when signed out) so
// different accounts on the same browser don't inherit each other's seen
// state — same reasoning as the sidebar's tourSeenKey().
export function useOnceTour({ storagePrefix, email, ready = true }) {
  const [run, setRun] = useState(false)

  useEffect(() => {
    if (!ready) return
    const key = `${storagePrefix}:${email || 'guest'}`
    try {
      if (localStorage.getItem(key) === 'true') return
      localStorage.setItem(key, 'true')
    } catch {
      return
    }
    setRun(true)
  }, [ready, storagePrefix, email])

  const stop = useCallback(() => setRun(false), [])

  return [run, stop]
}
