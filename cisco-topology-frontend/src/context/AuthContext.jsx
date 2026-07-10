import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';
import { showToast } from '../Toast';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [userRole, setUserRole] = useState(localStorage.getItem('userRole') || '');
  const [username, setUsername] = useState(localStorage.getItem('username') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('userRole'));
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [csrfToken, setCsrfToken] = useState('');
  const [allowedCommands, setAllowedCommands] = useState([]);

  // Fetch CSRF token on mount
  const fetchCsrfToken = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCsrfToken(data.csrfToken);
        return data.csrfToken;
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  // Check session on mount (cookie-based)
  useEffect(() => {
    if (isAuthenticated) {
      fetch(`${API_BASE}/me`, { credentials: 'include' })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('Session expired');
        })
        .then(data => {
          setUserRole(data.role);
          setUsername(data.username);
          setMustChangePassword(data.mustChangePassword || false);
          setAllowedCommands(data.allowedCommands || []);
          fetchCsrfToken();
        })
        .catch(() => {
          // Cookie expired or invalid
          setIsAuthenticated(false);
          setUserRole('');
          setUsername('');
          localStorage.removeItem('userRole');
          localStorage.removeItem('username');
        });
    }
  }, []);

  const login = useCallback(async (usr, password) => {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      credentials: 'include', // Send/receive httpOnly cookies
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usr, password })
    });
    const data = await res.json();
    if (res.ok) {
      setIsAuthenticated(true);
      setUserRole(data.role);
      setUsername(data.username);
      setMustChangePassword(data.mustChangePassword || false);
      setAllowedCommands(data.allowedCommands || []);
      localStorage.setItem('userRole', data.role);
      localStorage.setItem('username', data.username);
      showToast('Login successful', 'success');
      // Fetch CSRF token after login
      await fetchCsrfToken();
      return { success: true, mustChangePassword: data.mustChangePassword };
    }
    return { success: false, error: data.error || 'Login failed' };
  }, [fetchCsrfToken]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
      });
    } catch { /* ignore */ }
    setIsAuthenticated(false);
    setUserRole('');
    setUsername('');
    setMustChangePassword(false);
    setCsrfToken('');
    setAllowedCommands([]);
    localStorage.removeItem('userRole');
    localStorage.removeItem('username');
  }, [csrfToken]);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
  }, []);

  const authFetch = useCallback(async (url, options = {}) => {
    const headers = {
      ...options.headers,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    };

    // Add CSRF token for state-changing requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes((options.method || 'GET').toUpperCase()) && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const res = await fetch(`${API_BASE}${url}`, {
      ...options,
      credentials: 'include', // Send httpOnly cookie
      headers
    });

    if (res.status === 401 || res.status === 403) {
      // Check if it's a CSRF error — refresh token and retry once
      if (res.status === 403) {
        const data = await res.clone().json().catch(() => ({}));
        if (data.error === 'CSRF token mismatch' || data.error === 'CSRF token required') {
          const newToken = await fetchCsrfToken();
          if (newToken) {
            headers['X-CSRF-Token'] = newToken;
            const retry = await fetch(`${API_BASE}${url}`, { ...options, credentials: 'include', headers });
            return retry;
          }
        }
      }
      if (res.status === 401) {
        logout();
        return null;
      }
    }
    return res;
  }, [csrfToken, logout, fetchCsrfToken]);

  return (
    <AuthContext.Provider value={{
      isAuthenticated, userRole, username, login, logout, authFetch,
      isAdmin: userRole === 'Administrator',
      mustChangePassword, clearMustChangePassword, csrfToken,
      allowedCommands
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
