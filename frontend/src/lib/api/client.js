import axios from 'axios';
import { API_URL } from '../config';
import { clearTokens, getTokens, setTokens } from '../auth/storage';

// 45s: RPE's session-respond can legitimately chain two sequential LLM
// calls on one turn — the main NPC dialogue call and, from turn 5 onward,
// should_conversation_end()'s classify_conversation_end() check — each
// independently bounded to 15s (see rpe_llm_service.py's OpenAI httpx
// client and _get_groq_client's own timeout). Worst case that's ~30s of
// real, legitimate LLM time before any DB/processing overhead; the
// original 30s here left zero margin and was itself observed firing on a
// real double-LLM-call turn. Without SOME cap a stalled request still
// hangs forever with no error to catch and no way to retry — that was the
// original problem this timeout fixed; 45s keeps that guarantee while
// actually clearing the legitimate worst case.
export const authClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 45000,
});

export default authClient;

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

    // Do not intercept 401s on the signin or signup endpoints themselves!
    // Otherwise, a wrong password causes a forced page reload to /signin, erasing the error message.
    if (
      original.url?.includes('/signin') ||
      original.url?.includes('/signup')
    ) {
      return Promise.reject(error);
    }

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
