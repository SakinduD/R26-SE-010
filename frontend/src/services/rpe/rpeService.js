import api from '../api'

const unwrap = (response) => response.data

export const rpeService = {
  getScenarios: async () => {
    try {
      return await api.get('/api/v1/rpe/scenarios').then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch scenarios')
    }
  },

  getScenariosByDifficulty: async (level) => {
    try {
      return await api.get(`/api/v1/rpe/scenarios/difficulty/${encodeURIComponent(level)}`).then(unwrap)
    } catch (err) {
      // 404 means no scenarios for this difficulty — treat as empty, not an error
      if (err.response?.status === 404) return []
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch scenarios')
    }
  },

  startSession: async (scenarioId, userId) => {
    try {
      return await api
        .post('/api/v1/rpe/start-session', { scenario_id: scenarioId, user_id: userId })
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to start session')
    }
  },

  sendTurn: async (sessionId, userInput) => {
    try {
      return await api
        .post('/api/v1/rpe/session-respond', { session_id: sessionId, user_input: userInput })
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to send turn')
    }
  },

  getSessionSummary: async (sessionId) => {
    try {
      return await api
        .get(`/api/v1/rpe/session-summary/${encodeURIComponent(sessionId)}`)
        .then(unwrap)
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message || 'Failed to fetch session summary')
    }
  },
}
