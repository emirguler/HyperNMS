import { useState, useEffect, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

// NPS (Linux FreeRADIUS) yonetim sayfasi — YALNIZCA ADMIN.
// /etc/freeradius/3.0/users kayitlarini listeler, ek/duzenle/sil yaptirir ve
// "service freeradius restart" calistirir. SSH ayarlari Settings → NPS'te.

// Istemci tarafi hafif dogrulama (backend zaten otoriter). Anlik geri bildirim.
const isIPv4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(o => { const n = +o; return n >= 0 && n <= 255 && String(n) === o; });
const validGsm = (g) => /^\d{1,20}$/.test(g);
// Framed-Route UI'da yalnizca AG kismini (network/prefix) gosterir; sabit
// "gateway metric" ( or. "0.0.0.0 1") kismi gizlenir ve arka planda korunur.
const routeNet = (route) => String(route || '').trim().split(/\s+/)[0] || '';
const routeRest = (route) => String(route || '').trim().split(/\s+/).slice(1).join(' ');
const validNet = (net) => { const m = String(net).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/); return !!(m && isIPv4(m[1]) && +m[2] <= 32); };
// Yeni kayitlar ve rest'i eksik/bozuk kayitlar icin varsayilan gateway+metric.
const DEFAULT_REST = '0.0.0.0 1';

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
  const [formEntry, setFormEntry] = useState(null); // { mode:'add'|'edit', entry }
  const [deleting, setDeleting] = useState(null);   // silinecek kayit
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
      (e.route || '').toLowerCase().includes(q));
  }, [entries, query]);

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

      {/* Arama */}
      {!error && (
        <div style={{ marginBottom: 16 }}>
          <input className="modern-input" style={{ width: compact ? '100%' : 320, maxWidth: '100%' }}
            placeholder="Search GSM, IP or route…" value={query} onChange={e => setQuery(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading NPS users…</div>
      ) : error ? (
        <div className="chart-container no-float" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 10 }}>{error.notConfigured ? '⚙️' : '⚠️'}</div>
          <div style={{ color: 'var(--text-main)', fontWeight: 600, marginBottom: 6 }}>
            {error.notConfigured ? 'NPS is not configured yet' : 'Could not reach NPS'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 460, margin: '0 auto 14px', lineHeight: 1.5 }}>
            {error.notConfigured
              ? 'Open Settings → NPS and enter the SSH host, username and password of your FreeRADIUS server.'
              : error.message}
          </div>
          {!error.notConfigured && <button className="btn btn-ghost btn-sm" onClick={load}>Try again</button>}
        </div>
      ) : (
        <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: compact ? '10px 12px' : '12px 24px', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}{query ? ` of ${entries.length}` : ''}
          </div>
          <div className="rw-scroll-x">
            <table className="modern-table rw-cards">
              <thead><tr>
                <th style={{ paddingLeft: isPhone ? undefined : 24 }}>GSM number</th>
                <th>Framed-IP</th>
                <th>Framed-Route</th>
                <th style={{ textAlign: 'right', paddingRight: isPhone ? undefined : 24 }}>Actions</th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 28 }}>
                    {query ? 'No entries match your search.' : 'No RADIUS entries yet — use “+ New entry” to add one.'}
                  </td></tr>
                ) : filtered.map(e => (
                  <tr key={e.id}>
                    <td data-label="GSM" style={{ paddingLeft: isPhone ? undefined : 24, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.gsm}</td>
                    <td data-label="Framed-IP" style={{ whiteSpace: 'nowrap' }}>{e.ip || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                    <td data-label="Framed-Route" style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{routeNet(e.route) || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
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

// --- Ekle / Duzenle popup'i (ayni alanlar) ---
function EntryFormModal({ mode, entry, compact, onClose, onSaved, authFetch }) {
  const isEdit = mode === 'edit';
  const [gsm, setGsm] = useState(entry?.gsm || '');
  const [ip, setIp] = useState(entry?.ip || '');
  // UI yalnizca ag kismini gosterir; gateway+metric ("rest") gizli tutulup korunur.
  const [net, setNet] = useState(routeNet(entry?.route) || '');
  const rest = (isEdit && routeRest(entry?.route)) || DEFAULT_REST;
  const [saving, setSaving] = useState(false);

  const gsmOk = validGsm(gsm.trim());
  const ipOk = isIPv4(ip.trim());
  const netOk = validNet(net);
  const allOk = gsmOk && ipOk && netOk;

  const save = async () => {
    if (!allOk) return;
    setSaving(true);
    try {
      const route = `${net.trim()} ${rest}`; // ag + gizli gateway/metric
      const payload = { gsm: gsm.trim(), ip: ip.trim(), route };
      const res = isEdit
        ? await authFetch(`/nps/users/${entry.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, originalGsm: entry.gsm }) })
        : await authFetch('/nps/users', { method: 'POST', body: JSON.stringify(payload) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { showToast(isEdit ? 'Entry updated' : 'Entry added', 'success'); onSaved(d.entries || []); }
      else showToast(d.error || 'Save failed', 'error', 6000);
    } catch (e) { showToast('Connection error', 'error'); } finally { setSaving(false); }
  };

  const lbl = { display: 'block', fontSize: compact ? '13px' : '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: compact ? 'none' : 'uppercase', letterSpacing: compact ? 0 : 0.4 };
  const hint = (bad, text) => bad ? <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: 4 }}>{text}</div> : null;

  return (
    <div className="modal-overlay" style={{ zIndex: 2200 }} onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" style={{ width: 'min(460px, 94vw)', maxHeight: '88dvh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{isEdit ? 'Edit RADIUS entry' : 'New RADIUS entry'}</h2>
          <button onClick={onClose} className="rw-tap" aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>GSM number (Calling-Station-ID)</label>
          <input className="modern-input" style={{ width: '100%' }} value={gsm} onChange={e => setGsm(e.target.value)} autoFocus={!isEdit}
            inputMode="numeric" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="905346214614" />
          {hint(gsm && !gsmOk, 'Digits only (1–20).')}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Framed-IP-Address</label>
          <input className="modern-input" style={{ width: '100%' }} value={ip} onChange={e => setIp(e.target.value)}
            inputMode="decimal" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="192.168.54.200" />
          {hint(ip && !ipOk, 'Must be a valid IPv4 address.')}
        </div>
        <div style={{ marginBottom: 4 }}>
          <label style={lbl}>Framed-Route (network)</label>
          <input className="modern-input" style={{ width: '100%', fontFamily: 'var(--mono, monospace)' }} value={net} onChange={e => setNet(e.target.value)}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="10.37.98.0/24" />
          {hint(net && !netOk, 'Format: network/prefix — e.g. 10.37.98.0/24')}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !allOk}>{saving ? 'Saving…' : (isEdit ? 'Save' : 'Add entry')}</button>
        </div>
      </div>
    </div>
  );
}
