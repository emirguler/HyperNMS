import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

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
      <div className="login-orb" />
      <div className="login-card">
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 8, filter: 'drop-shadow(0 0 8px var(--primary))' }}>⚡</div>
          <h1 style={{ margin: '0 0 6px', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.5px' }}>
            NetPulse
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            Network Management System
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          {error && (
            <div className="login-error">
              <span style={{ marginRight: 8, flexShrink: 0 }}>✕</span>{error}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block', marginBottom: 6,
              fontSize: '0.75rem', fontWeight: 600,
              color: 'var(--text-muted)', letterSpacing: '0.3px'
            }}>USERNAME</label>
            <input
              className="modern-input"
              placeholder="Enter username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: 'block', marginBottom: 6,
              fontSize: '0.75rem', fontWeight: 600,
              color: 'var(--text-muted)', letterSpacing: '0.3px'
            }}>PASSWORD</label>
            <input
              className="modern-input"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: '0.9rem' }}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: '0.7rem', color: 'var(--text-dim)', textAlign: 'center' }}>
          NetPulse NMS v2.0
        </p>
      </div>
    </div>
  );
}
