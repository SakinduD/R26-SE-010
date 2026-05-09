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

export async function skipBaseline(skill = 'job_interview') {
  const resp = await apiClient.post('/api/v1/apa/baseline-skip', { skill })
  return resp.data
}

// ---- Baseline ---------------------------------------------------------------

export async function getMyBaseline() {
  try {
    const resp = await apiClient.get('/api/v1/apa/baseline/me')
    return resp.data
  } catch (err) {
    if (err.response?.status === 404) return null
    throw err
  }
}

export async function completeBaseline(mcaSessionId) {
  const resp = await apiClient.post('/api/v1/apa/baseline/complete', {
    mca_session_id: mcaSessionId,
  })
  return resp.data
}

// ---- Demo endpoints ---------------------------------------------------------

export async function listDemoPersonas() {
  const resp = await apiClient.get('/api/v1/apa/demo/personas')
  return resp.data
}

export async function injectDemoPersona(personaId) {
  const resp = await apiClient.post('/api/v1/apa/demo/inject-persona', {
    persona_id: personaId,
  })
  return resp.data
}

export async function simulateDemoSession(outcome = 'partial') {
  const resp = await apiClient.post('/api/v1/apa/demo/simulate-session', { outcome })
  return resp.data
}
