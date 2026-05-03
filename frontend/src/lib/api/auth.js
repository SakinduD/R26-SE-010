import { authClient } from './client';

const BASE = '/api/v1/auth';

/** @param {{ email: string, password: string, display_name?: string }} data */
export const signUp = (data) =>
  authClient.post(`${BASE}/signup`, data).then((r) => r.data);

/** @param {{ email: string, password: string }} data */
export const signIn = (data) =>
  authClient.post(`${BASE}/signin`, data).then((r) => r.data);

export const signOut = () =>
  authClient.post(`${BASE}/signout`).then((r) => r.data);

/** @param {string} refreshToken */
export const refreshToken = (refreshToken) =>
  authClient
    .post(`${BASE}/refresh`, { refresh_token: refreshToken })
    .then((r) => r.data);

/** @param {string} email */
export const requestPasswordReset = (email) =>
  authClient.post(`${BASE}/password-reset`, { email }).then((r) => r.data);

export const getCurrentUser = () =>
  authClient.get(`${BASE}/me`).then((r) => r.data);

/** Extract a user-friendly error message from an axios error. */
export function getApiError(error) {
  return (
    error?.response?.data?.detail ||
    error?.message ||
    'An unexpected error occurred'
  );
}
