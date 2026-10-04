import { describe, it, expect } from 'vitest'

import { normalizeMcaSessionNudges } from '../analyticsIntegrationUtils'

// Raw face measurements as MCA's toMechanicalAverages produces them: eye and
// mouth aspect ratios and a head-pose pitch. All are distance ratios well below
// 1, which is the whole point of these tests.
const FACE_AVERAGES = { avg_ear: 0.28, avg_mar: 0.12, avg_pitch: 0.05 }

describe('normalizeMcaSessionNudges', () => {
  describe('mechanical_averages', () => {
    it('produces no nudges from face measurements alone', () => {
      const nudges = normalizeMcaSessionNudges({
        mechanical_averages: FACE_AVERAGES,
        nudge_log: [],
      })

      expect(nudges).toEqual([])
    })

    // The regression this file exists for. These values were once scored with
    // `value < 50 ? 'warning' : 'info'`, so every session with the camera on
    // reported three problems that had not been detected - and the one mapped
    // to the volume category fabricated a speech_volume_score out of head tilt.
    it('never reports a face measurement as a warning', () => {
      const nudges = normalizeMcaSessionNudges({
        mechanical_averages: FACE_AVERAGES,
        nudge_log: [],
        dominant_emotion: 'neutral',
      })

      expect(nudges.some((n) => n.nudge_severity === 'warning')).toBe(false)
      expect(nudges.some((n) => n.nudge_category === 'volume')).toBe(false)
    })

    it('leaves the real nudges untouched when both are present', () => {
      const nudges = normalizeMcaSessionNudges({
        mechanical_averages: FACE_AVERAGES,
        nudge_log: [
          { message: 'Speak a little louder.', category: 'volume', severity: 'warning', confidence: 0.8 },
        ],
      })

      expect(nudges).toHaveLength(1)
      expect(nudges[0]).toMatchObject({
        nudge: 'Speak a little louder.',
        nudge_category: 'volume',
        nudge_severity: 'warning',
      })
    })
  })

  describe('overall_score', () => {
    // Unlike the face averages this really is a 0-100 score, so the same
    // threshold is correct here and has to keep working.
    it('warns on a low score', () => {
      const [nudge] = normalizeMcaSessionNudges({ overall_score: 42, nudge_log: [] })
      expect(nudge.nudge_severity).toBe('warning')
    })

    it('does not warn on a high score', () => {
      const [nudge] = normalizeMcaSessionNudges({ overall_score: 88, nudge_log: [] })
      expect(nudge.nudge_severity).toBe('info')
    })

    it('says nothing when the session recorded no overall score', () => {
      expect(normalizeMcaSessionNudges({ nudge_log: [] })).toEqual([])
    })
  })

  describe('other session data', () => {
    it('still reports detected emotions', () => {
      const [nudge] = normalizeMcaSessionNudges({
        emotion_distribution: { happy: 0.7 },
        nudge_log: [],
      })

      expect(nudge.nudge_category).toBe('fusion')
      expect(nudge.emotion).toBe('happy')
    })

    it('returns an empty list for a session that sent nothing', () => {
      expect(normalizeMcaSessionNudges(null)).toEqual([])
      expect(normalizeMcaSessionNudges({})).toEqual([])
    })
  })
})
