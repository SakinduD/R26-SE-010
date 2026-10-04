import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '@/components/RPE/feedback/feedbackTheme'
import { getEnvironment, RPE_ENVIRONMENTS } from '@/lib/rpe/sceneEnvironments'
import './SceneEnvironmentV2.css'

/*
 * SceneEnvironmentV2 — cinematic 2.5D backdrop for the RPE V2 stage.
 *
 * Presentation only: no session/scoring logic lives here. Renders behind
 * the existing <TalkingHeadAvatar> (transparent-canvas rendering, confirmed
 * against the current build — the stage background was already visible
 * around the character before this component existed) and reacts to a
 * handful of already-real session values passed in as props — trust,
 * tension, npc emotion, speaking/turn state — never anything invented.
 *
 * Background is now the real generated photography in
 * public/rpe-background/ (see sceneEnvironments.js for the per-preset
 * paths/treatment values) — a <picture> with a smaller mobile source,
 * filtered (brightness/saturate/contrast/blur) rather than shown raw, plus
 * a soft off-center vignette, an ambient trust-driven light, an avatar
 * grounding shadow and a very subtle npc-emotion tint on top. If the image
 * fails to load, EnvironmentBackground falls back to a plain dark
 * charcoal/navy gradient — no broken-image icon, session keeps working.
 *
 * Layering (back to front, all behind the avatar):
 *   photo -> dark/light gradient grade -> window-adjacent ambient light ->
 *   avatar grounding shadow -> vignette -> npc-emotion tint
 */

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => prefersReducedMotion())
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setReduced(mq.matches)
    mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler)
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', handler) : mq.removeListener(handler)
    }
  }, [])
  return reduced
}

// Small, cheap parallax — only on fine-pointer devices, only when motion is
// allowed. Moves the background photo a few px toward the cursor; never
// touches the avatar itself.
function useParallax(reduced) {
  const rootRef = useRef(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (reduced || !window.matchMedia) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const el = rootRef.current
    if (!el) return

    let raf = null
    const handleMove = (e) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = null
        const rect = el.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
        const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
        setOffset({ x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) })
      })
    }
    const handleLeave = () => setOffset({ x: 0, y: 0 })

    el.addEventListener('mousemove', handleMove)
    el.addEventListener('mouseleave', handleLeave)
    return () => {
      el.removeEventListener('mousemove', handleMove)
      el.removeEventListener('mouseleave', handleLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [reduced])

  return [rootRef, offset]
}

function EnvironmentBackground({ environment }) {
  const [failed, setFailed] = useState(false)
  // Reset the failure flag when the preset itself changes (e.g. dev debug
  // selector, or a future scenario-driven environment change) so a bad
  // load on one preset doesn't permanently blank out every other one.
  useEffect(() => setFailed(false), [environment.id])

  if (!environment.backgroundImage || failed) {
    return <div className="scn-sky scn-sky-fallback" />
  }

  return (
    <picture className="scn-sky">
      {environment.backgroundImageMobile && (
        <source media="(max-width: 720px)" srcSet={environment.backgroundImageMobile} />
      )}
      <img
        className="scn-sky-photo"
        src={environment.backgroundImage}
        alt=""
        aria-hidden="true"
        loading="eager"
        fetchpriority="high"
        decoding="async"
        style={{ objectPosition: environment.backgroundPosition || '50% 40%' }}
        onError={() => setFailed(true)}
      />
    </picture>
  )
}

export default function SceneEnvironmentV2({
  environmentId,
  npcEmotion = 'neutral',
  npcSpeaking = false,
  trust = 50,
  tension = 0,
  sessionState = 'manual',
}) {
  const environment = getEnvironment(environmentId)
  const reduced = useReducedMotion()
  const [rootRef, parallax] = useParallax(reduced)

  const vars = {
    '--scn-vignette': environment.vignette,
    '--scn-blur': `${environment.blur}px`,
    '--scn-brightness': environment.brightness,
    '--scn-saturate': environment.saturate,
    '--scn-contrast': environment.contrast,
    '--scn-trust': trust,
    '--scn-tension': tension,
    '--scn-px': parallax.x,
    '--scn-py': parallax.y,
  }

  return (
    <div
      ref={rootRef}
      className="scn-root"
      data-environment={environment.id}
      data-session-state={sessionState}
      data-npc-emotion={npcEmotion}
      data-speaking={npcSpeaking ? 'true' : undefined}
      data-motion={environment.ambientMotion}
      aria-hidden="true"
      style={vars}
    >
      <div className="scn-layers">
        <EnvironmentBackground environment={environment} />
        <div className="scn-grade" />
        <div className="scn-light" />
        <div className="scn-grounding" />
        <div className="scn-vignette" />
        <div className="scn-emotion-tint" />
      </div>
    </div>
  )
}

// Dev-only environment override control — per the spec's "development-only
// environment selector" ask. Renders nothing in a production build
// (import.meta.env.DEV is statically false there, so Vite drops the whole
// branch). Used two places: RolePlaySessionV2 itself (a real live session,
// gated behind DEV) and EnvironmentPreviewDev (a standalone no-auth-needed
// preview route used to visually tune this file without a logged-in
// session — see that file for why that route exists at all).
export function EnvironmentDebugPanel({ value, onChange }) {
  if (!import.meta.env.DEV) return null
  return (
    <div className="scn-debug" role="group" aria-label="Environment debug">
      <span className="scn-debug-title">Environment debug</span>
      <div className="scn-debug-row">
        {Object.values(RPE_ENVIRONMENTS).map((env) => (
          <button
            key={env.id}
            type="button"
            className={`scn-debug-btn${value === env.id ? ' active' : ''}`}
            onClick={() => onChange(env.id)}
          >
            {env.label}
          </button>
        ))}
        <button
          type="button"
          className={`scn-debug-btn${value == null ? ' active' : ''}`}
          onClick={() => onChange(null)}
        >
          Auto
        </button>
      </div>
    </div>
  )
}
