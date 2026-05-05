import apiClient from './client'

export async function getMyTrainingPlan() {
  try {
    const resp = await apiClient.get('/api/v1/apa/plan/me')
    return resp.data
  } catch (err) {
    if (err.response?.status === 404) return null
    throw err
  }
}

export async function generateTrainingPlan(skill = 'job_interview') {
  const resp = await apiClient.post('/api/v1/apa/plan/generate', { skill })
  return resp.data
}

export async function getAdjustmentHistory() {
  const resp = await apiClient.get('/api/v1/apa/plan/history')
  return resp.data
}

export async function submitSessionFeedback(payload) {
  const resp = await apiClient.post('/api/v1/apa/session-feedback', payload)
  return resp.data
}
