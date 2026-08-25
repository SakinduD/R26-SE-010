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

  getPredictedOutcomesByUser: (userId, params = {}) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/predicted-outcomes`, { params }).then(unwrap),

  getPredictedOutcomeBySkill: (userId, skillArea, params = {}) =>
    api
      .get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/predicted-outcomes/${encodeURIComponent(skillArea)}`, { params })
      .then(unwrap),

  getMentoringRecommendationsByUser: (userId, forceRefresh = false) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/mentoring-recommendations`, {
      params: forceRefresh ? { force_refresh: true } : {},
    }).then(unwrap),

  getMentoringRecommendationsBySession: (sessionId, forceRefresh = false) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/mentoring-recommendations`, {
      params: forceRefresh ? { force_refresh: true } : {},
    }).then(unwrap),

  getLearnerProfileSignal: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/learner-profile-signal`).then(unwrap),

  getGamificationByUser: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/gamification`).then(unwrap),

  syncGamificationByUser: (userId) =>
    api.post(`/api/v1/analytics/users/${encodeURIComponent(userId)}/gamification/sync`).then(unwrap),

  getAggregateBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/aggregate`).then(unwrap),

  getSkillScoresBySession: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/skill-scores`).then(unwrap),

  getPostSessionReport: (sessionId) =>
    api.get(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/report`).then(unwrap),

  createFeedbackEntry: (payload) =>
    api.post('/api/v1/analytics/feedback', payload).then(unwrap),

  // Whole-history views. Only meaningful without a session selected: they
  // answer "where am I now versus where I started", which a single session
  // cannot.
  getSkillHistory: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/skill-history`).then(unwrap),

  getRecurringBlindSpots: (userId) =>
    api.get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/recurring-blind-spots`).then(unwrap),

  integrateCompletedSession: (payload) =>
    api.post('/api/v1/analytics/integrations/session-complete', payload).then(unwrap),

  // Server-side integration of a single finished session: the backend reads the
  // session from its own tables, so the caller needs nothing but the id.
  integrateSession: (sessionId) =>
    api.post(`/api/v1/analytics/sessions/${encodeURIComponent(sessionId)}/integrate`).then(unwrap),

  // Lets the session-end hook resolve the learner without the MCA screens
  // having to wire in the auth context themselves.
  getCurrentUserId: () => api.get('/api/v1/auth/me').then((r) => r.data?.id || ''),

  getComponentSurveyProfile: () =>
    api.get('/api/v1/survey/profile/me').then(unwrap),

  getComponentAdaptivePlan: () =>
    api.get('/api/v1/apa/plan/me').then(unwrap),

  // The learner's completed sessions, newest first, from this module's own
  // endpoint rather than the multimodal engine's. That one pages over sessions
  // in any state, so a page of twenty could arrive with nothing selectable in
  // it; this one filters before the limit and reports the true total.
  getLearnerSessions: (userId, { limit = 5, offset = 0 } = {}) =>
    api
      .get(`/api/v1/analytics/users/${encodeURIComponent(userId)}/sessions`, {
        params: { limit, offset },
      })
      .then(unwrap),

  getComponentMcaSessions: (limit = 20, offset = 0) =>
    api.get('/api/v1/mca/sessions/', { params: { limit, offset } }).then(unwrap),

  getComponentMcaSession: (sessionId) =>
    api.get(`/api/v1/mca/sessions/${encodeURIComponent(sessionId)}`).then(unwrap),
}
