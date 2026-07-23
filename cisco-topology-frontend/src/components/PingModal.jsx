import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import PingIcon from './PingIcon';
import { t } from '../i18n';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const PING_COUNT = 5;

const STATUS_META = {
  success:     { color: 'var(--success)', icon: '✓', label: (r) => `${t('pingSuccess')}${r.latency != null ? ` — ${r.latency} ms` : ''}` },
  timeout:     { color: 'var(--warning)', icon: '⏱', label: () => t('pingTimeout') },
  unreachable: { color: 'var(--danger)',  icon: '✗', label: () => t('pingUnreachable') },
  failed:      { color: 'var(--danger)',  icon: '✗', label: () => t('pingFailed') },
  error:       { color: 'var(--danger)',  icon: '✗', label: () => t('pingFailed') },
};

// ip: başlangıç IP'si; lockIp: true ise IP alanı düzenlenemez (cihaz bazlı ping)
export default function PingModal({ ip: initialIp = '', lockIp = false, onClose }) {
  const { authFetch } = useAuth();
  const [ip, setIp] = useState(initialIp);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]); // [{ seq, status, latency }]
  const genRef = useRef(0); // çalışma nesli — her yeni runPing öncekini iptal eder (StrictMode çift-çağrı + modal kapanışı)

  const valid = IPV4_RE.test(ip.trim());

  // Cihaz bazlı (kilitli IP): açılır açılmaz otomatik başlat
  useEffect(() => {
    if (lockIp && initialIp && IPV4_RE.test(initialIp.trim())) runPing();
    return () => { genRef.current++; }; // unmount'ta mevcut çalışmayı iptal et
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runPing = async () => {
    const target = ip.trim();
    if (!IPV4_RE.test(target)) return;
    const myGen = ++genRef.current; // bu çalışmanın nesli; önceki çalışmalar iptal olur
    setRunning(true);
    setResults([]);
    for (let seq = 1; seq <= PING_COUNT; seq++) {
      if (genRef.current !== myGen) return; // iptal edildi / yeni çalışma başladı
      setResults(prev => [...prev, { seq, status: 'pending' }]);
      try {
        const res = await authFetch('/ping', { method: 'POST', body: JSON.stringify({ ip: target, count: 1 }) });
        const data = res && res.ok ? await res.json() : null;
        const r = data && data.results && data.results[0] ? data.results[0] : { status: 'error', latency: null };
        if (genRef.current !== myGen) return;
        setResults(prev => prev.map(x => x.seq === seq ? { seq, ...r } : x));
      } catch {
        if (genRef.current !== myGen) return;
        setResults(prev => prev.map(x => x.seq === seq ? { seq, status: 'error', latency: null } : x));
      }
      // Bir sonraki ping'e kadar 1 sn bekle (son ping hariç)
      if (seq < PING_COUNT) await new Promise(res => setTimeout(res, 1000));
    }
    if (genRef.current === myGen) setRunning(false);
  };

  return (
    <div className="modal-overlay" onClick={() => onClose()} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}><PingIcon size={20} /> {t('pingTool')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {lockIp ? (
            <div className="modern-input" style={{ flex: 1, fontFamily: 'monospace', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>{ip}</div>
          ) : (
            <input className="modern-input" style={{ flex: 1, fontFamily: 'monospace' }} value={ip}
              onChange={e => setIp(e.target.value)} placeholder="10.0.0.1" autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter') runPing(); }} autoFocus />
          )}
          <button className="btn btn-primary" onClick={runPing} disabled={!valid || running}>
            {running ? t('pingRunning') : t('pingStart')}
          </button>
        </div>

        {results.length > 0 && (
          <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
            {results.map(r => {
              const meta = STATUS_META[r.status];
              return (
                <div key={r.seq} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)', width: 44 }}>#{r.seq}</span>
                  {r.status === 'pending' ? (
                    <span style={{ color: 'var(--text-muted)' }}>⏳ {t('pingRunning')}</span>
                  ) : (
                    <span style={{ color: meta.color, fontWeight: 500 }}>{meta.icon} {meta.label(r)}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
