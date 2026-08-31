import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from './feedbackTheme'

// Scopes a GSAP animation to a container ref and cleans it up on unmount —
// the standard gsap.context() + React effect pairing, so every feedback
// component doesn't hand-roll its own kill()/revert() bookkeeping.
//
// `build({ instant })` runs once per mount (or whenever `deps` change),
// with gsap's own selector scoping active (`gsap.utils.selector` via the
// context) so it can safely use plain className selectors without leaking
// into the rest of the page. Everything it creates (tweens, timelines) is
// reverted automatically on cleanup.
//
// When the user has reduced motion on, `build` still runs (so any DOM
// prep/measurement still happens) but receives `instant: true` — a
// component should use gsap.set(...) instead of gsap.to(...)/from(...) in
// that branch to land directly on the end state, rather than skipping the
// effect entirely and leaving initial opacity:0/scale:0 styles stuck.
export function useGsapScope(build, deps = []) {
  const scopeRef = useRef(null)
  useEffect(() => {
    if (!scopeRef.current) return undefined
    const reduced = prefersReducedMotion()
    const ctx = gsap.context(() => build({ instant: reduced }), scopeRef)
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return scopeRef
}
