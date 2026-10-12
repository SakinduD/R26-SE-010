import * as faceMesh from '@mediapipe/face_mesh'
import * as draw from '@mediapipe/drawing_utils'

// MediaPipe's Closure-compiled scripts export onto `this || self`, so in a
// production build the symbols land on window instead of the module namespace
// (same reason FaceMesh is resolved with a window fallback). Resolve each one
// the same way rather than assuming the import worked.
const pick = (name) => draw[name] || faceMesh[name] || draw.default?.[name] || faceMesh.default?.[name] || window[name]

/**
 * Draw the face-mesh overlay. Never throws: an error here would reject
 * faceMeshModel.send() and stop the camera loop, freezing the video.
 */
export function drawFaceMesh(ctx, landmarks) {
  try {
    const drawConnectors = pick('drawConnectors')
    if (typeof drawConnectors !== 'function') return
    const layers = [
      ['FACEMESH_TESSELATION', { color: '#06B6D4', lineWidth: 0.5 }],
      ['FACEMESH_RIGHT_EYE', { color: '#7C3AED' }],
      ['FACEMESH_LEFT_EYE', { color: '#7C3AED' }],
      ['FACEMESH_LIPS', { color: '#EC4899' }],
    ]
    for (const [name, style] of layers) {
      const connections = pick(name)
      if (connections) drawConnectors(ctx, landmarks, connections, style)
    }
  } catch (err) {
    console.warn('[drawFaceMesh] overlay skipped:', err)
  }
}
