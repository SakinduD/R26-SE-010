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
}
