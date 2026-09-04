import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';
import { t } from '../i18n';

// Zafiyet Yonetimi — Cisco PSIRT openVuln + CISA KEV, OFFLINE feed ile.
// Akis: (admin) Export inventory → internetli PC'de tools/vuln-feed → Import feed.
// Eslestirme sunucuda yapilir; bu sayfa yalnizca /vuln/overview'i cizer.

const SEV = ['Critical', 'High', 'Medium', 'Low', 'Informational'];
const SEV_COLOR = {
  Critical: { c: '#f87171', bg: 'rgba(248,113,113,0.14)', bd: 'rgba(248,113,113,0.4)' },
  High: { c: '#fb923c', bg: 'rgba(251,146,60,0.14)', bd: 'rgba(251,146,60,0.4)' },
  Medium: { c: '#facc15', bg: 'rgba(250,204,21,0.12)', bd: 'rgba(250,204,21,0.35)' },
  Low: { c: '#60a5fa', bg: 'rgba(96,165,250,0.12)', bd: 'rgba(96,165,250,0.35)' },
  Informational: { c: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)', bd: 'var(--border-color)' },
};
const chip = (sev, extra) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10,
  fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
  color: (SEV_COLOR[sev] || SEV_COLOR.Informational).c,
  background: (SEV_COLOR[sev] || SEV_COLOR.Informational).bg,
  border: `1px solid ${(SEV_COLOR[sev] || SEV_COLOR.Informational).bd}`, ...extra,
});
const KEV_CHIP = { display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.3, color: '#fff', background: '#dc2626', whiteSpace: 'nowrap' };
const lbl = { color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.5 };
const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? String(iso).slice(0, 10) : d.toLocaleDateString(); };

// Sayim rozetleri (Critical 3 · High 2 ...) — sifirlar gizli
function SevCounts({ counts, compact }) {
  const items = SEV.filter(s => counts && counts[s] > 0);
  if (!items.length) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {items.map(s => <span key={s} style={chip(s)} title={s}>{compact ? s[0] : s} {counts[s]}</span>)}
    </span>
  );
}

