import { useState, useEffect, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

// NPS (Linux FreeRADIUS) yonetim sayfasi — YALNIZCA ADMIN.
// /etc/freeradius/3.0/users kayitlarini listeler, ek/duzenle/sil yaptirir ve
// "service freeradius restart" calistirir. SSH ayarlari Settings → NPS'te.
// "Location" alani UI-only metadatadir (GSM'e gore ayarlarda tutulur, dosyaya yazilmaz).

// Istemci tarafi hafif dogrulama (backend zaten otoriter). Anlik geri bildirim.
const isIPv4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(o => { const n = +o; return n >= 0 && n <= 255 && String(n) === o; });
const validGsm = (g) => /^\d{1,20}$/.test(g);
// Framed-Route UI'da yalnizca AG kismini (network/prefix) gosterir; sabit
// "gateway metric" ( or. "0.0.0.0 1") kismi gizlenir ve arka planda korunur.
const routeNet = (route) => String(route || '').trim().split(/\s+/)[0] || '';
const routeRest = (route) => String(route || '').trim().split(/\s+/).slice(1).join(' ');
const validNet = (net) => { const m = String(net).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/); return !!(m && isIPv4(m[1]) && +m[2] <= 32); };
const DEFAULT_REST = '0.0.0.0 1';

// IP'yi sayiya cevir (dogru sayisal siralama icin: .9 < .10)
const ipNum = (ip) => { const p = String(ip || '').split('.'); return p.length === 4 ? p.reduce((a, o) => a * 256 + (parseInt(o, 10) || 0), 0) : -1; };
const cmpBy = (a, b, key) => {
  if (key === 'ip') return ipNum(a.ip) - ipNum(b.ip);
  if (key === 'gsm') return String(a.gsm || '').localeCompare(String(b.gsm || ''), undefined, { numeric: true });
  if (key === 'location') return String(a.location || '').localeCompare(String(b.location || ''), undefined, { sensitivity: 'base' });
  return 0;
};
// CSV hucre kacisi + formul enjeksiyonu korumasi: tehlikeli on-karakter (= + - @ tab CR)
// varsa basa ' konur, sonra virgul/tirnak/yenisatir iceriyorsa tirnaklanir + ic tirnak ikilenir.
const csvCell = (v) => {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
// GSM'i Excel bilimsel gosterime (9.05E+11) cevirmesin / bastaki sifiri atmasin diye
// ="..." ile METNE zorla. GSM dogrulanmis (yalnizca rakam) oldugundan enjeksiyon riski yok.
const csvGsm = (g) => '="' + String(g == null ? '' : g).replace(/\D/g, '') + '"';

export default function NpsPage() {
  const { isAdmin, authFetch } = useAuth();
  // Erken return'un USTUNDE cagrilmali (hook sirasi bozulmasin)
  const { isPhone, isShort } = useViewport();
  const compact = isPhone || isShort;

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);       // { message, notConfigured }
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' }); // key: null|'ip'|'gsm'|'location'
  const [formEntry, setFormEntry] = useState(null); // { mode:'add'|'edit', entry }
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [usersFile, setUsersFile] = useState('/etc/freeradius/3.0/users');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await authFetch('/nps/users');
      if (res && res.ok) {
        const d = await res.json();
        setEntries(Array.isArray(d.entries) ? d.entries : []);
        if (d.usersFile) setUsersFile(d.usersFile);
      } else {
        const d = res ? await res.json().catch(() => ({})) : {};
        const msg = d.error || 'Could not read NPS users';
        setError({ message: msg, notConfigured: /not configured/i.test(msg) });
      }
    } catch (e) {
      setError({ message: 'Connection error', notConfigured: false });
    } finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      (e.gsm || '').toLowerCase().includes(q) ||
      (e.ip || '').toLowerCase().includes(q) ||
      (e.route || '').toLowerCase().includes(q) ||
      (e.location || '').toLowerCase().includes(q));
  }, [entries, query]);

  const displayed = useMemo(() => {
    if (!sort.key) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => { const r = cmpBy(a, b, sort.key); return sort.dir === 'asc' ? r : -r; });
    return arr;
  }, [filtered, sort]);

  const toggleSort = (key) => setSort(s => {
    if (s.key !== key) return { key, dir: 'asc' };
    if (s.dir === 'asc') return { key, dir: 'desc' };
    return { key: null, dir: 'asc' }; // ucuncu tik: dosya sirasina don
  });
  const sortValue = sort.key ? `${sort.key}-${sort.dir}` : '';
  const onSortSelect = (v) => { if (!v) setSort({ key: null, dir: 'asc' }); else { const [k, d] = v.split('-'); setSort({ key: k, dir: d }); } };

  // Listeyi CSV indir — TUM kolonlar (GSM, Framed-IP, Framed-Route, Location).
  // Gorunen satirlar (arama + siralama uygulanmis); arama bosken tum liste.
  // Framed-Route listedeki gibi yalnizca ag kismini tasir. BOM ile Excel UTF-8'i
  // (Turkce karakterler) dogru acar.
  const downloadList = () => {
    const headerLine = ['GSM number', 'Framed-IP', 'Framed-Route', 'Location'].map(csvCell).join(',');
    const dataLines = displayed.map(e => [csvGsm(e.gsm), csvCell(e.ip), csvCell(routeNet(e.route)), csvCell(e.location || '')].join(','));
    const csv = [headerLine, ...dataLines].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netpulse-nps-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doRestart = async () => {
    setRestarting(true);
    try {
      const res = await authFetch('/nps/restart', { method: 'POST' });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok && d.ok) showToast('FreeRADIUS restarted successfully', 'success');
      else showToast(d.error || (d.output ? `Restart failed: ${d.output}` : 'Restart failed'), 'error', 7000);
    } catch (e) { showToast('Connection error', 'error'); }
    finally { setRestarting(false); setConfirmRestart(false); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await authFetch(`/nps/users/${deleting.id}`, { method: 'DELETE', body: JSON.stringify({ originalGsm: deleting.gsm }) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { showToast('Entry deleted', 'success'); setEntries(d.entries || []); setDeleting(null); }
      else showToast(d.error || 'Delete failed', 'error', 6000);
    } catch (e) { showToast('Connection error', 'error'); }
    finally { setDeleteBusy(false); }
  };

  const configured = !error?.notConfigured;

  // NPS ayarlari tam degilse sayfayi GOSTERME — dashboard'a yonlendir.
  // (Menu de zaten gizli; dogrudan URL ile gelinirse burada bounce edilir.)
  if (!loading && error?.notConfigured) return <Navigate to="/dashboard" replace />;

  // Tiklanabilir baslik (masaustu/tablet); mobilde thead gizli oldugu icin
  // ayrica bir siralama menusu de var.
  const SortTh = ({ k, children, style }) => (
    <th onClick={() => toggleSort(k)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }} title="Sort">
      {children}
      <span style={{ opacity: sort.key === k ? 0.9 : 0.3, marginLeft: 4 }}>{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  );

  return (
    <div className="list-container">
      {/* Baslik + eylemler; <=1024px'te satir kayar (rw-actions) */}
      <div className="rw-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>NPS</h2>
          <div className="rw-truncate" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
            FreeRADIUS · <code style={{ fontSize: '0.75rem' }}>{usersFile}</code>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {configured && !error && <button className="btn btn-primary btn-sm" onClick={() => setFormEntry({ mode: 'add', entry: null })}>+ New entry</button>}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>Refresh</button>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmRestart(true)} disabled={restarting || !configured}>
            {restarting ? 'Restarting…' : 'Service restart'}
          </button>
        </div>
      </div>

      {/* Arama + siralama */}
      {!error && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <input className="modern-input" style={{ width: compact ? '100%' : 320, maxWidth: '100%', flex: compact ? '1 1 100%' : '0 0 auto' }}
            placeholder="Search GSM, IP, route or location…" value={query} onChange={e => setQuery(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <select className="modern-input" style={{ width: compact ? '100%' : 'auto', cursor: 'pointer' }} value={sortValue} onChange={e => onSortSelect(e.target.value)}>
            <option value="">Sort: file order</option>
            <option value="ip-asc">Framed-IP ↑</option>
            <option value="ip-desc">Framed-IP ↓</option>
            <option value="gsm-asc">GSM ↑</option>
            <option value="gsm-desc">GSM ↓</option>
            <option value="location-asc">Location A→Z</option>
            <option value="location-desc">Location Z→A</option>
          </select>
          <button className="btn btn-ghost" onClick={downloadList} disabled={displayed.length === 0}
            style={{ width: compact ? '100%' : 'auto' }} title="Download the list as CSV (all columns)">Download list</button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading NPS users…</div>
      ) : error ? (
        <div className="chart-container no-float" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 10 }}>⚠️</div>
          <div style={{ color: 'var(--text-main)', fontWeight: 600, marginBottom: 6 }}>Could not reach NPS</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 460, margin: '0 auto 14px', lineHeight: 1.5 }}>{error.message}</div>
          <button className="btn btn-ghost btn-sm" onClick={load}>Try again</button>
        </div>
      ) : (
        <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: compact ? '10px 12px' : '12px 24px', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {displayed.length} {displayed.length === 1 ? 'entry' : 'entries'}{query ? ` of ${entries.length}` : ''}
          </div>
          <div className="rw-scroll-x">
            <table className="modern-table rw-cards">
              <thead><tr>
                <SortTh k="gsm" style={{ paddingLeft: isPhone ? undefined : 24 }}>GSM number</SortTh>
                <SortTh k="ip">Framed-IP</SortTh>
                <th>Framed-Route</th>
                <SortTh k="location">Location</SortTh>
                <th style={{ textAlign: 'right', paddingRight: isPhone ? undefined : 24 }}>Actions</th>
              </tr></thead>
              <tbody>
                {displayed.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 28 }}>
                    {query ? 'No entries match your search.' : 'No RADIUS entries yet — use “+ New entry” to add one.'}
                  </td></tr>
                ) : displayed.map(e => (
                  <tr key={e.id}>
                    <td data-label="GSM" style={{ paddingLeft: isPhone ? undefined : 24, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.gsm}</td>
                    <td data-label="Framed-IP" style={{ whiteSpace: 'nowrap' }}>{e.ip || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                    <td data-label="Framed-Route" style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{routeNet(e.route) || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                    <td data-label="Location">{e.location ? e.location : <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                    <td data-label="" style={{ textAlign: 'right', paddingRight: isPhone ? undefined : 24, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" style={{ marginRight: 6 }} onClick={() => setFormEntry({ mode: 'edit', entry: e })}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleting(e)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formEntry && (
        <EntryFormModal
          mode={formEntry.mode}
          entry={formEntry.entry}
          compact={compact}
          onClose={() => setFormEntry(null)}
          onSaved={(updated) => { setEntries(updated); setFormEntry(null); }}
          onLocationSaved={(id, loc) => { setEntries(es => es.map(e => e.id === id ? { ...e, location: loc } : e)); setFormEntry(null); }}
          authFetch={authFetch}
        />
      )}

      {deleting && (
        <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') setDeleting(null); }}>
          <div className="confirm-modal-content">
            <h3 className="confirm-title">Delete entry?</h3>
            <p className="confirm-desc">
              Remove the RADIUS entry for GSM <strong>{deleting.gsm}</strong>{deleting.ip ? <> (<code>{deleting.ip}</code>)</> : null}? This rewrites the users file and cannot be undone.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</button>
              <button className="btn btn-danger" onClick={doDelete} disabled={deleteBusy} autoFocus>{deleteBusy ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmRestart && (
        <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') setConfirmRestart(false); }}>
          <div className="confirm-modal-content">
            <h3 className="confirm-title">Restart FreeRADIUS?</h3>
            <p className="confirm-desc">
              This runs <code>service freeradius restart</code> on the NPS server. RADIUS authentication will be briefly interrupted while the service restarts.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmRestart(false)} disabled={restarting}>Cancel</button>
              <button className="btn btn-danger" onClick={doRestart} disabled={restarting} autoFocus>
                {restarting ? 'Restarting…' : 'Restart'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Ekle / Duzenle popup'i ---
function EntryFormModal({ mode, entry, compact, onClose, onSaved, onLocationSaved, authFetch }) {
  const isEdit = mode === 'edit';
  const [gsm, setGsm] = useState(entry?.gsm || '');
  const [ip, setIp] = useState(entry?.ip || '');
  // UI yalnizca ag kismini gosterir; gateway+metric ("rest") gizli tutulup korunur.
  const [net, setNet] = useState(routeNet(entry?.route) || '');
  const [location, setLocation] = useState(entry?.location || '');
  const rest = (isEdit && routeRest(entry?.route)) || DEFAULT_REST;
  const [saving, setSaving] = useState(false);

  const gsmOk = validGsm(gsm.trim());
  const ipOk = isIPv4(ip.trim());
  const netOk = validNet(net);
  const allOk = gsmOk && ipOk && netOk; // location opsiyonel

  const save = async () => {
    if (!allOk) return;
    setSaving(true);
    try {
      const route = `${net.trim()} ${rest}`;
      const loc = location.trim();
      if (!isEdit) {
        // EKLE: SSH kaydi olustur + lokasyonu birlikte sakla
        const res = await authFetch('/nps/users', { method: 'POST', body: JSON.stringify({ gsm: gsm.trim(), ip: ip.trim(), route, location: loc }) });
        const d = res ? await res.json().catch(() => ({})) : {};
        if (res && res.ok) { showToast('Entry added', 'success'); onSaved(d.entries || []); }
        else showToast(d.error || 'Save failed', 'error', 6000);
      } else {
        const sshChanged = gsm.trim() !== entry.gsm || ip.trim() !== entry.ip || route !== entry.route;
        if (sshChanged) {
          // SSH duzenleme (lokasyonu da sunucu tarafinda saklar/tasir)
          const res = await authFetch(`/nps/users/${entry.id}`, { method: 'PUT', body: JSON.stringify({ gsm: gsm.trim(), ip: ip.trim(), route, originalGsm: entry.gsm, location: loc }) });
          const d = res ? await res.json().catch(() => ({})) : {};
          if (res && res.ok) { showToast('Entry updated', 'success'); onSaved(d.entries || []); }
          else showToast(d.error || 'Save failed', 'error', 6000);
        } else {
          // Yalnizca lokasyon degisti → SSH YOK (NPS erisilemez olsa bile calisir)
          const res = await authFetch('/nps/locations', { method: 'PUT', body: JSON.stringify({ gsm: gsm.trim(), location: loc, previousGsm: entry.gsm }) });
          const d = res ? await res.json().catch(() => ({})) : {};
          if (res && res.ok) { showToast('Location saved', 'success'); onLocationSaved(entry.id, loc); }
          else showToast(d.error || 'Save failed', 'error', 6000);
        }
      }
    } catch (e) { showToast('Connection error', 'error'); } finally { setSaving(false); }
  };

  const lbl = { display: 'block', fontSize: compact ? '13px' : '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: compact ? 'none' : 'uppercase', letterSpacing: compact ? 0 : 0.4 };
  const hint = (bad, text) => bad ? <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: 4 }}>{text}</div> : null;
  const errStyle = (bad) => (bad ? { borderColor: 'var(--danger)' } : null); // gecersizken kirmizi cerceve

  return (
    <div className="modal-overlay" style={{ zIndex: 2200 }} onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" style={{ width: 'min(460px, 94vw)', maxHeight: '88dvh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{isEdit ? 'Edit RADIUS entry' : 'New RADIUS entry'}</h2>
          <button onClick={onClose} className="rw-tap" aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>GSM number (Calling-Station-ID)</label>
          {/* Yalnizca rakam kabul et: harf/sembol/bosluk yazilamaz (yapistirinca da temizlenir). */}
          <input className="modern-input" style={{ width: '100%', ...errStyle(gsm && !gsmOk) }} value={gsm} onChange={e => setGsm(e.target.value.replace(/\D/g, '').slice(0, 20))} autoFocus={!isEdit}
            inputMode="numeric" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="905346214614" />
          {hint(gsm && !gsmOk, 'GSM must be 1–20 digits.')}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Framed-IP-Address</label>
          {/* Yalnizca rakam ve nokta kabul et. Bicim/oktet gecerliligi ayrica dogrulanir. */}
          <input className="modern-input" style={{ width: '100%', ...errStyle(ip && !ipOk) }} value={ip} onChange={e => setIp(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="192.168.54.200" />
          {hint(ip && !ipOk, 'Must be a valid IPv4 address (0–255 per octet).')}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Framed-Route (network)</label>
          {/* Yalnizca rakam, nokta ve tek bolu kabul et (network/prefix). */}
          <input className="modern-input" style={{ width: '100%', fontFamily: 'var(--mono, monospace)', ...errStyle(net && !netOk) }} value={net} onChange={e => setNet(e.target.value.replace(/[^\d./]/g, ''))}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="10.37.98.0/24" />
          {hint(net && !netOk, 'Format: network/prefix — e.g. 10.37.98.0/24 (prefix 0–32)')}
        </div>
        <div style={{ marginBottom: 4 }}>
          <label style={lbl}>Location <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontWeight: 400 }}>· label only, not sent to NPS</span></label>
          <input className="modern-input" style={{ width: '100%' }} value={location} onChange={e => setLocation(e.target.value)} maxLength={200}
            autoComplete="off" spellCheck={false} placeholder="e.g. Pump station 3 — İSU" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !allOk}>{saving ? 'Saving…' : (isEdit ? 'Save' : 'Add entry')}</button>
        </div>
      </div>
    </div>
  );
}
