import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';

/* ============================================================================
   AUDIT LOG (yalnizca Administrator)

   Eski surumde action listesi ELDE yazilmisti ve 24 action'in yalnizca 10'unu
   iceriyordu - SESSION_*, DEVICE_RELOAD, IFACE_CONFIG, SSH_EXEC gibi cogu sey
   filtrelenemiyordu. Artik liste kayitlardan TURETILIYOR, yani yeni bir action
   eklendiginde burasi kendiliginden guncel kalir.
   ========================================================================== */

/**
 * Gecmis kayitlar IPv6 kilifiyla yazilmis olabilir ("::ffff:10.0.0.5", "::1").
 * Backend artik yazarken indirgiyor; burasi ESKI kayitlari da temizler, boylece
 * gecmise donuk bir goc gerekmez.
 */
function cleanIp(ip) {
  if (!ip) return null;
  const s = String(ip).trim();
  if (s === '::1' || s === '::ffff:127.0.0.1') return '127.0.0.1';
  if (s.startsWith('::ffff:')) {
    const v4 = s.slice(7);
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(v4) ? v4 : null;
  }
  if (s.includes(':')) return null;   // gercek IPv6 -> gizli
  return s;
}

// Kategori: action adindan turetilir, elde liste tutulmaz
function categoryOf(a = '') {
  if (a.startsWith('SESSION')) return 'Sessions';
  if (a.startsWith('USER') || a.includes('PASSWORD')) return 'Users';
  if (a.startsWith('LOGIN') || a.startsWith('LOGOUT')) return 'Auth';
  if (a.startsWith('DEVICE') || a.startsWith('EDGE') || a.startsWith('BULK') || a.startsWith('IFACE') || a.startsWith('SSH')) return 'Devices';
  return 'System';
}

// Renk de addan turetilir: yikici kirmizi, olusturucu yesil, degistirici sari
function toneOf(a = '') {
  if (/DELETE|FAILED|KILL|RELOAD|RESTORE/.test(a)) return { bg: 'rgba(239,68,68,0.13)', fg: 'var(--danger)', bd: 'rgba(239,68,68,0.3)' };
  if (/CREATE|START|IMPORT|DISCOVER/.test(a)) return { bg: 'rgba(34,197,94,0.13)', fg: 'var(--success)', bd: 'rgba(34,197,94,0.3)' };
  if (/UPDATE|CONFIG|CHANGE|EXEC/.test(a)) return { bg: 'rgba(245,158,11,0.13)', fg: 'var(--warning)', bd: 'rgba(245,158,11,0.3)' };
  if (a === 'LOGIN') return { bg: 'rgba(59,130,246,0.13)', fg: '#60a5fa', bd: 'rgba(59,130,246,0.3)' };
  return { bg: 'rgba(255,255,255,0.05)', fg: 'var(--text-muted)', bd: 'var(--border-color)' };
}

const rel = (ts) => {
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return s <= 1 ? 'now' : s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
};

const absTime = (ts) => new Date(ts).toLocaleString();

/**
 * details nesnesinden okunabilir tek satir. Bu alan daha once hic
 * gosterilmiyordu; oysa "neden basarisiz oldu", "oturum ne kadar surdu",
 * "hangi komut calisti" bilgisi burada duruyor.
 */
