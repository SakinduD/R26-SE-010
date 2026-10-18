import * as faceMesh from '@mediapipe/face_mesh'

// One FaceMesh for the whole page. Its WASM + model (~10 MB from the CDN) only
// load on first use, so until then nothing reached the canvas and the camera
// looked black; after a refresh they came from the HTTP cache and it worked.
// A new instance per camera start would also load and compile them again, and
// closing one mid-load (toggling the camera) leaked it and could leave the next
// one stuck until a refresh.
let model = null
let modelReady = null
// Results go to the loop that is currently running (at most one per page).
let activeHandler = null

function getFaceMesh() {
  if (!model) {
    const FaceMeshCtor = faceMesh.FaceMesh || window.FaceMesh || faceMesh.default?.FaceMesh || faceMesh.default
    model = new FaceMeshCtor({
      locateFile: (file) => {
        const baseUrl = import.meta.env.VITE_MEDIAPIPE_FACE_MESH_URL || 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh'
        return `${baseUrl}/${file}`
      },
    })
    model.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    model.onResults((results) => activeHandler?.(results))
  }
  return model
}

/** Starts loading the model; safe to call repeatedly. Resolves when it's ready. */
export function preloadFaceMesh() {
  if (!modelReady) {
    modelReady = getFaceMesh().initialize().catch((err) => {
      // Let the next camera start try again (e.g. after a network blip).
      modelReady = null
      throw err
    })
  }
  return modelReady
}

/** Draws a frame onto the canvas mirrored (selfie view), sized to the frame. */
export function drawMirroredFrame(canvas, image, width, height) {
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.translate(width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(image, 0, 0, width, height)
  ctx.restore()
  return ctx
}

/**
 * Runs FaceMesh on every frame of getVideo(). While the model is still
 * loading, frames go to onPreview instead so the camera shows straight away.
 * Returns a stop function.
 */
export function startFaceMeshLoop({ getVideo, onResults, onPreview, logTag = 'faceMesh' }) {
  let stopped = false
  let rafId = null
  let ready = false

  const handler = (results) => {
    if (!stopped) onResults(results)
  }
  activeHandler = handler
  const model = getFaceMesh()
  preloadFaceMesh()
    .then(() => { ready = true })
    .catch((err) => console.warn(`[${logTag}] face tracking unavailable:`, err))

  const loop = async () => {
    if (stopped) return
    const video = getVideo()
    // readyState >= 2: the stream is live and has a decodable frame.
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      if (ready) {
        try {
          await model.send({ image: video })
        } catch (err) {
          console.warn(`[${logTag}] frame skipped:`, err)
        }
      } else {
        onPreview?.(video)
      }
    }
    if (!stopped) rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)

  return () => {
    stopped = true
    if (rafId) cancelAnimationFrame(rafId)
    if (activeHandler === handler) activeHandler = null
  }
}
