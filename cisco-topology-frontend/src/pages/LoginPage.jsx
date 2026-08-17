import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';

// Goz ikonu. Modul seviyesinde: bilesen govdesinde tanimlanirsa her render'da
// yeniden mount edilirdi.
function EyeIcon({ off }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M1.8 12S5.5 5 12 5s10.2 7 10.2 7-3.7 7-10.2 7S1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />}
    </svg>
  );
}

const revealBtnStyle = {
  position: 'absolute', top: '50%', right: 4, transform: 'translateY(-50%)',
  width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', padding: 0, margin: 0, borderRadius: 8,
  color: 'var(--text-muted)', cursor: 'pointer', touchAction: 'manipulation'
};

const labelStyle = {
  display: 'block', marginBottom: 6,
  fontSize: '0.75rem', fontWeight: 600,
  color: 'var(--text-muted)', letterSpacing: '0.3px'
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { isShort, isTouch } = useViewport();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        navigate('/dashboard');
      } else {
        setError(result.error);
      }
    } catch {
      setError('Server unavailable. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      {/* Dekoratif orb kisa ekranda gizli: 375px yukseklikte GPU maliyeti bos yere. */}
      <div className="login-orb rw-hide-short" />
      <div className="login-card">
        <div style={{ marginBottom: isShort ? 14 : 32 }}>
          <img
            src="/app-icon.png"
            alt="NetPulse"
            style={{
              width: isShort ? 44 : 68, height: isShort ? 44 : 68,
              marginBottom: isShort ? 4 : 8, filter: 'drop-shadow(0 0 14px var(--primary))'
            }}
          />
          <h1 style={{ margin: '0 0 6px', fontSize: isShort ? '1.25rem' : '1.6rem', fontWeight: 700, letterSpacing: '-0.5px' }}>
            NetPulse
          </h1>
          <p className="rw-hide-short" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            Network Management System
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          {error && (
            <div className="login-error">
              <span style={{ marginRight: 8, flexShrink: 0 }}>✕</span>{error}
            </div>
          )}

          {/* autoFocus dokunmatikte kapali: yazilim klavyesi aninda acilir, yatayda
              gorunur alan ~180px'e duser ve kart erisilemez hale gelirdi. */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="login-username" style={labelStyle}>USERNAME</label>
            <input
              id="login-username"
              className="modern-input"
              name="username"
              placeholder="Enter username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              enterKeyHint="next"
              autoFocus={!isTouch}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label htmlFor="login-password" style={labelStyle}>PASSWORD</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                className="modern-input"
                type={showPassword ? 'text' : 'password'}
                name="password"
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                style={isTouch ? { paddingRight: 52 } : undefined}
              />
              {/* Goster/gizle sadece dokunmatikte: masaustu gorunumu degismesin. */}
              {isTouch && (
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  style={revealBtnStyle}
                >
                  <EyeIcon off={showPassword} />
                </button>
              )}
            </div>
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: '0.9rem' }}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: isShort ? 12 : 24, fontSize: '0.7rem', color: 'var(--text-dim)', textAlign: 'center' }}>
          NetPulse NMS v2.0
        </p>
      </div>
    </div>
  );
}
