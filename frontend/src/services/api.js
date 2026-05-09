import axios from 'axios'
import { getTokens } from '../lib/auth/storage'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const tokens = getTokens()

  if (tokens?.access_token) {
    config.headers.Authorization = `Bearer ${tokens.access_token}`
  }

  return config
})

export default api
