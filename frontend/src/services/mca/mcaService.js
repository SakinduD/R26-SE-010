import { authClient } from '../../lib/api/client';
import { getTokens } from '../../lib/auth/storage';

const BASE = '/api/v1/mca';

/**
 * Helper to extract descriptive error messages from backend responses.
 */
const handleApiError = (error, context) => {
  console.error(`[mcaService:${context}] Error:`, error);
  
  if (error.response) {
    const { status, data } = error.response;
    const detail = data?.detail || 'An unexpected error occurred.';
    
    switch (status) {
      case 401: return 'Unauthorized. Please log in again.';
      case 403: return 'Access denied. You may not have permission for this session.';
      case 404: return 'Resource not found. The session may have expired or was deleted.';
      case 422: return `Validation error: ${JSON.stringify(detail)}`;
      case 429: return 'Rate limit exceeded. Please wait a moment.';
      case 500: return 'Internal server error. Our intelligence engine is having trouble.';
      default: return detail;
    }
  }
  
  if (error.request) {
    return 'The server is unreachable. Please check your connection.';
  }
  
  return error.message || 'Failed to complete request.';
};

export const mcaService = {
  // Chat 
  chat: async (message, history = [], context = {}, sessionId = null) => {
    try {
      const response = await authClient.post(`${BASE}/chat/`, {
        message,
        history,
        context,
        ...(sessionId ? { session_id: sessionId } : {}),
      });
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error, 'chat'));
    }
  },

  // Audio WebSocket
  getAudioStreamUrl: () => {
    const wsBase = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
    const tokens = getTokens();
    const token = tokens?.access_token || '';
    if (!token) {
      console.warn('[mcaService] No access token found — WebSocket will be rejected by the server.');
    }
    return `${wsBase}/api/v1/mca/audio/audio-analysis?token=${encodeURIComponent(token)}`;
  },

  // Session management
  startSession: async (mode = 'live') => {
    try {
      const response = await authClient.post(`${BASE}/sessions/start`, { mode });
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error, 'startSession'));
    }
  },

  // End an active session and persist results.
  endSession: async (sessionId, nudgeLog = [], resultData = null, chatTurns = null, emotionDistribution = null, mechanicalAverages = null) => {
    try {
      const body = {
        nudge_log: nudgeLog,
        ...(resultData ? { result_data: resultData } : {}),
        ...(chatTurns !== null ? { chat_turns: chatTurns } : {}),
        ...(emotionDistribution ? { emotion_distribution: emotionDistribution } : {}),
        ...(mechanicalAverages ? { mechanical_averages: mechanicalAverages } : {}),
      };
      const response = await authClient.post(`${BASE}/sessions/${sessionId}/end`, body);
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error, 'endSession'));
    }
  },

  // Fetch the current user's session history.
  getSessions: async (limit = 20, offset = 0) => {
    try {
      const response = await authClient.get(`${BASE}/sessions/`, { params: { limit, offset } });
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error, 'getSessions'));
    }
  },
};
