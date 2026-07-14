import { authClient } from '../../lib/api/client'

const unwrap = (response) => response.data

export const rpeService = {
  getScenarios: async () => {
    try {
      return await authClient.get('/api/v1/rpe/scenarios').then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch scenarios')
    }
  },

  getScenariosByDifficulty: async (level) => {
    try {
      return await authClient.get(`/api/v1/rpe/scenarios/difficulty/${encodeURIComponent(level)}`).then(unwrap)
    } catch (err) {
      if (err.response?.status === 404) return []
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch scenarios')
    }
  },

  startSession: async (scenarioId, userId) => {
    try {
      return await authClient
        .post('/api/v1/rpe/start-session', { scenario_id: scenarioId, user_id: userId })
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to start session')
    }
  },

  sendTurn: async (sessionId, userInput) => {
    try {
      return await authClient
        .post('/api/v1/rpe/session-respond', { session_id: sessionId, user_input: userInput })
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to send turn')
    }
  },

  getSessionSummary: async (sessionId) => {
    try {
      return await authClient
        .get(`/api/v1/rpe/session-summary/${encodeURIComponent(sessionId)}`)
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch session summary')
    }
  },

  getScenarioDetail: async (scenarioId) => {
    try {
      return await authClient
        .get(`/api/v1/rpe/scenarios/detail/${encodeURIComponent(scenarioId)}`)
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch scenario detail')
    }
  },

  getScenariosBySkill: async (skill) => {
    try {
      return await authClient
        .get(`/api/v1/rpe/scenarios/skill/${encodeURIComponent(skill)}`)
        .then(unwrap)
    } catch (err) {
      if (err.response?.status === 404) return []
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch scenarios by skill')
    }
  },

  getScenariosByTrait: async (trait) => {
    try {
      return await authClient
        .get(`/api/v1/rpe/scenarios/trait/${encodeURIComponent(trait)}`)
        .then(unwrap)
    } catch (err) {
      if (err.response?.status === 404) return []
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch scenarios by trait')
    }
  },

  getApaRecommendations: async (userId, profile = {}) => {
    try {
      return await authClient
        .post('/api/v1/rpe/apa/recommend', { user_id: userId, ...profile })
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch APA recommendations')
    }
  },

  notifySessionComplete: async (userId, sessionId) => {
    try {
      return await authClient
        .post('/api/v1/rpe/apa/session-complete', { user_id: userId, session_id: sessionId })
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to notify session complete')
    }
  },

  getFeedback: async (sessionId) => {
    try {
      return await authClient
        .get(`/api/v1/rpe/session-feedback/${encodeURIComponent(sessionId)}`)
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch session feedback')
    }
  },

  getMyRpeSessions: async () => {
    try {
      return await authClient
        .get('/api/v1/rpe/my-sessions')
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch your sessions')
    }
  },

  transcribeAudio: async (audioBlob) => {
    // POST /api/v1/rpe/transcribe  (multipart/form-data)
    // Returns { transcript: string }
    //
    // authClient defaults to Content-Type: application/json.
    // transformRequest deletes that header before the request fires so the
    // browser sets multipart/form-data with the correct boundary automatically.
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')
      return await authClient.post('/api/v1/rpe/transcribe', formData, {
        transformRequest: [(data, headers) => {
          delete headers['Content-Type']
          return data
        }],
      }).then(unwrap)
    } catch (error) {
      console.error('RPE transcription error:', error)
      return { transcript: null }
    }
  },

  getNpcVoice: async (text, conflictType = 'manager_pressure') => {
    // POST /api/v1/rpe/npc-voice
    // Returns { audio_base64, voice_name, available }
    try {
      return await authClient
        .post('/api/v1/rpe/npc-voice', { text, conflict_type: conflictType })
        .then(unwrap)
    } catch (error) {
      console.error('RPE voice error:', error)
      return { audio_base64: null, available: false }
    }
  },
}
