import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import { showToast } from '../Toast';

export default function SettingsModal({ onClose }) {
  const { token } = useAuth();
  const [downloading, setDownloading] = useState(false);

  const handleBackup = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/backup`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hypernms-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Backup downloaded', 'success');
      } else {
        showToast('Backup failed', 'error');
      }
    } catch {
      showToast('Connection error', 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ width: 450 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>Settings</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Backup */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: '1.5rem' }}>💾</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Configuration Backup</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Download all devices, connections and user list as JSON
              </p>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleBackup} disabled={downloading} style={{ width: '100%' }}>
            {downloading ? 'Downloading...' : 'Download Full Backup'}
          </button>
        </div>

        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
