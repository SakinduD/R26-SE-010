import { authClient } from '../../lib/api/client';
import { getTokens } from '../../lib/auth/storage';

const BASE = '/api/v1/mca';

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
      console.error('[mcaService:chat] Error processing chat request:', error);
      throw new Error(error.response?.data?.detail || 'Failed to process chat message. Please try again.');
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
      console.error('[mcaService:startSession] Error starting session:', error);
      throw new Error(error.response?.data?.detail || 'Failed to start MCA session. Server may be unreachable.');
    }
  },

  // End an active session and persist results.
  endSession: async (sessionId, nudgeLog = [], resultData = null, chatTurns = null) => {
    try {
      const body = {
        nudge_log: nudgeLog,
        ...(resultData ? { result_data: resultData } : {}),
        ...(chatTurns !== null ? { chat_turns: chatTurns } : {}),
      };
      const response = await authClient.post(`${BASE}/sessions/${sessionId}/end`, body);
      return response.data;
    } catch (error) {
      console.error(`[mcaService:endSession] Error ending session ${sessionId}:`, error);
      throw new Error(error.response?.data?.detail || 'Failed to gracefully end and save the session.');
    }
  },

  // Fetch the current user's session history.
  getSessions: async (limit = 20, offset = 0) => {
    try {
      const response = await authClient.get(`${BASE}/sessions/`, { params: { limit, offset } });
      return response.data;
    } catch (error) {
      console.error('[mcaService:getSessions] Error fetching session history:', error);
      throw new Error(error.response?.data?.detail || 'Failed to fetch session history.');
    }
  },
};
