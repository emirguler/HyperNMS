import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';

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
      setError(t('serverUnavailable'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-orb"></div>
      <div className="login-card">
        <div className="login-header">
          <div style={{ fontSize: '4rem', marginBottom: '10px', filter: 'drop-shadow(0 0 10px var(--primary))' }}>⚡</div>
          <h1 style={{ margin: '10px 0', fontSize: '2rem', letterSpacing: '-1px' }}>NetPulse</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', letterSpacing: '1px', textTransform: 'uppercase' }}>Keep the Pulse of Your Network</p>
        </div>
        <form onSubmit={handleSubmit} style={{ textAlign: 'left', marginTop: '2rem' }}>
          {error && (
            <div className="login-error">
              <span style={{ marginRight: 8 }}>✕</span>{error}
            </div>
          )}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '1px' }}>{t('username')}</label>
            <input className="modern-input" placeholder="admin" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '1px' }}>{t('password')}</label>
            <input className="modern-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', padding: '16px', fontSize: '1rem' }} disabled={loading}>
            {loading ? t('loggingIn') : t('login')}
          </button>
        </form>
      </div>
    </div>
  );
}
