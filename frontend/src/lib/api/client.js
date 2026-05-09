import axios from 'axios';
import { API_URL } from '../config';
import { clearTokens, getTokens, setTokens } from '../auth/storage';

export const authClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach Bearer token to every request
authClient.interceptors.request.use((config) => {
  const tokens = getTokens();
  if (tokens?.access_token) {
    config.headers.Authorization = `Bearer ${tokens.access_token}`;
  }
  return config;
});

// Singleton refresh promise — prevents parallel refresh storms
let refreshPromise = null;

authClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const tokens = getTokens();

      if (tokens?.refresh_token) {
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${API_URL}/api/v1/auth/refresh`, {
              refresh_token: tokens.refresh_token,
            })
            .then((res) => {
              setTokens({
                access_token: res.data.access_token,
                refresh_token: res.data.refresh_token,
              });
              return res.data.access_token;
            })
            .catch((err) => {
              clearTokens();
              window.location.href = '/signin';
              return Promise.reject(err);
            })
            .finally(() => {
              refreshPromise = null;
            });
        }

        try {
          const newToken = await refreshPromise;
          original.headers.Authorization = `Bearer ${newToken}`;
          return authClient(original);
        } catch {
          return Promise.reject(error);
        }
      } else {
        clearTokens();
        window.location.href = '/signin';
      }
    }

    return Promise.reject(error);
  }
);
