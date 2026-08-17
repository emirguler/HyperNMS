import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
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

// Config goruntuleyici. MODUL SEVIYESINDE: bilesen govdesi icinde tanimlanirsa her
// render'da yeniden mount olur ve <pre> kaydirma konumu sifirlanir.
//  - masaustu: bugunku modal BIREBIR ayni
//  - dar govde: .rw-sheet iskeleti (yapisik baslik + tek kaydirma bolgesi + alt bar)
function ConfigViewerModal({ compact, title, subtitle, modal, wrap, onToggleWrap, onDownload, onClose }) {
  const preStyle = {
    margin: 0, flex: 1, overflow: 'auto', padding: '14px 16px',
    fontSize: compact ? '0.8rem' : '0.75rem', lineHeight: 1.5,
    fontFamily: 'monospace', color: modal.error ? 'var(--danger)' : 'var(--text-main)',
    background: 'rgba(0,0,0,0.3)', borderRadius: 8, border: '1px solid var(--border-color)',
    // Telefonda satir kaydirma: 80 kolonluk config satiri icin ikinci bir kaydirma ekseni acmayalim.
    whiteSpace: compact && wrap ? 'pre-wrap' : 'pre',
    overflowWrap: compact && wrap ? 'anywhere' : undefined,
    // Modal arkasindaki sayfaya kaydirma zincirlenmesin (sadece dar govde).
    overscrollBehavior: compact ? 'contain' : undefined,
    WebkitOverflowScrolling: compact ? 'touch' : undefined,
    minHeight: compact ? 0 : undefined,
  };

  if (!compact) {
    return (
      <div className="modal-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal-content" style={{ width: 'min(920px, 92vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{title}</h2>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{subtitle}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <button className="btn btn-ghost btn-sm" onClick={onDownload} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <DownloadIcon size={14} /> {t('download')}
              </button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>
          </div>
          {modal.loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>…</div>
          ) : (
            <pre style={preStyle}>{modal.error ? t('loadFailed') : modal.config}</pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content rw-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="rw-sheet-head">
          <h2>{title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={onToggleWrap} aria-pressed={wrap}
              style={{ minHeight: 40, whiteSpace: 'nowrap' }}>
              {wrap ? 'No wrap' : 'Wrap'}
            </button>
            <button className="rw-sheet-close" onClick={onClose} aria-label="Close" title="Close">&times;</button>
          </div>
        </div>
        {/* Kaydirma TEK yerde olsun: govde sabit, <pre> kayar. */}
        <div className="rw-sheet-body" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8, flexShrink: 0 }}>{subtitle}</div>
          {modal.loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>…</div>
          ) : (
            <pre style={preStyle}>{modal.error ? t('loadFailed') : modal.config}</pre>
          )}
        </div>
        <div className="rw-sheet-foot">
          <button className="btn btn-primary" onClick={onDownload} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <DownloadIcon size={16} /> {t('download')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConfigBackupCard({ deviceId, deviceName }) {
  const { authFetch } = useAuth();
  const { isPhone, isShort, isTouch } = useViewport();
  const compact = isPhone || isShort; // dar govde
  const [list, setList] = useState(null); // null = yükleniyor, [] = boş
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { ts, config, loading, error }
  const [wrap, setWrap] = useState(true);   // telefonda config satirlarini kaydir

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

  // Sabit 400px telefonda ekranin tamamindan buyuk; dar govdede viewport'a baglanir.
  const cardHeight = isShort ? 'clamp(220px, 78vh, 340px)' : isPhone ? 'clamp(260px, 40vh, 400px)' : 400;

  return (
    <div className="chart-container" style={{ height: cardHeight, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, minWidth: 0, padding: '13px 16px', borderBottom: '1px solid var(--border-color)' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t('configBackup')}</h3>
        {/* Dokunmatikte inline 0.7rem/4px'i birak: responsive.css .btn-sm'i 44px'e cikariyor. */}
        <button className="btn btn-ghost btn-sm" onClick={backupNow} disabled={busy}
          style={{ flexShrink: 0, fontSize: isTouch ? undefined : '0.7rem', padding: isTouch ? undefined : '4px 10px' }}>
          {busy ? '…' : t('backupNow')}
        </button>
      </div>

      {/* overscroll SADECE dar govdede: masaustunde liste sonuna gelince tekerlek hareketi
          eskisi gibi .list-container'a zincirlenmeye devam etsin. */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, ...(compact ? { overscrollBehavior: 'contain' } : null) }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <button className="cfg-dl-btn" onClick={(e) => download(b.timestamp, e)} title={t('download')} aria-label={t('download')}><DownloadIcon /></button>
                {/* Hover yoksa satirin tiklanabilir oldugunu gosteren tek isaret bu. */}
                {isTouch && <span aria-hidden="true" style={{ color: 'var(--text-dim)', fontSize: '1.1rem', lineHeight: 1 }}>›</span>}
              </div>
            </div>
          ))
        )}
      </div>

      {modal && (
        <ConfigViewerModal
          compact={compact}
          title={deviceName || deviceId}
          subtitle={`${t('runningConfig')} · ${fmtDate(modal.ts)}`}
          modal={modal}
          wrap={wrap}
          onToggleWrap={() => setWrap((w) => !w)}
          onDownload={() => download(modal.ts)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
