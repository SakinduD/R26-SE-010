import api from '../api'

const unwrap = (response) => response.data

export const analyticsService = {
  getAggregateByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/aggregate`).then(unwrap),

  getBlindSpotsByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/blind-spots`).then(unwrap),

  getProgressTrendsByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/progress-trends`).then(unwrap),

  getPredictedOutcomesByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/predicted-outcomes`).then(unwrap),

  getAggregateBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/aggregate`).then(unwrap),

  getSkillScoresBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/skill-scores`).then(unwrap),

  getPostSessionReport: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/report`).then(unwrap),
}
