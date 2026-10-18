import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/**
 * Camera <video> that opens the camera exactly once — a stand-in for
 * react-webcam. react-webcam calls getUserMedia in componentDidMount, and
 * React StrictMode (dev) mounts, unmounts and remounts every component, so
 * the camera was opened twice and the first stream stopped straight away.
 * On Windows a cold camera then often feeds the surviving stream black
 * frames until the page is reloaded (by then the camera is already warm).
 *
 * The ref exposes { video } like react-webcam's, so callers keep reading
 * ref.current.video.
 */
const CameraVideo = forwardRef(function CameraVideo({ videoConstraints, onUserMediaError, className }, ref) {
  const videoRef = useRef(null)
  useImperativeHandle(ref, () => ({
    get video() {
      return videoRef.current
    },
  }), [])

  const onErrorRef = useRef(onUserMediaError)
  onErrorRef.current = onUserMediaError

  // A string so a new-but-equal constraints object doesn't reopen the camera.
  const constraintsKey = JSON.stringify(videoConstraints ?? true)

  useEffect(() => {
    const video = videoRef.current
    let cancelled = false
    let stream = null

    // Deferred a tick: StrictMode's simulated unmount clears the timer, so
    // only the real mount asks for the camera.
    const timer = setTimeout(async () => {
      try {
        const opened = await navigator.mediaDevices.getUserMedia({ video: JSON.parse(constraintsKey), audio: false })
        // Turned off (or constraints changed) while the camera was opening.
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop())
          return
        }
        stream = opened
        if (video) {
          video.srcObject = opened
          video.play().catch(() => {})
        }
      } catch (err) {
        if (!cancelled) onErrorRef.current?.(err)
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (stream) stream.getTracks().forEach((track) => track.stop())
      if (video) video.srcObject = null
    }
  }, [constraintsKey])

  return <video ref={videoRef} autoPlay muted playsInline className={className} />
})

export default CameraVideo