function detailText(log) {
  const d = log.details || {};
  const bits = [];
  if (d.reason) bits.push(d.reason);
  if (d.authType) bits.push(d.authType.toUpperCase());
  if (d.durationMs !== undefined && d.durationMs !== null) {
    const s = Math.round(d.durationMs / 1000);
    bits.push(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
  }
  if (d.bytes) bits.push(d.bytes < 1024 ? `${d.bytes} B` : `${(d.bytes / 1024).toFixed(1)} KB`);
  if (d.targetUser) bits.push('user: ' + d.targetUser);
  if (d.deviceIp) bits.push(d.deviceIp);
  if (d.count !== undefined) bits.push(d.count + ' items');
  if (d.command) bits.push(String(d.command).slice(0, 60));
  return bits.join(' · ');
}

export default function AuditPage() {
  const { authFetch, isAdmin } = useAuth();
  // Erken return'un USTUNDE cagrilmali, yoksa hook sirasi bozulur
  const { isPhone, isTablet, isShort, isTouch } = useViewport();
  const compact = isPhone || isShort;

  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('');        // kategori cipi
  const [action, setAction] = useState('');  // tam action
  const [who, setWho] = useState('');        // kullanici
  const [q, setQ] = useState('');            // serbest metin
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    // Filtreleme tamamen istemcide: anlik geri bildirim veriyor ve her tusta
    // sunucuya gitmiyor. 500 kayit tek seferde rahatca geliyor.
    const fetchLogs = async () => {
      const res = await authFetch('/audit?limit=500');
      if (res && res.ok) setLogs(await res.json());
      setLoading(false);
    };
    fetchLogs();
    const i = setInterval(fetchLogs, 10000);
    return () => clearInterval(i);
  }, [authFetch]);

  // Kategori ve action listeleri KAYITLARDAN turetilir
  const cats = useMemo(() => {
    const order = ['Auth', 'Devices', 'Sessions', 'Users', 'System'];
    const present = new Set(logs.map(l => categoryOf(l.action)));
    return order.filter(c => present.has(c));
  }, [logs]);

  const actions = useMemo(() => {
    const set = new Set(logs.filter(l => !cat || categoryOf(l.action) === cat).map(l => l.action));
    return [...set].sort();
  }, [logs, cat]);

  const users = useMemo(() => [...new Set(logs.map(l => l.username).filter(Boolean))].sort(), [logs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.filter(l => {
      if (cat && categoryOf(l.action) !== cat) return false;
      if (action && l.action !== action) return false;
      if (who && l.username !== who) return false;
      if (needle) {
        const hay = `${l.username} ${l.action} ${l.target} ${detailText(l)} ${cleanIp(l.ip) || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [logs, cat, action, who, q]);

  const anyFilter = cat || action || who || q;
  const clear = () => { setCat(''); setAction(''); setWho(''); setQ(''); };

  const chipBtn = (active) => ({
    fontSize: compact ? '0.85rem' : '0.8rem',
    padding: isTouch ? '10px 14px' : '6px 12px',
    border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
    flexShrink: isTablet ? 0 : undefined,
    scrollSnapAlign: isTablet ? 'start' : undefined,
    whiteSpace: isTablet ? 'nowrap' : undefined,
  });

  return (
    <div className="list-container">
      <div className="rw-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>
          Audit Log <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.9rem' }}>({filtered.length})</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {anyFilter && <button className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>}
          {compact && (
            <button className="btn btn-ghost btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}>
              {showFilters ? '✕ Filters' : '⚙ Filters'}{anyFilter ? ' •' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Kategori seridi: tablet ve altinda yatay kayan, tutunan serit */}
      <div className="rw-scroll-x" style={{ display: 'flex', gap: 6, marginBottom: 10, scrollSnapType: isTablet ? 'x proximity' : undefined }}>
        <button className={`nav-btn ${cat === '' ? 'active' : ''}`} style={chipBtn(cat === '')}
          onClick={() => { setCat(''); setAction(''); }}>All</button>
        {cats.map(c => (
          <button key={c} className={`nav-btn ${cat === c ? 'active' : ''}`} style={chipBtn(cat === c)}
            onClick={() => { setCat(c === cat ? '' : c); setAction(''); }}>{c}</button>
        ))}
      </div>

      {(!compact || showFilters) && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 14, gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <input className="modern-input" type={isTouch ? 'search' : 'text'} enterKeyHint="search"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={q} onChange={e => setQ(e.target.value)} placeholder="Search user, target, detail…" />
          <select className="modern-input" value={action} onChange={e => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
          <select className="modern-input" value={who} onChange={e => setWho(e.target.value)}>
            <option value="">All users</option>
            {users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      )}

      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Dar govdede ic dikey kaydirici yok: sayfanin kendi kaydirmasi yeter */}
        <div className="rw-scroll-x" style={{ maxHeight: compact ? 'none' : 'calc(100vh - 260px)', overflowY: compact ? 'visible' : 'auto' }}>
          <table className="modern-table rw-cards">
            <thead>
              <tr>
                <th style={{ paddingLeft: isPhone ? undefined : 24 }}>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th className="rw-hide-md">Detail</th>
                <th className="rw-hide-md">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {anyFilter ? 'No entries match these filters' : 'No audit logs yet.'}
                </td></tr>
              ) : filtered.map(log => {
                const tone = toneOf(log.action);
                const det = detailText(log);
                const ip = cleanIp(log.ip);
                return (
                  <tr key={log.id}>
                    {/* Goreli zaman okunur, mutlak zaman kesin. title= dokunmatikte
                        hic tetiklenmedigi icin ikisi de yaziliyor. */}
                    <td data-label="When" style={{ paddingLeft: isPhone ? undefined : 24, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem' }}>{rel(log.timestamp)}</span>
                      <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{absTime(log.timestamp)}</span>
                    </td>
                    <td data-label="User" style={{ fontWeight: 600 }}>{log.username}</td>
                    <td data-label="Action">
                      <span style={{
                        background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}`,
                        padding: '3px 9px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
                      }}>{log.action.replace(/_/g, ' ')}</span>
                    </td>
                    <td data-label="Target" style={{ minWidth: 0 }}>
                      <span className="rw-truncate" style={{ display: 'inline-block', maxWidth: '100%' }}>{log.target || '-'}</span>
                      {/* Detay masaustunde kendi kolonunda; dar govdede Detail kolonu
                          gizlendigi icin hedefin altina dusuyor ki bilgi kaybolmasin. */}
                      {det && (
                        <span className="rw-only-sm" style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{det}</span>
                      )}
                    </td>
                    <td data-label="Detail" className="rw-hide-md" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{det || '-'}</td>
                    <td data-label="IP" className="rw-hide-md" style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{ip || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
