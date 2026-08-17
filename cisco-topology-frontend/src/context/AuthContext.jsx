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
  // Operator'e verilen ham (tam) SSH klavye erisimi
  const [fullSsh, setFullSsh] = useState(false);
  // Admin bu hesap icin 2FA'yi zorunlu kildiysa: girisin ardindan kurulum
  // ekrani gosterilir (mustChangePassword deseninin aynisi).
  const [mustSetup2fa, setMustSetup2fa] = useState(false);

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
          setFullSsh(data.fullSsh === true);
          setMustSetup2fa(data.mustSetup2fa === true);
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
    // 2FA acikken sunucu OTURUM ACMAZ: kisa omurlu bir gecis token'i doner ve
    // ikinci adim beklenir. Burada hicbir oturum durumu kurulmaz.
    if (res.ok && data.twoFactorRequired) {
      return { success: false, twoFactorRequired: true, pendingToken: data.pendingToken };
    }
    if (res.ok) {
      setIsAuthenticated(true);
      setUserRole(data.role);
      setUsername(data.username);
      setMustChangePassword(data.mustChangePassword || false);
      setAllowedCommands(data.allowedCommands || []);
      setFullSsh(data.fullSsh === true);
      setMustSetup2fa(data.mustSetup2fa === true);
      localStorage.setItem('userRole', data.role);
      localStorage.setItem('username', data.username);
      showToast('Login successful', 'success');
      // Fetch CSRF token after login
      await fetchCsrfToken();
      return { success: true, mustChangePassword: data.mustChangePassword };
    }
    return { success: false, error: data.error || 'Login failed' };
  }, [fetchCsrfToken]);

  /** Girisin ikinci adimi: gecis token'i + TOTP ya da kurtarma kodu. */
  const loginTwoFactor = useCallback(async (pendingToken, code) => {
    const res = await fetch(`${API_BASE}/login/2fa`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingToken, code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || 'Verification failed' };

    setIsAuthenticated(true);
    setUserRole(data.role);
    setUsername(data.username);
    setMustChangePassword(data.mustChangePassword || false);
    setAllowedCommands(data.allowedCommands || []);
    setFullSsh(data.fullSsh === true);
    setMustSetup2fa(false); // bu yola yalnizca 2FA'si olanlar girer
    localStorage.setItem('userRole', data.role);
    localStorage.setItem('username', data.username);
    showToast('Login successful', 'success');
    // Kurtarma kodu tuketildiyse kullaniciyi uyar - sessizce azalmasin
    if (data.recoveryUsed) {
      showToast(`Recovery code used — ${data.recoveryRemaining} left`, 'info', 6000);
    }
    await fetchCsrfToken();
    return { success: true, mustChangePassword: data.mustChangePassword };
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
    setFullSsh(false);
    setMustSetup2fa(false);
    localStorage.removeItem('userRole');
    localStorage.removeItem('username');
  }, [csrfToken]);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
  }, []);

  const clearMustSetup2fa = useCallback(() => {
    setMustSetup2fa(false);
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
      isAuthenticated, userRole, username, login, loginTwoFactor, logout, authFetch,
      isAdmin: userRole === 'Administrator',
      // Cihaza dokunan islemler (SSH / arayuz konfigi / reload): Administrator + Operator.
      // 'User' eski kayitlarin Operator karsiligi; 'Viewer' = User (View Only) → yetkisiz.
      isOperator: userRole === 'Administrator' || userRole === 'Operator' || userRole === 'User',
      mustChangePassword, clearMustChangePassword, csrfToken,
      mustSetup2fa, clearMustSetup2fa,
      allowedCommands, fullSsh,
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