export default function VulnPage() {
  const { authFetch, isAdmin } = useAuth();
  const { isPhone, isShort, isTouch } = useViewport();
  const compact = isPhone || isShort;
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('versions'); // versions | devices | advisories
  const [showAcked, setShowAcked] = useState(false);
  const [open, setOpen] = useState(null);      // acik duyuru id'si
  const [importing, setImporting] = useState(false);
  const [sync, setSync] = useState(null);       // /vuln/sync-status
  const [syncing, setSyncing] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [res, sres] = await Promise.all([authFetch('/vuln/overview'), authFetch('/vuln/sync-status')]);
      if (res && res.ok) setData(await res.json());
      if (sres && sres.ok) setSync(await sres.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [authFetch]);
  useEffect(() => { load(); }, [load]);

  // Cevrimici senkron: sunucu Cisco'yu sorgular (surum basina ~1 sn). Yanit gelene kadar bekler.
  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await authFetch('/vuln/sync', { method: 'POST', body: JSON.stringify({}) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { showToast(`${t('vulnSyncOk')} — ${d.lastSync.stats.advisories} / ${d.lastSync.stats.versions}`, 'success'); load(); }
      else showToast(d.error || t('vulnSyncFail'), 'error');
    } catch { showToast(t('vulnSyncFail'), 'error'); }
    finally { setSyncing(false); }
  };

  const exportInventory = async () => {
    try {
      const res = await authFetch('/vuln/inventory');
      if (!res || !res.ok) { showToast(t('operationFailed'), 'error'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `netpulse-vuln-inventory-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { showToast(t('operationFailed'), 'error'); }
  };

  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let obj;
      try { obj = JSON.parse(ev.target.result); } catch { showToast(t('vulnInvalidFile'), 'error'); return; }
      setImporting(true);
      try {
        const res = await authFetch('/vuln/feed', { method: 'POST', body: JSON.stringify(obj) });
        const d = res ? await res.json().catch(() => ({})) : {};
        if (res && res.ok) { showToast(`${t('vulnImportOk')} — ${d.advisories} / ${d.versions}`, 'success'); load(); }
        else showToast(d.error || t('vulnImportFail'), 'error');
      } catch { showToast(t('vulnImportFail'), 'error'); }
      finally { setImporting(false); }
    };
    reader.readAsText(file);
  };

  const ack = async (id, note, on) => {
    const res = await authFetch(`/vuln/ack/${encodeURIComponent(id)}`, on ? { method: 'PUT', body: JSON.stringify({ note }) } : { method: 'DELETE' });
    if (res && res.ok) { showToast(on ? t('vulnAcked') : t('vulnUnacked'), 'success'); load(); }
    else showToast(t('operationFailed'), 'error');
  };

  const advMap = useMemo(() => Object.fromEntries(((data && data.advisories) || []).map(a => [a.id, a])), [data]);
  const visibleAdvisories = useMemo(() => ((data && data.advisories) || []).filter(a => showAcked || !a.acked), [data, showAcked]);
  const feed = data && data.feed;
  const s = (data && data.summary) || { counts: {} };

  const tile = (label, value, color) => (
    <div className="chart-container dash-stat-card">
      <h3 className="dash-stat-label">{label}</h3>
      <p className="dash-stat-value" style={color ? { color } : undefined}>{value}</p>
    </div>
  );

  return (
    <div className="list-container">
      {/* Baslik + feed durumu + admin eylemleri */}
      <div className="rw-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: compact ? '1.15rem' : '1.4rem' }}>🛡️ {t('vulnTitle')}</h2>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {feed && feed.loaded ? (
              <>
                {t('vulnFeedDate')}: <strong style={{ color: 'var(--text-main)' }}>{fmtDate(feed.generatedAt)}</strong>
                {feed.staleDays != null && (
                  <span style={{ marginLeft: 8, color: feed.staleDays > 30 ? 'var(--danger)' : feed.staleDays > 14 ? 'var(--warning)' : 'var(--text-muted)' }}>
                    ({feed.staleDays} {t('licDaysWord')})
                  </span>
                )}
                <span style={{ marginLeft: 10 }}>· {feed.advisoryCount} {t('vulnAdvisories').toLowerCase()} · {feed.versionCount} {t('vulnVersions').toLowerCase()}{feed.kevCount != null ? ` · KEV ${feed.kevCount}` : ''}</span>
              </>
            ) : t('vulnNoFeedShort')}
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Cevrimici mod (kimlik ayarlarda) — birincil. Offline export/import yedek yol. */}
            <button className="btn btn-primary btn-sm" onClick={runSync} disabled={syncing || !(sync && sync.configured) || (sync && sync.running)}
              title={sync && sync.configured ? '' : t('vulnSyncNotConfigured')}>
              🔄 {syncing || (sync && sync.running) ? t('vulnSyncing') : t('vulnSyncNow')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportInventory}>📤 {t('vulnExportInv')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={importing}>
              📥 {importing ? t('loading') : t('vulnImportFeed')}
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} style={{ display: 'none' }} />
          </div>
        )}
      </div>
      {sync && sync.lastSync && (
        <div style={{ fontSize: '0.76rem', color: sync.lastSync.ok ? 'var(--text-muted)' : 'var(--danger)', marginTop: -8, marginBottom: 12 }}>
          {t('vulnLastSync')}: {new Date(sync.lastSync.at).toLocaleString()} · {sync.lastSync.ok ? '✓' : `✕ ${sync.lastSync.error}`}
          {sync.autoSync ? ` · ${t('vulnSetAuto')} ${String(sync.syncHour).padStart(2, '0')}:00` : ''}
        </div>
      )}

      {/* Ozet kartlari */}
      <div className="grid-stats" style={{ marginBottom: 16, gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)' }}>
        {tile('Critical', s.counts.Critical || 0, s.counts.Critical ? SEV_COLOR.Critical.c : undefined)}
        {tile('High', s.counts.High || 0, s.counts.High ? SEV_COLOR.High.c : undefined)}
        {tile('Medium', s.counts.Medium || 0, s.counts.Medium ? SEV_COLOR.Medium.c : undefined)}
        {tile(t('vulnKev'), s.kev || 0, s.kev ? '#dc2626' : undefined)}
        {tile(t('vulnAffected'), s.affectedDevices || 0, s.affectedDevices ? 'var(--warning)' : 'var(--success)')}
        {tile(t('vulnUnknown'), s.unknownDevices || 0, s.unknownDevices ? 'var(--text-muted)' : undefined)}
      </div>

      {/* Feed yok → 3 adimli yonerge */}
      {!loading && (!feed || !feed.loaded) && (
        <div className="chart-container" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>{t('vulnNoFeedTitle')}</div>
          <div style={{ color: 'var(--text-main)', fontSize: '0.88rem', lineHeight: 1.7, marginBottom: 8 }}>
            <strong>{t('vulnOnlineTitle')}</strong> — {t('vulnOnlineStep')}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 4 }}>{t('vulnOfflineTitle')}</div>
          <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: '0.84rem', lineHeight: 1.7 }}>
            <li>{t('vulnStep1')}</li>
            <li>{t('vulnStep2')} <code style={{ fontSize: '0.8rem' }}>tools/vuln-feed/README.md</code></li>
            <li>{t('vulnStep3')}</li>
          </ol>
        </div>
      )}

      {/* Sekmeler */}
      <div className="topology-tabs rw-scroll-x" style={{ marginBottom: 12, flexWrap: isTouch ? 'nowrap' : 'wrap' }}>
        {[['versions', `${t('vulnByVersion')} (${(data && data.byVersion.length) || 0})`],
          ['devices', `${t('devices')} (${(data && data.devices.length) || 0})`],
          ['advisories', `${t('vulnAdvisories')} (${visibleAdvisories.length})`]].map(([k, label]) => (
          <div key={k} className={`topology-tab ${tab === k ? 'active' : ''}`} role="button" tabIndex={0}
            onClick={() => setTab(k)} onKeyDown={e => { if (e.key === 'Enter') setTab(k); }}>{label}</div>
        ))}
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0 10px', whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAcked} onChange={e => setShowAcked(e.target.checked)} /> {t('vulnShowAcked')} ({s.acked || 0})
        </label>
      </div>

      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>⏳ {t('loading')}…</div>
        ) : tab === 'versions' ? (
          <div className="rw-scroll-x"><table className="modern-table rw-cards">
            <thead><tr>
              <th>{t('vulnVersion')}</th><th>OS</th><th>{t('devices')}</th><th>{t('vulnAdvisories')}</th>
              <th className="rw-hide-sm">{t('vulnWorst')}</th><th>KEV</th><th className="rw-hide-sm">{t('vulnFixedIn')}</th>
            </tr></thead>
            <tbody>
              {(data.byVersion || []).length ? data.byVersion.map(g => (
                <tr key={g.key} style={{ cursor: g.advisories.length ? 'pointer' : undefined }}
                  onClick={() => { if (g.advisories.length) { setTab('advisories'); } }}>
                  <td data-label="Name"><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{g.display}</span>
                    {g.scan === 'unknown' && <span style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--warning)' }}>{t('vulnUnknown')}</span>}</td>
                  <td data-label="OS" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{g.osType === 'iosxe' ? 'IOS-XE' : 'IOS'}</td>
                  <td data-label={t('devices')}><strong>{g.deviceCount}</strong></td>
                  <td data-label={t('vulnAdvisories')}><SevCounts counts={g.counts} compact={compact} /></td>
                  <td className="rw-hide-sm" data-label={t('vulnWorst')} style={{ fontFamily: 'monospace', color: g.worstCvss >= 9 ? SEV_COLOR.Critical.c : g.worstCvss >= 7 ? SEV_COLOR.High.c : 'var(--text-main)' }}>{g.worstCvss ?? '—'}</td>
                  <td data-label="KEV">{g.kev ? <span style={KEV_CHIP}>{g.kev}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td className="rw-hide-sm" data-label={t('vulnFixedIn')} style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--success)' }}>{g.fixedIn.length ? g.fixedIn.join(', ') : '—'}</td>
                </tr>
              )) : <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', justifyContent: 'center' }}>{t('vulnNoCisco')}</td></tr>}
            </tbody>
          </table></div>
        ) : tab === 'devices' ? (
          <div className="rw-scroll-x"><table className="modern-table rw-cards">
            <thead><tr>
              <th>{t('deviceName')}</th><th className="rw-hide-sm">IP</th><th>{t('vulnVersion')}</th><th>{t('vulnState')}</th><th>{t('vulnAdvisories')}</th><th className="rw-hide-sm">{t('vulnWorst')}</th><th>KEV</th>
            </tr></thead>
            <tbody>
              {data.devices.map(d => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${d.id}`)}>
                  <td data-label="Name"><span style={{ fontWeight: 600 }}>{d.name}</span>{d.model && <span style={{ marginLeft: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>{d.model}</span>}</td>
                  <td className="rw-hide-sm" data-label="IP" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{d.ip}</td>
                  <td data-label={t('vulnVersion')} style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{d.version || '—'}</td>
                  <td data-label={t('vulnState')}>
                    {d.scan === 'affected' && <span style={chip(worst(d.counts))}>{t('vulnAffectedOne')}</span>}
                    {d.scan === 'clean' && <span className="status-badge status-up">{t('vulnClean')}</span>}
                    {d.scan === 'unknown' && <span style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>{t('vulnUnknown')}</span>}
                    {d.scan === 'no-version' && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('vulnNoVersion')}</span>}
                    {d.scan === 'not-covered' && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('vulnNotCovered')}</span>}
                  </td>
                  <td data-label={t('vulnAdvisories')}><SevCounts counts={d.counts} compact={compact} /></td>
                  <td className="rw-hide-sm" data-label={t('vulnWorst')} style={{ fontFamily: 'monospace' }}>{d.worstCvss ?? '—'}</td>
                  <td data-label="KEV">{d.kev ? <span style={KEV_CHIP}>{d.kev}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="rw-scroll-x"><table className="modern-table rw-cards">
            <thead><tr>
              <th>{t('vulnSeverity')}</th><th>{t('vulnAdvisory')}</th><th className="rw-hide-sm">CVSS</th><th>{t('devices')}</th><th className="rw-hide-sm">{t('vulnPublished')}</th><th>KEV</th>
            </tr></thead>
            <tbody>
              {visibleAdvisories.length ? visibleAdvisories.map(a => (
                <tr key={a.id} style={{ cursor: 'pointer', opacity: a.acked ? 0.55 : 1 }} onClick={() => setOpen(a.id)}>
                  <td data-label={t('vulnSeverity')}><span style={chip(a.sir)}>{a.sir}</span>{a.acked && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>✓ {t('vulnAckedShort')}</span>}</td>
                  <td data-label="Name"><div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{a.title}</div><div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{a.id}</div></td>
                  <td className="rw-hide-sm" data-label="CVSS" style={{ fontFamily: 'monospace' }}>{a.cvss ?? '—'}</td>
                  <td data-label={t('devices')}><strong>{a.deviceCount}</strong></td>
                  <td className="rw-hide-sm" data-label={t('vulnPublished')} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{fmtDate(a.firstPublished)}</td>
                  <td data-label="KEV">{a.kev ? <span style={KEV_CHIP}>KEV</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                </tr>
              )) : <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', justifyContent: 'center' }}>{feed && feed.loaded ? t('vulnNoneAffecting') : t('vulnNoFeedShort')}</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>

      {open && advMap[open] && (
        <AdvisoryModal a={advMap[open]} devices={data.devices} isAdmin={isAdmin} compact={compact}
          onClose={() => setOpen(null)} onAck={(note, on) => ack(open, note, on)} onDevice={(id) => { setOpen(null); navigate(`/devices/${id}`); }} />
      )}
    </div>
  );
}

function worst(counts) { for (const s of SEV) if (counts && counts[s] > 0) return s; return 'Informational'; }

// Duyuru detayi — modul seviyesinde (her render'da remount olmasin)
function AdvisoryModal({ a, devices, isAdmin, compact, onClose, onAck, onDevice }) {
  const [note, setNote] = useState((a.ack && a.ack.note) || '');
  const affected = devices.filter(d => a.deviceIds.includes(d.id));
  const fixedEntries = Object.entries(a.firstFixed || {});
  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className={compact ? 'modal-content rw-sheet' : 'modal-content'} style={{ width: 720, maxWidth: '95vw', maxHeight: '88dvh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className={compact ? 'rw-sheet-head' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: compact ? 0 : 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={chip(a.sir)}>{a.sir}</span>
              {a.cvss != null && <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>CVSS {a.cvss}</span>}
              {a.kev && <span style={KEV_CHIP}>KEV · {t('vulnKevLong')}</span>}
              {a.acked && <span className="status-badge" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>✓ {t('vulnAckedShort')} · {a.ack.by}</span>}
            </div>
            <h2 style={{ margin: 0, fontSize: compact ? '1rem' : '1.1rem', lineHeight: 1.35 }}>{a.title}</h2>
            <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{a.id} · {t('vulnPublished')} {fmtDate(a.firstPublished)} · {t('vulnUpdated')} {fmtDate(a.lastUpdated)}</div>
          </div>
          <button onClick={onClose} className={compact ? 'rw-sheet-close rw-tap' : 'rw-tap'} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', flexShrink: 0 }}>&times;</button>
        </div>

        <div className={compact ? 'rw-sheet-body' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {a.summary && <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.55, color: 'var(--text-main)' }}>{a.summary}</p>}

          <div>
            <span style={lbl}>CVE</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {a.cves.map(c => <span key={c} style={{ fontFamily: 'monospace', fontSize: '0.78rem', padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)' }}>{c}{a.kevInfo.some(k => k.cve === c) && <span style={{ ...KEV_CHIP, marginLeft: 6, padding: '0 5px' }}>KEV</span>}</span>)}
              {!a.cves.length && <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </div>
          </div>

          {fixedEntries.length > 0 && (
            <div>
              <span style={lbl}>{t('vulnFixedIn')}</span>
              <div style={{ marginTop: 6, fontSize: '0.82rem', fontFamily: 'monospace' }}>
                {fixedEntries.map(([k, list]) => (
                  <div key={k} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '3px 0' }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 140 }}>{k.split('|')[1]}</span>
                    <span style={{ color: 'var(--success)' }}>→ {(list || []).join(', ') || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <span style={lbl}>{t('vulnAffected')} ({affected.length})</span>
            <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
              {affected.map(d => (
                <div key={d.id} onClick={() => onDevice(d.id)} className="notif-clickable"
                  style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.82rem', cursor: 'pointer' }}>
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{d.ip}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{d.version}</span>
                </div>
              ))}
            </div>
          </div>

          {a.products && a.products.length > 0 && (
            <div><span style={lbl}>{t('vulnProducts')}</span>
              <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{a.products.slice(0, 12).join(' · ')}{a.products.length > 12 ? ` · +${a.products.length - 12}` : ''}</div></div>
          )}

          {isAdmin && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
              <span style={lbl}>{t('vulnAck')}</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <input className="modern-input" value={note} onChange={e => setNote(e.target.value)} placeholder={t('vulnNote')} maxLength={300} style={{ flex: '1 1 240px', minWidth: 0 }} disabled={a.acked} />
                {a.acked
                  ? <button className="btn btn-ghost btn-sm" onClick={() => onAck('', false)}>{t('vulnUnack')}</button>
                  : <button className="btn btn-primary btn-sm" onClick={() => onAck(note, true)}>✓ {t('vulnAck')}</button>}
              </div>
              {a.acked && a.ack && a.ack.note && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>“{a.ack.note}” — {a.ack.by}, {fmtDate(a.ack.at)}</div>}
            </div>
          )}
        </div>

        <div className={compact ? 'rw-sheet-foot' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: compact ? 0 : 14 }}>
          {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">{t('vulnOpenCisco')} ↗</a> : <span />}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  );
}
