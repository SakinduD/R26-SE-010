// Helpers that keep MCA nudges and face metrics in sync with what is
// happening right now (shared by useNudgeSensing and the AI baseline page).

// Below this share of frames with a face, a window has no usable face data.
const MIN_FACE_RATIO = 0.5

// A nudge stays visible at least this long so it can be read.
export const NUDGE_MIN_DISPLAY_MS = 4000

// Averages EAR / MAR / head pose over many camera frames.
export function createVisualAccumulator() {
  let totalFrames = 0
  let faceFrames = 0
  let sums = { ear: 0, mar: 0, yaw: 0, pitch: 0, roll: 0 }

  return {
    // metrics = { ear, mar, pose }, or null when no face was found in the frame.
    add(metrics) {
      totalFrames += 1
      if (!metrics) return
      faceFrames += 1
      sums.ear += metrics.ear
      sums.mar += metrics.mar
      // Rules only use how far the head is turned/tilted, so average magnitudes
      // (left and right turns must not cancel out).
      sums.yaw += Math.abs(metrics.pose.yaw)
      sums.roll += Math.abs(metrics.pose.roll)
      sums.pitch += metrics.pose.pitch
    },

    // Mean metrics in the nudge engine's shape, or null if the face was
    // mostly missing (or the camera was off).
    average() {
      if (totalFrames === 0 || faceFrames / totalFrames < MIN_FACE_RATIO) return null
      return {
        ear: sums.ear / faceFrames,
        mar: sums.mar / faceFrames,
        pose: { yaw: sums.yaw / faceFrames, pitch: sums.pitch / faceFrames, roll: sums.roll / faceFrames },
      }
    },

    reset() {
      totalFrames = 0
      faceFrames = 0
      sums = { ear: 0, mar: 0, yaw: 0, pitch: 0, roll: 0 }
    },
  }
}

// Session-level mechanical_averages payload from an accumulator.
export function toMechanicalAverages(accumulator) {
  const avg = accumulator.average()
  if (!avg) return null
  return { avg_ear: avg.ear, avg_mar: avg.mar, avg_pitch: avg.pose.pitch }
}

// One analysed audio chunk, as sent to session scoring (observation_log).
export function toObservation(metrics, elapsedSeconds) {
  return {
    elapsed_seconds: elapsedSeconds,
    speaking: Boolean(metrics.speaking),
    face_visible: Boolean(metrics.face_visible),
    emotion: metrics.emotion || null,
    confidence: metrics.emotion ? metrics.confidence ?? null : null,
    detections: (metrics.detections || []).map(({ message, category }) => ({ message, category })),
  }
}

// Adds a nudge to the top of the list, replacing an identical one on screen.
export function upsertNudge(list, nudge, max) {
  return [nudge, ...list.filter((n) => n.text !== nudge.text)].slice(0, max)
}

// Drops nudges whose behaviour the backend no longer detects, once they have
// been visible for NUDGE_MIN_DISPLAY_MS.
export function pruneResolvedNudges(list, activeMessages) {
  if (!Array.isArray(activeMessages)) return list
  const active = new Set(activeMessages)
  const now = Date.now()
  const kept = list.filter((n) => active.has(n.text) || now - n.shownAt < NUDGE_MIN_DISPLAY_MS)
  return kept.length === list.length ? list : kept
}
