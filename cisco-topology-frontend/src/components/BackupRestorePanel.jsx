import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { API_BASE } from '../config';
import { showToast } from '../Toast';

// Yedek al / geri yukle — Ayarlar hub'indaki "Backup & Restore" kartinin popup icerigi.
export default function BackupRestorePanel() {
  const { authFetch } = useAuth();
  const { fetchData } = useApp();
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restorePreview, setRestorePreview] = useState(null);
  const fileRef = useRef(null);

  const cardStyle = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--border-color)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  };

  const handleBackup = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/backup`, { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netpulse-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!backup.version || !backup.data) {
          showToast('Invalid backup file', 'error');
          return;
        }
        setRestorePreview({
          backup,
          filename: file.name,
          timestamp: backup.timestamp,
          devices: backup.data.switches?.length || 0,
          edges: backup.data.edges?.length || 0,
          users: backup.data.users?.length || 0,
          tabs: backup.data.topoTabs?.length || 0,
        });
      } catch {
        showToast('Could not parse backup file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!restorePreview) return;
    setRestoring(true);
    try {
      const res = await authFetch('/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restorePreview.backup),
      });
      if (res && res.ok) {
        const data = await res.json();
        const r = data.results;
        showToast(`Restored: ${r.devices} devices, ${r.edges} connections, ${r.users} users`, 'success');
        setRestorePreview(null);
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Restore failed', 'error');
      }
    } catch {
      showToast('Connection error', 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      {/* Export Backup */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: '1.4rem' }}>📤</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Export Backup</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Download all devices, connections, topology pages and users
            </p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleBackup} disabled={downloading} style={{ width: '100%' }}>
          {downloading ? 'Downloading...' : 'Download Full Backup'}
        </button>
      </div>

      {/* Import Backup */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: '1.4rem' }}>📥</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Import Backup</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Restore devices and connections from a backup file (duplicates skipped)
            </p>
          </div>
        </div>

        <input type="file" ref={fileRef} accept=".json" onChange={handleFileSelect} style={{ display: 'none' }} />

        {!restorePreview ? (
          <button className="btn" onClick={() => fileRef.current?.click()}
            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px dashed var(--border-light)', color: 'var(--text-main)', padding: '12px', borderRadius: 8, cursor: 'pointer' }}>
            Select Backup File (.json)
          </button>
        ) : (
          <div>
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 14, marginBottom: 12, fontSize: '0.85rem' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
                <strong style={{ color: 'var(--text-main)' }}>{restorePreview.filename}</strong>
                {restorePreview.timestamp && (
                  <span style={{ marginLeft: 8 }}>({new Date(restorePreview.timestamp).toLocaleDateString()})</span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', color: 'var(--text-muted)' }}>
                <span>Devices: <strong style={{ color: 'var(--primary)' }}>{restorePreview.devices}</strong></span>
                <span>Connections: <strong style={{ color: 'var(--primary)' }}>{restorePreview.edges}</strong></span>
                <span>Users: <strong style={{ color: 'var(--primary)' }}>{restorePreview.users}</strong></span>
                <span>Topo Pages: <strong style={{ color: 'var(--primary)' }}>{restorePreview.tabs}</strong></span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setRestorePreview(null)} style={{ flex: 1 }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleRestore} disabled={restoring} style={{ flex: 2 }}>
                {restoring ? 'Restoring...' : 'Restore Backup'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
