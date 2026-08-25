import { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useViewport } from '../hooks/useViewport';
import { API_BASE } from '../config';
import { downloadAuthedUrl } from '../native/apiClient';
import { showToast } from '../Toast';

/* ============================================================================
   SESSION LOG - kaydedilmis SSH oturumlari (yalnizca Administrator)

   Sol kart: Command-line sayfasindaki hedef paneliyle ayni desen (sayfa secimi +
   arama + cihaz listesi) - burada cok secim degil, TEK cihaza gore filtre.
   Sag kart: oturum tablosu + filtreler. Satira dokununca transcript acilir.
   ========================================================================== */

// ANSI kacislari: transcript'te ham duruyor (oynatma icin degerli), ama duz
// okumada gorsel kirlilik yapiyor -> goruntulerken temizlenir.
const ANSI = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;

const fmtDate = (iso, short) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return short
    ? d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString();
};

const fmtDur = (ms) => {
  if (ms === null || ms === undefined) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
};

const fmtBytes = (b) => {
  if (!b) return '-';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
};

const MODE_STYLE = {
  full: { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7', bd: 'rgba(168,85,247,0.3)', label: 'Full' },
  restricted: { bg: 'rgba(59,130,246,0.15)', fg: '#60a5fa', bd: 'rgba(59,130,246,0.3)', label: 'Restricted' },
};

const chip = (s) => ({
  background: s.bg, color: s.fg, border: `1px solid ${s.bd}`,
  padding: '3px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap',
});

/** Transcript goruntuleyici — telefonda alt sayfa, masaustunde modal. */
function TranscriptModal({ session, rendered, entries, loading, onClose, onDownload, compact }) {
  const [wrap, setWrap] = useState(true);
  // Sunucu 'rendered' doner: kontrol karakterleri (backspace, \r, imlec dizileri)
  // UYGULANMIS hali - yazarken duzeltilen komutlar artik silinmis harfleriyle
  // birlikte gorunmuyor. Eski bir sunucuya karsi calisilirsa ham birlestirmeye duser.
  const text = useMemo(() => {
    if (typeof rendered === 'string') return rendered;
    return (entries || []).map(e => (e.c !== undefined ? `\n[command] ${e.c}\n` : e.d)).join('').replace(ANSI, '');
  }, [rendered, entries]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content rw-sheet" onClick={e => e.stopPropagation()}
        style={{ width: 900, maxWidth: '100%', display: 'flex', flexDirection: 'column', maxHeight: compact ? undefined : '86vh' }}>
        <div className="rw-sheet-head" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div className="rw-truncate" style={{ fontWeight: 700, color: 'var(--text-main)' }}>{session.deviceName}</div>
            <div className="rw-truncate" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {session.deviceIp} · {session.username} · {fmtDate(session.startedAt)}
            </div>
          </div>
          <button type="button" className="rw-sheet-close rw-tap" onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', lineHeight: 1, cursor: 'pointer' }}>&times;</button>
        </div>

        <div className="rw-sheet-body" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading transcript…</div>
          ) : (
            <pre style={{
              margin: 0, padding: '12px 14px',
              fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
              fontSize: compact ? '0.72rem' : '0.8rem', lineHeight: 1.45, color: 'var(--text-main)',
              whiteSpace: wrap ? 'pre-wrap' : 'pre',
              overflowWrap: wrap ? 'anywhere' : 'normal',
            }}>{text || '(empty)'}</pre>
          )}
        </div>

        <div className="rw-sheet-foot" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)', minHeight: 44, cursor: 'pointer' }}>
            <input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} /> Wrap
          </label>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {fmtBytes(session.bytes)}{session.truncated ? ' · truncated' : ''}
          </span>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={onDownload}>Download .log</button>
        </div>
      </div>
    </div>
  );
}

