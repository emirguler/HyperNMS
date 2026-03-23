import { useState } from 'react';
import { API_BASE } from '../config';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../Toast';

export default function ForcePasswordChange({ onComplete }) {
  const { token } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Parola en az 6 karakter olmalıdır');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Parolalar eşleşmiyor');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword })
      });
      if (res.ok) {
        showToast('Parola başarıyla değiştirildi', 'success');
        onComplete();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'İşlem başarısız');
      }
    } catch {
      setError('Sunucuya bağlanılamadı');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔐</div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--text-main)' }}>Parola Değiştirmeniz Gerekiyor</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
            Güvenliğiniz için varsayılan parolayı değiştirin.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="login-error" style={{ marginBottom: 16 }}>
              <span style={{ marginRight: 8 }}>✕</span>{error}
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Yeni Parola</label>
            <input className="modern-input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required autoComplete="new-password" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Parola Tekrar</label>
            <input className="modern-input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: 14 }}>Parolayı Değiştir</button>
        </form>
      </div>
    </div>
  );
}
