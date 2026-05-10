import { authClient } from './client'

export async function getMyBaseline() {
  try {
    const resp = await authClient.get('/api/v1/apa/baseline/me')
    return resp.data
  } catch (err) {
    if (err.response?.status === 404) return null
    throw err
  }
}

export async function completeBaseline(mcaSessionId) {
  const resp = await authClient.post('/api/v1/apa/baseline/complete', {
    mca_session_id: mcaSessionId,
  })
  return resp.data // { baseline: BaselineSnapshotOut, plan_id }
}

export async function skipBaseline() {
  const resp = await authClient.post('/api/v1/apa/baseline/skip')
  return resp.data // { baseline: BaselineSnapshotOut, plan_id }
}

export async function chatBaseline(message, history = [], context = null, turn = 0) {
  const resp = await authClient.post('/api/v1/apa/baseline/chat', {
    message,
    history,
    context,
    turn,
  })
  return resp.data // { response: str, should_end: bool }
}