export default function SessionLogPage() {
  const { authFetch, isAdmin, username } = useAuth();
  const { rawDevices, topoTabs } = useApp();
  // Erken return'un USTUNDE cagrilmali, yoksa hook sirasi bozulur
  const { isPhone, isShort, isTouch, height: vpH } = useViewport();
  const compact = isPhone || isShort;
  const stacked = isPhone;                 // tablette yan yana kalir
  // Kayit silme yalnizca yerlesik "admin" superkullanicisina acik
  const isSuperAdmin = username === 'admin';

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  // --- filtreler ---
  const [deviceId, setDeviceId] = useState('');
  const [page, setPage] = useState('');
  const [user, setUser] = useState('');
  const [mode, setMode] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [content, setContent] = useState('');   // transcript ICINDE arama
  const [contentQ, setContentQ] = useState(''); // debounce edilmis hali

  const [search, setSearch] = useState('');     // sol karttaki cihaz aramasi
  const [targetsOpen, setTargetsOpen] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // null | session | 'all'
  const [entries, setEntries] = useState([]);
  const [rendered, setRendered] = useState(null);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Transcript aramasi her tusta tum dosyalari taramasin
  useEffect(() => {
    const id = setTimeout(() => setContentQ(content.trim()), 450);
    return () => clearTimeout(id);
  }, [content]);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (deviceId) p.set('deviceId', deviceId);
    if (page) p.set('page', page);
    if (user) p.set('user', user);
    if (mode) p.set('mode', mode);
    if (liveOnly) p.set('live', 'true');
    if (since) p.set('since', since);
    if (until) p.set('until', new Date(until + 'T23:59:59').toISOString());
    if (contentQ) p.set('content', contentQ);
    const res = await authFetch('/sessions?' + p.toString());
    if (res && res.ok) {
      const d = await res.json();
      setSessions(d.sessions || []);
    }
    setLoading(false);
  }, [authFetch, deviceId, page, user, mode, liveOnly, since, until, contentQ]);

  useEffect(() => {
    load();
    // Canli oturumlar icin periyodik tazeleme
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [load]);

  const openTranscript = async (s) => {
    setViewing(s);
    setEntriesLoading(true);
    setEntries([]);
    setRendered(null);
    const res = await authFetch(`/sessions/${s.id}/transcript`);
    if (res && res.ok) {
      const d = await res.json();
      setEntries(d.entries || []);
      setRendered(typeof d.rendered === 'string' ? d.rendered : null);
    }
    setEntriesLoading(false);
  };

  const download = (s) => {
    // API_BASE sart: gelistirmede prefix bos + origin http://localhost:4000,
    // production'da ayni origin uzerinde '/api'. Sabit '/api' yazmak gelistirmede
    // 404 verirdi.
    // Native'de yeni sekme yok + cookie tasinmaz: istek token'la yapilip dosya
    // cihaza kaydedilir. Web'de davranis aynen eskisi gibi (yeni sekme).
    downloadAuthedUrl(`${API_BASE}/sessions/${s.id}/download`, `session-${s.id}.log`);
  };

  const kill = async (s) => {
    const res = await authFetch(`/sessions/${s.id}/kill`, { method: 'POST' });
    if (res && res.ok) { showToast('Session terminated', 'success'); load(); }
    else showToast('Could not terminate session', 'error');
  };

  // Silme (yalnizca "admin"). confirm: null | session-objesi | 'all'
  const doDeleteOne = async (s) => {
    const res = await authFetch(`/sessions/${s.id}`, { method: 'DELETE' });
    if (res && res.ok) { showToast('Session log deleted', 'success'); if (viewing && viewing.id === s.id) setViewing(null); load(); }
    else { const d = res ? await res.json().catch(() => ({})) : {}; showToast(d.error || 'Could not delete', 'error'); }
    setConfirmDelete(null);
  };
  const doDeleteAll = async () => {
    const res = await authFetch('/sessions', { method: 'DELETE' });
    if (res && res.ok) { const d = await res.json().catch(() => ({})); showToast(`${d.removed || 0} session log(s) deleted`, 'success'); setViewing(null); load(); }
    else { const d = res ? await res.json().catch(() => ({})) : {}; showToast(d.error || 'Could not delete', 'error'); }
    setConfirmDelete(null);
  };

  // Sol kart: sayfaya + aramaya gore cihazlar
  const devices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rawDevices || [])
      .filter(d => !page || (d.topologyPage || 'main') === page)
      .filter(d => !q || (d.name || '').toLowerCase().includes(q) || (d.ip || '').toLowerCase().includes(q));
  }, [rawDevices, page, search]);

  // Kullanici listesi kayitlardan turetilir (ayri bir istek gerekmez)
  const users = useMemo(
    () => [...new Set(sessions.map(s => s.username).filter(Boolean))].sort(),
    [sessions]
  );

  const clearFilters = () => {
    setDeviceId(''); setPage(''); setUser(''); setMode('');
    setLiveOnly(false); setSince(''); setUntil(''); setContent(''); setSearch('');
  };
  const anyFilter = deviceId || page || user || mode || liveOnly || since || until || content;

  const labelStyle = { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };

  return (
    <div className="list-container">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Session Log</h2>
        <p className="rw-hide-short" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
          Recorded SSH sessions. Only device output is stored — keystrokes are never recorded, so passwords typed at an <code>enable</code> prompt never reach the log.
        </p>
      </div>

      <div style={{ display: 'flex', gap: compact ? 12 : 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* SOL: cihaz secimi (Command-line sayfasiyla ayni desen) */}
        <div className="chart-container" style={{
          flex: stacked ? '1 1 100%' : (isShort ? '1 1 280px' : '1 1 300px'),
          minWidth: 0, maxWidth: stacked ? '100%' : 360,
          padding: 0, display: 'flex', flexDirection: 'column',
          // Yigin modunda ic kaydirici yok: .list-container'in ustune ucuncu bir
          // kaydirma ekseni binmesin.
          maxHeight: stacked ? 'none' : (isShort ? Math.max(180, vpH - 92) : 620),
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '1rem', color: 'var(--primary)' }}>Devices</h3>
            <label style={labelStyle}>Topology page</label>
            <select className="modern-input" value={page} onChange={e => { setPage(e.target.value); setDeviceId(''); }} style={{ width: '100%', marginBottom: 10 }}>
              <option value="">All pages</option>
              {(topoTabs || []).map(tab => <option key={tab.id} value={tab.id}>{tab.name}</option>)}
            </select>
            {/* type="search" yalnizca dokunmatikte: masaustu Chrome'da temizleme (x) cizer */}
            <input
              className="modern-input"
              type={isTouch ? 'search' : 'text'}
              enterKeyHint="search"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search device or IP…"
              style={{ width: '100%' }}
            />
            {stacked && (
              <button type="button" onClick={() => setTargetsOpen(o => !o)} style={{
                marginTop: 10, width: '100%', minHeight: 44, display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 8, padding: '0 12px', cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8,
                color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
              }}>
                <span>{deviceId ? (devices.find(d => d.id === deviceId)?.name || '1 device') : `${devices.length} devices`}</span>
                <span style={{ fontSize: '0.9rem' }}>{targetsOpen ? '▾' : '▸'}</span>
              </button>
            )}
          </div>

          {(!stacked || targetsOpen) && (
            <div style={{
              flex: 1, minHeight: 100,
              overflowY: stacked ? 'visible' : 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: (isTouch && !stacked) ? 'contain' : undefined,
            }}>
              <button type="button" onClick={() => setDeviceId('')} style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px',
                minHeight: isTouch ? 48 : undefined, cursor: 'pointer', fontFamily: 'inherit',
                background: !deviceId ? 'var(--primary-light)' : 'transparent',
                border: 'none', borderBottom: '1px solid var(--border-color)',
                color: !deviceId ? 'var(--primary)' : 'var(--text-muted)', fontSize: '0.83rem', fontWeight: 600,
              }}>All devices</button>
              {devices.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No devices</div>
              ) : devices.map(d => (
                <button key={d.id} type="button" onClick={() => setDeviceId(d.id === deviceId ? '' : d.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '8px 16px', minHeight: isTouch ? 48 : undefined, boxSizing: 'border-box',
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: d.id === deviceId ? 'var(--primary-light)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--border-color)',
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: d.status === 'UP' ? 'var(--success)' : 'var(--danger)' }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="rw-truncate" style={{ display: 'block', fontSize: '0.83rem', fontWeight: 500, color: d.id === deviceId ? 'var(--primary)' : 'var(--text-main)' }}>{d.name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{d.ip}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* SAG: oturumlar */}
        <div className="chart-container" style={{ flex: '1 1 420px', minWidth: 0, padding: 0 }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
            <div className="rw-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>
                Sessions <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.8rem' }}>({sessions.length})</span>
              </h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {anyFilter && <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>}
                {/* Tumunu sil: yalnizca "admin", ve silinecek (canli olmayan) kayit varsa */}
                {isSuperAdmin && sessions.some(s => !s.isLive) && (
                  <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete('all')}>Delete all</button>
                )}
              </div>
            </div>

            {/* Filtre izgarasi: telefonda tek kolon, tablette iki, masaustunde dort */}
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <div>
                <label style={labelStyle}>User</label>
                <select className="modern-input" value={user} onChange={e => setUser(e.target.value)} style={{ width: '100%' }}>
                  <option value="">All users</option>
                  {users.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Mode</label>
                <select className="modern-input" value={mode} onChange={e => setMode(e.target.value)} style={{ width: '100%' }}>
                  <option value="">All modes</option>
                  <option value="full">Full (Administrator)</option>
                  <option value="restricted">Restricted (Operator)</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>From</label>
                <input className="modern-input" type="date" value={since} onChange={e => setSince(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={labelStyle}>To</label>
                <input className="modern-input" type="date" value={until} onChange={e => setUntil(e.target.value)} style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>Search inside transcripts</label>
              <input
                className="modern-input"
                type={isTouch ? 'search' : 'text'}
                enterKeyHint="search"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={content} onChange={e => setContent(e.target.value)}
                placeholder='e.g. "vlan 130" — finds who touched it'
                style={{ width: '100%' }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer', minHeight: isTouch ? 44 : undefined }}>
              <input type="checkbox" checked={liveOnly} onChange={e => setLiveOnly(e.target.checked)} /> Live sessions only
            </label>
          </div>

          <div className="rw-scroll-x">
            <table className="modern-table rw-cards">
              <thead>
                <tr>
                  <th style={{ paddingLeft: compact ? undefined : 20 }}>Session</th>
                  <th className="rw-hide-md">Topology</th>
                  <th>IP</th>
                  <th>Started</th>
                  <th className="rw-hide-md">Duration</th>
                  <th>User</th>
                  <th className="rw-hide-md">Mode</th>
                  <th style={{ textAlign: 'right', paddingRight: compact ? undefined : 20 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="8" style={{ textAlign: 'center', justifyContent: 'center', padding: 30, color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan="8" style={{ textAlign: 'center', justifyContent: 'center', padding: 30, color: 'var(--text-muted)' }}>
                    {anyFilter ? 'No sessions match these filters' : 'No SSH sessions recorded yet'}
                  </td></tr>
                ) : sessions.map(s => (
                  <tr key={s.id}>
                    <td data-label="Session" style={{ paddingLeft: compact ? undefined : 20 }}>
                      <span className="rw-truncate" style={{ fontWeight: 600, display: 'inline-block', maxWidth: '100%' }}>{s.deviceName}</span>
                      {s.isLive && (
                        <span style={{ ...chip({ bg: 'rgba(34,197,94,0.15)', fg: 'var(--success)', bd: 'rgba(34,197,94,0.35)' }), marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />LIVE
                        </span>
                      )}
                      {s.truncated && <span style={{ ...chip({ bg: 'rgba(245,158,11,0.15)', fg: 'var(--warning)', bd: 'rgba(245,158,11,0.35)' }), marginLeft: 6 }}>truncated</span>}
                    </td>
                    <td data-label="Topology" className="rw-hide-md" style={{ color: 'var(--text-muted)' }}>{s.topologyName}</td>
                    <td data-label="IP" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{s.deviceIp}</td>
                    <td data-label="Started" style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.startedAt, compact)}</td>
                    <td data-label="Duration" className="rw-hide-md" style={{ color: 'var(--text-muted)' }}>{s.isLive ? 'running' : fmtDur(s.durationMs)}</td>
                    <td data-label="User" style={{ fontWeight: 500 }}>{s.username}</td>
                    <td data-label="Mode" className="rw-hide-md">
                      <span style={chip(MODE_STYLE[s.mode] || MODE_STYLE.restricted)}>{(MODE_STYLE[s.mode] || MODE_STYLE.restricted).label}</span>
                    </td>
                    <td data-label="" style={{ textAlign: 'right', paddingRight: compact ? undefined : 20, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary btn-sm" style={{ marginRight: 6 }} onClick={() => openTranscript(s)}>View</button>
                      {s.isLive && <button className="btn btn-danger btn-sm" style={{ marginRight: isSuperAdmin ? 6 : 0 }} onClick={() => kill(s)}>Kill</button>}
                      {/* Silme yalnizca "admin"e ve canli OLMAYAN kayda acik */}
                      {isSuperAdmin && !s.isLive && (
                        <button className="btn btn-ghost btn-sm" title="Delete this session log"
                          style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(s)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {viewing && (
        <TranscriptModal
          session={viewing}
          entries={entries}
          rendered={rendered}
          loading={entriesLoading}
          compact={compact}
          onClose={() => setViewing(null)}
          onDownload={() => download(viewing)}
        />
      )}

      {/* Silme onayi — yikici ve geri alinamaz */}
      {confirmDelete && (
        <div className="modal-overlay" style={{ zIndex: 2200 }} onClick={() => setConfirmDelete(null)}
          onKeyDown={e => { if (e.key === 'Escape') setConfirmDelete(null); }}>
          <div className="confirm-modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="confirm-title">
              {confirmDelete === 'all' ? 'Delete all session logs' : 'Delete session log'}
            </h3>
            <p className="confirm-desc">
              {confirmDelete === 'all'
                ? 'Permanently delete every recorded session (live ones are kept). Transcripts cannot be recovered.'
                : <>Permanently delete the recorded session for <strong>{confirmDelete.deviceName}</strong> ({confirmDelete.username})? This cannot be undone.</>}
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => (confirmDelete === 'all' ? doDeleteAll() : doDeleteOne(confirmDelete))}>
                {confirmDelete === 'all' ? 'Delete all' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
