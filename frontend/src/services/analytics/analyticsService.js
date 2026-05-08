import api from '../api'

const unwrap = (response) => response.data

export const analyticsService = {
  getAggregateByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/aggregate`).then(unwrap),

  getBlindSpotsByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/blind-spots`).then(unwrap),

  getBlindSpotsBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/blind-spots`).then(unwrap),

  getFeedbackAnalysisByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/feedback-analysis`).then(unwrap),

  getFeedbackAnalysisBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/feedback-analysis`).then(unwrap),

  getProgressTrendsByUser: (userId, params = {}) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/progress-trends`, { params }).then(unwrap),

  getProgressTrendBySkill: (userId, skillArea, params = {}) =>
    api
      .get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/progress-trends/${encodeURIComponent(skillArea)}`, { params })
      .then(unwrap),

  getPredictedOutcomesByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/predicted-outcomes`).then(unwrap),

  getPredictedOutcomeBySkill: (userId, skillArea) =>
    api
      .get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/predicted-outcomes/${encodeURIComponent(skillArea)}`)
      .then(unwrap),

  getMentoringRecommendationsByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/mentoring-recommendations`).then(unwrap),

  getAggregateBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/aggregate`).then(unwrap),

  getSkillScoresBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/skill-scores`).then(unwrap),

  getPostSessionReport: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/report`).then(unwrap),

  createFeedbackEntry: (payload) =>
    api.post('/api/v1/analytics/feedback', payload).then(unwrap),

  integrateCompletedSession: (payload) =>
    api.post('/api/v1/analytics/integrations/session-complete', payload).then(unwrap),

  getComponentSurveyProfile: () =>
    api.get('/api/v1/survey/profile/me').then(unwrap),

  getComponentAdaptivePlan: () =>
    api.get('/api/v1/apa/plan/me').then(unwrap),

  getComponentRpeSession: (sessionId) =>
    api.get(`/api/v1/rpe/session-summary/${encodeURIComponent(sessionId)}`).then(unwrap),

  getComponentRpeFeedback: (sessionId) =>
    api.get(`/api/v1/rpe/session-feedback/${encodeURIComponent(sessionId)}`).then(unwrap),

  getComponentRpeSessions: () =>
    api.get('/api/v1/rpe/my-sessions').then(unwrap),

  getComponentMcaSessions: (limit = 20, offset = 0) =>
    api.get('/api/v1/mca/sessions/', { params: { limit, offset } }).then(unwrap),
}
