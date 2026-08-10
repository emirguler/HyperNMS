import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import TraceIcon from './TraceIcon';
import { t } from '../i18n';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

// ip: başlangıç IP'si; lockIp: true ise IP alanı düzenlenemez (cihaz bazlı trace)
export default function TraceModal({ ip: initialIp = '', lockIp = false, onClose }) {
  const { authFetch } = useAuth();
  const [ip, setIp] = useState(initialIp);
  const [running, setRunning] = useState(false);
  const [hops, setHops] = useState(null); // null = henüz çalışmadı, [] = sonuç geldi
  const [error, setError] = useState('');
  const genRef = useRef(0); // çalışma nesli — modal kapanınca / yeni çalışmada öncekini iptal et

  const valid = IPV4_RE.test(ip.trim());

  // Cihaz bazlı (kilitli IP): açılır açılmaz otomatik başlat
  useEffect(() => {
    if (lockIp && initialIp && IPV4_RE.test(initialIp.trim())) runTrace();
    return () => { genRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTrace = async () => {
    const target = ip.trim();
    if (!IPV4_RE.test(target)) return;
    const myGen = ++genRef.current;
    setRunning(true); setHops(null); setError('');
    try {
      const res = await authFetch('/traceroute', { method: 'POST', body: JSON.stringify({ ip: target }) });
      const data = res ? await res.json().catch(() => null) : null;
      if (genRef.current !== myGen) return; // iptal edildi
      if (res && res.ok && data && Array.isArray(data.hops)) {
        setHops(data.hops);
      } else {
        setError((data && data.error) || t('traceFailed'));
        setHops([]);
      }
    } catch {
      if (genRef.current !== myGen) return;
      setError(t('traceFailed'));
      setHops([]);
    } finally {
      if (genRef.current === myGen) setRunning(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => onClose()} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}><TraceIcon size={20} /> {t('traceTool')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
          {lockIp ? (
            <div className="modern-input" style={{ flex: 1, fontFamily: 'monospace', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>{ip}</div>
          ) : (
            <input className="modern-input" style={{ flex: 1, fontFamily: 'monospace' }} value={ip}
              onChange={e => setIp(e.target.value)} placeholder="10.0.0.1" autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter') runTrace(); }} autoFocus />
          )}
          <button className="btn btn-primary" onClick={runTrace} disabled={!valid || running}>
            {running ? t('traceRunning') : t('traceStart')}
          </button>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 16 }}>{t('traceHint')}</div>

        {running && (
          <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>⏳ {t('traceRunning')}</div>
        )}

        {error && !running && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: 'var(--danger)', fontSize: '0.82rem' }}>
            ✕ {error}
          </div>
        )}

        {!running && !error && hops && hops.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('traceNoHops')}</div>
        )}

        {!running && hops && hops.length > 0 && (
          <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
            {hops.map(h => (
              <div key={h.hop} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>{h.hop}</span>
                {h.ip ? (
                  <>
                    <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--text-main)' }}>{h.ip}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{h.rtt != null ? `${h.rtt} ms` : '—'}</span>
                  </>
                ) : (
                  <span style={{ flex: 1, color: 'var(--warning)' }}>* {t('traceTimeout')}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
