import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fmtFile = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};

const DownloadIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export default function ConfigBackupCard({ deviceId, deviceName }) {
  const { authFetch } = useAuth();
  const [list, setList] = useState(null); // null = yükleniyor, [] = boş
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { ts, config, loading, error }

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/switches/${deviceId}/config-backups`);
      setList(res && res.ok ? await res.json() : []);
    } catch (e) { setList([]); }
  }, [deviceId, authFetch]);

  useEffect(() => { load(); }, [load]);

  const backupNow = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`/switches/${deviceId}/config-backups/run`, { method: 'POST' });
      if (res && res.ok) { const d = await res.json(); setList(d.backups || []); }
    } catch (e) { /* ignore */ } finally { setBusy(false); }
  };

  const openView = async (ts) => {
    setModal({ ts, config: null, loading: true });
    try {
      const res = await authFetch(`/switches/${deviceId}/config-backups/${ts}`);
      if (res && res.ok) { const d = await res.json(); setModal({ ts, config: d.config, loading: false }); }
      else setModal({ ts, config: '', loading: false, error: true });
    } catch (e) { setModal({ ts, config: '', loading: false, error: true }); }
  };

  const download = async (ts, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await authFetch(`/switches/${deviceId}/config-backups/${ts}`);
      if (!res || !res.ok) return;
      const d = await res.json();
      const blob = new Blob([d.config || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${String(deviceName || deviceId).replace(/[^a-zA-Z0-9_.-]/g, '_')}-${fmtFile(ts)}.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e2) { /* ignore */ }
  };

  return (
    <div className="chart-container" style={{ height: 400, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--border-color)' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>{t('configBackup')}</h3>
        <button className="btn btn-ghost btn-sm" onClick={backupNow} disabled={busy} style={{ fontSize: '0.7rem', padding: '4px 10px' }}>
          {busy ? '…' : t('backupNow')}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {list === null ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.7 }}>
            {t('noBackupsYet')}<br />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{t('backupHint')}</span>
          </div>
        ) : (
          list.map((b) => (
            <div key={b.timestamp} className="cfg-backup-row" onClick={() => openView(b.timestamp)} title={t('viewConfig')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 500 }}>{fmtDate(b.timestamp)}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 1 }}>{b.lines} {t('linesShort')} · {(b.size / 1024).toFixed(1)} KB</div>
              </div>
              <button className="cfg-dl-btn" onClick={(e) => download(b.timestamp, e)} title={t('download')}><DownloadIcon /></button>
            </div>
          ))
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)} onKeyDown={(e) => { if (e.key === 'Escape') setModal(null); }}>
          <div className="modal-content" style={{ width: 'min(920px, 92vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{deviceName || deviceId}</h2>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('runningConfig')} · {fmtDate(modal.ts)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => download(modal.ts)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <DownloadIcon size={14} /> {t('download')}
                </button>
                <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
              </div>
            </div>
            {modal.loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>…</div>
            ) : (
              <pre style={{
                margin: 0, flex: 1, overflow: 'auto', padding: '14px 16px', fontSize: '0.75rem', lineHeight: 1.5,
                fontFamily: 'monospace', color: modal.error ? 'var(--danger)' : 'var(--text-main)',
                background: 'rgba(0,0,0,0.3)', borderRadius: 8, border: '1px solid var(--border-color)', whiteSpace: 'pre'
              }}>
                {modal.error ? t('loadFailed') : modal.config}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
