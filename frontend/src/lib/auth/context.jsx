import React, { createContext, useContext, useEffect, useState } from 'react';
import * as authApi from '../api/auth';
import { clearTokens, getTokens, setTokens } from './storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, restore session from stored tokens
  useEffect(() => {
    const tokens = getTokens();
    if (tokens?.access_token) {
      authApi
        .getCurrentUser()
        .then(setUser)
        .catch(() => clearTokens())
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const signIn = async (data) => {
    const res = await authApi.signIn(data);
    setTokens({ access_token: res.access_token, refresh_token: res.refresh_token });
    setUser(res.user);
    return res;
  };

  const signUp = async (data) => {
    const res = await authApi.signUp(data);
    setTokens({ access_token: res.access_token, refresh_token: res.refresh_token });
    setUser(res.user);
    return res;
  };

  const signOut = async () => {
    try {
      await authApi.signOut();
    } catch {}
    clearTokens();
    setUser(null);
  };

  const refreshUser = async () => {
    const u = await authApi.getCurrentUser();
    setUser(u);
    return u;
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated: !!user, signIn, signUp, signOut, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
