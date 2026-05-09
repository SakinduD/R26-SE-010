import api from '../api';

export const mcaService = {
  chat: async (message, history = [], context = {}) => {
    try {
      const response = await api.post('/api/v1/mca/chat/', { message, history, context });
      return response.data;
    } catch (error) {
      console.error('MCA Chat API Error:', error);
      if (error.response && error.response.data && error.response.data.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  },
  
  getAudioStreamUrl: () => {
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
    return `${wsUrl}/api/v1/mca/audio/audio-analysis?token=mca_secure_session_alpha`;
  }
};
