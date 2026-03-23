import { createContext, useContext, useState, useCallback } from 'react';
import { API_BASE } from '../config';
import { showToast } from '../Toast';
import { t } from '../i18n';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [userRole, setUserRole] = useState(localStorage.getItem('userRole') || '');

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      setToken(data.token);
      setUserRole(data.role);
      localStorage.setItem('token', data.token);
      localStorage.setItem('userRole', data.role);
      showToast(t('loginSuccess'), 'success');
      return { success: true };
    }
    return { success: false, error: data.error || t('loginFailed') };
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setUserRole('');
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
  }, []);

  const authFetch = useCallback(async (url, options = {}) => {
    const res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    if (res.status === 401 || res.status === 403) {
      logout();
      return null;
    }
    return res;
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ token, userRole, login, logout, authFetch, isAdmin: userRole === 'Administrator' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
