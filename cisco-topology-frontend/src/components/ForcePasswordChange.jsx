import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

// Etiketler masaustunde 0.75rem (12px) kaliyor; telefonda 13px'e cikiyor.
// Iki ayri sabit, cunku inline stil bir media query tasiyamaz.
const labelStyle = {
  display: 'block', marginBottom: 6, fontSize: '0.75rem',
  fontWeight: 600, color: 'var(--text-muted)'
};
const labelStylePhone = { ...labelStyle, fontSize: '0.8125rem' };

export default function ForcePasswordChange({ onComplete }) {
  const { authFetch } = useAuth();
  const { isPhone } = useViewport();
  const lblStyle = isPhone ? labelStylePhone : labelStyle;
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setError('Password must include uppercase, lowercase, digit, and special character');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      const res = await authFetch('/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword })
      });
      if (res.ok) {
        showToast('Password changed successfully', 'success');
        onComplete();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Operation failed');
      }
    } catch {
      setError('Unable to connect to server');
    }
  };

  return (
    <div className="modal-overlay">
      {/* width:420 sabitti; min() ile dar ekranda tasmiyor, masaustunde yine 420px.
          Yukseklik/kaydirma responsive.css'teki .modal-content kurallarindan geliyor. */}
      <div className="modal-content" style={{ width: 'min(420px, 100%)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {/* Kisa ekranda (telefon yatay) 64px'lik dekoratif rozet gizlenir. */}
          <div className="rw-hide-short" style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.4rem', margin: '0 auto 16px'
          }}>🔐</div>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 700 }}>Password Change Required</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            Please change your default password for security.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="login-error" style={{ marginBottom: 16 }}>
              <span style={{ marginRight: 8 }}>✕</span>{error}
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="fpc-new-password" style={lblStyle}>NEW PASSWORD</label>
            <input
              id="fpc-new-password"
              className="modern-input"
              type="password"
              name="newPassword"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="Min 8 chars, uppercase, digit, special"
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label htmlFor="fpc-confirm-password" style={lblStyle}>CONFIRM PASSWORD</label>
            <input
              id="fpc-confirm-password"
              className="modern-input"
              type="password"
              name="confirmPassword"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Re-enter password"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: 12 }}>Change Password</button>
        </form>
      </div>
    </div>
  );
}
