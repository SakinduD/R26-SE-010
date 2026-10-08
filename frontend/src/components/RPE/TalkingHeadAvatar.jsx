/*
 * TalkingHeadAvatar.jsx
 * Wraps the TalkingHead class (@met4citizen/talkinghead) for the RPE
 * roleplay session — renders the 3D NPC avatar and drives its lip sync,
 * mood, and gestures.
 *
 * IMPORTANT: TalkingHead owns its own Three.js scene/renderer/canvas.
 * Do NOT place this inside a React Three Fiber <Canvas>, and do not import
 * from @react-three/fiber or @react-three/drei here — there is no R3F
 * anywhere in this project, and TalkingHead does not need it.
 *
 * The `head` instance is exposed to the parent via the onReady callback.
 * The parent (RolePlaySession.jsx) stores it in a ref and calls methods
 * on it directly (speakText, setMood, playGesture, startListening, ...) —
 * this component does not re-expose those as props, it only owns mounting,
 * loading, and error states for the avatar itself.
 */
import { TalkingHead } from '@met4citizen/talkinghead'
import { useRef, useEffect, useState } from 'react'
import { API_URL } from '@/lib/config'

export default function TalkingHeadAvatar({
  onReady,
  onError,
  className,
  avatarUrl,
  avatarBody = 'F',
  ttsVoice = 'en-GB-Neural2-C',
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const containerRef = useRef(null)
  const headRef = useRef(null)
  const disposeTimerRef = useRef(null)

  useEffect(() => {
    // This app renders under <React.StrictMode>, which in dev mounts ->
    // cleans up -> re-mounts every component once, synchronously. A naive
    // effect would create a second TalkingHead + start a second concurrent
    // GLTF load, which races the first load's teardown and crashes
    // TalkingHead's own loader pipeline ("Cannot read properties of
    // undefined (reading 'clone')"), or — if disposal is merely delayed —
    // leaves the canvas in a broken, wrongly-sized state.
    //
    // Fix: never let there be two in-flight loads. headRef persists across
    // the double-invoke (same component instance, refs aren't reset), so
    // the second invocation sees a head already exists and reuses it
    // instead of creating a new one. The first invocation's cleanup
    // schedules disposal one tick out instead of disposing synchronously;
    // the second invocation cancels that pending disposal before deciding
    // whether to create anything. Only a real unmount (no immediate
    // remount to cancel the timer) actually disposes.
    if (disposeTimerRef.current) {
      clearTimeout(disposeTimerRef.current)
      disposeTimerRef.current = null
    }

    let cancelled = false
    let rafId = null
    let showAvatarTimerId = null

    if (!headRef.current) {
      // TalkingHead's constructor does real synchronous WebGL work (a
      // renderer + PMREM environment-map generation), and showAvatar()
      // follows up with GLTF parsing and morph-target setup. Run back to
      // back on mount, that's one long uninterrupted block of the main
      // thread — long enough that the browser can show its own "Page
      // Unresponsive" prompt before the loading screen has even painted.
      // Deferring construction past the next paint (rAF), then yielding
      // once more before showAvatar (setTimeout 0), splits that into two
      // shorter chunks with a real paint/input opportunity between them.
      rafId = requestAnimationFrame(() => {
        if (cancelled) return

        const head = new TalkingHead(containerRef.current, {
          // Relative "/api/gtts" resolves against the Vite dev server, not
          // the backend — this app has no dev proxy and always talks to the
          // API via an absolute VITE_API_BASE_URL (see src/lib/config.js),
          // so the TTS proxy is addressed the same way everything else in
          // RPE is.
          ttsEndpoint: `${API_URL}/api/gtts`,
          ttsRate: 1.15,
          cameraView: 'upper',
          cameraRotateEnable: false,
          cameraZoomEnable: false,
          avatarMood: 'neutral',
          lipsyncModules: ['en'],
        })
        headRef.current = head

        showAvatarTimerId = setTimeout(() => {
          if (cancelled || headRef.current !== head) return

          head.showAvatar(
            {
              url: avatarUrl ?? import.meta.env.VITE_AVATAR_URL ?? '/avatar.glb',
              body: avatarBody,
              baseline: 'M',
              ttsLang: 'en-GB',
              ttsVoice,
              lipsyncLang: 'en',
            },
            (event) => {
              if (import.meta.env.DEV) {
                console.log('[TalkingHeadAvatar] load event:', event)
              }
            }
          )
            .then(() => {
              // headRef.current will have been cleared (real unmount) or
              // replaced (shouldn't happen — we never create a second head
              // while one exists) if this load is no longer the live one.
              if (headRef.current !== head) return
              setIsLoading(false)
              onReady?.(head)
            })
            .catch((err) => {
              console.error('[TalkingHeadAvatar] failed to load avatar:', err)
              if (headRef.current !== head) return
              setHasError(true)
              setIsLoading(false)
              onError?.(err)
            })
        }, 0)
      })
    }

    return () => {
      cancelled = true
      if (rafId != null) cancelAnimationFrame(rafId)
      if (showAvatarTimerId != null) clearTimeout(showAvatarTimerId)
      disposeTimerRef.current = setTimeout(() => {
        headRef.current?.dispose()
        headRef.current = null
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {isLoading && (
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--overlay-toast-bg, rgba(13,17,23,0.6))',
          }}
        >
          <span
            className="animate-pulse"
            style={{ color: 'var(--text-med, #8B949E)', fontSize: 13, fontWeight: 600 }}
          >
            Loading character…
          </span>
        </div>
      )}

      {hasError && (
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--overlay-toast-bg, rgba(13,17,23,0.85))',
          }}
        >
          <span style={{ color: 'var(--text-med, #8B949E)', fontSize: 13, fontWeight: 600 }}>
            Character unavailable
          </span>
        </div>
      )}
    </div>
  )
}
