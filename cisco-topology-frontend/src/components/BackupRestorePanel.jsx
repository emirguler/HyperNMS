import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useViewport } from '../hooks/useViewport';
import { API_BASE } from '../config';
import { showToast } from '../Toast';

// Yedek al / geri yukle — Ayarlar hub'indaki "Backup & Restore" kartinin popup icerigi.
export default function BackupRestorePanel() {
  const { authFetch } = useAuth();
  const { fetchData } = useApp();
  // isTouch = (hover: none) -> mobil tarayici; dosya indirme/secme orada guvenilmez.
  const { isPhone, isShort, isTouch } = useViewport();
  const compact = isPhone || isShort;
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
        // Bagsiz (detached) anchor tiklamasi Safari'de yok sayilabiliyor —
        // FindDeviceModal/BulkImportModal ile ayni sekilde once DOM'a ekle.
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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
      {/* Mobil tarayici uyarisi — sadece dokunmatikte basilir, masaustu degismez.
          iOS'ta blob indirmesi sekmede acilir ve .json secici cogu dosyayi gri birakir. */}
      {isTouch && (
        <div style={{ background: 'rgba(250,204,21,0.10)', border: '1px solid rgba(250,204,21,0.30)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          ⚠️ Backup &amp; Restore works best from a desktop browser. On phones and tablets the
          downloaded file may open in a new tab instead of saving, and the file picker can hide
          valid .json backups.
        </div>
      )}

      {/* Export Backup */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: '1.4rem' }}>📤</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Export Backup</h3>
            <p style={{ margin: '4px 0 0', fontSize: compact ? '0.85rem' : '0.8rem', color: 'var(--text-muted)' }}>
              Download all devices, connections, topology pages and users
            </p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleBackup} disabled={downloading} style={{ width: '100%', minHeight: compact ? 44 : undefined }}>
          {downloading ? 'Downloading...' : 'Download Full Backup'}
        </button>
      </div>

      {/* Import Backup */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: '1.4rem' }}>📥</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Import Backup</h3>
            <p style={{ margin: '4px 0 0', fontSize: compact ? '0.85rem' : '0.8rem', color: 'var(--text-muted)' }}>
              Restore devices and connections from a backup file (duplicates skipped)
            </p>
          </div>
        </div>

        {/* iOS dosya secici uzantiya degil UTI'ye bakar: sadece ".json" verilirse
            gecerli yedekler gri kalir. MIME tipleri de listeleniyor. */}
        <input type="file" ref={fileRef} accept=".json,application/json,text/plain" onChange={handleFileSelect} style={{ display: 'none' }} />

        {!restorePreview ? (
          <button className="btn" onClick={() => fileRef.current?.click()}
            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px dashed var(--border-light)', color: 'var(--text-main)', padding: '12px', borderRadius: 8, cursor: 'pointer', minHeight: compact ? 48 : undefined }}>
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
              {/* grid-2col: App.css <=768px'te tek kolona iner (inline grid yapamazdi). */}
              <div className="grid-2col" style={{ gap: '6px 16px', color: 'var(--text-muted)' }}>
                <span>Devices: <strong style={{ color: 'var(--primary)' }}>{restorePreview.devices}</strong></span>
                <span>Connections: <strong style={{ color: 'var(--primary)' }}>{restorePreview.edges}</strong></span>
                <span>Users: <strong style={{ color: 'var(--primary)' }}>{restorePreview.users}</strong></span>
                <span>Topo Pages: <strong style={{ color: 'var(--primary)' }}>{restorePreview.tabs}</strong></span>
              </div>
            </div>
            {/* Telefonda ~95px'lik Cancel'in yaninda ~190px'lik yikici Restore vardi;
                dar govdede alt alta, tam genislik, 48px. Yikici olan en altta. */}
            <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', gap: compact ? 10 : 8 }}>
              <button className="btn btn-ghost" onClick={() => setRestorePreview(null)} style={compact ? { width: '100%', minHeight: 48 } : { flex: 1 }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleRestore} disabled={restoring} style={compact ? { width: '100%', minHeight: 48 } : { flex: 2 }}>
                {restoring ? 'Restoring...' : 'Restore Backup'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
