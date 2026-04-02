import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ragApi } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken]       = useState(() => sessionStorage.getItem('rag_token'));
  const [username, setUsername] = useState(() => sessionStorage.getItem('rag_user'));
  const [expiresAt, setExpiresAt] = useState(null);
  const [checking, setChecking]  = useState(true); // verifying stored token on mount
  const [justLoggedIn, setJustLoggedIn] = useState(false); // show loading screen after login

  // On mount: verify any stored token is still valid
  useEffect(() => {
    async function verifyStored() {
      const stored = sessionStorage.getItem('rag_token');
      if (!stored) { setChecking(false); return; }

      try {
        const data = await ragApi.verifySession(stored);
        setToken(stored);
        setUsername(data.username);
        setExpiresAt(data.expiresAt);
      } catch {
        // Token invalid or expired — clear it
        sessionStorage.removeItem('rag_token');
        sessionStorage.removeItem('rag_user');
        setToken(null);
        setUsername(null);
      } finally {
        setChecking(false);
      }
    }
    verifyStored();
  }, []);

  const login = useCallback(async (user, password) => {
    const data = await ragApi.login(user, password);
    setToken(data.token);
    setUsername(data.username);
    setExpiresAt(data.expiresAt);
    setJustLoggedIn(true);
    // sessionStorage: cleared when tab closes (safer than localStorage)
    sessionStorage.setItem('rag_token', data.token);
    sessionStorage.setItem('rag_user', data.username);
    // Show loading screen for 1.5s after login
    setTimeout(() => setJustLoggedIn(false), 1500);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await ragApi.logout(token); } catch { /* best effort */ }
    setToken(null);
    setUsername(null);
    setExpiresAt(null);
    sessionStorage.removeItem('rag_token');
    sessionStorage.removeItem('rag_user');
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, username, expiresAt, checking, justLoggedIn, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
