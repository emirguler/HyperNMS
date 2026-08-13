import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import PingIcon from './PingIcon';
import PlayStopButton from './PlayStopButton';
import { t } from '../i18n';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const PING_COUNT = 5;
const MAX_DISPLAY = 100; // sürekli modda listede son 100 sonucu tut (bellek/DOM şişmesin)
const capResults = (arr) => (arr.length > MAX_DISPLAY ? arr.slice(arr.length - MAX_DISPLAY) : arr);
const EMPTY_STATS = { sent: 0, ok: 0, sum: 0, min: null, max: null };

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
  const [results, setResults] = useState([]); // [{ seq, status, latency }] — sürekli modda son MAX_DISPLAY tutulur
  const [continuous, setContinuous] = useState(() => localStorage.getItem('ping-continuous') === '1'); // sürekli ping (ping -t gibi)
  const [stats, setStats] = useState(EMPTY_STATS); // kümülatif: tüm çalışmayı kapsar (listeden bağımsız)
  const listRef = useRef(null); // otomatik en-alta kaydırma için
  const genRef = useRef(0); // çalışma nesli — her yeni runPing öncekini iptal eder (StrictMode çift-çağrı + modal kapanışı)
  const abortRef = useRef(null); // devam eden /ping isteğini iptal etmek için

  const valid = IPV4_RE.test(ip.trim());

  // Cihaz bazlı (kilitli IP): açılır açılmaz otomatik başlat
  useEffect(() => {
    if (lockIp && initialIp && IPV4_RE.test(initialIp.trim())) runPing();
    return () => { genRef.current++; if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } } }; // unmount'ta iptal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Yeni sonuç geldikçe listeyi en alta kaydır (sürekli modda akışı takip et)
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [results]);

  // Play/Stop tek buton: çalışırken durdur → nesli artır (döngü durur) + isteği iptal et + takılı ⏳ satırını temizle
  const stop = () => {
    genRef.current++;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } }
    setResults(prev => prev.filter(r => r.status !== 'pending'));
    setRunning(false);
  };

  const runPing = async () => {
    const target = ip.trim();
    if (!IPV4_RE.test(target)) return;
    const cont = continuous; // bu çalışmanın modu (çalışırken toggle kilitli)
    const myGen = ++genRef.current; // bu çalışmanın nesli; önceki çalışmalar iptal olur
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setStats(EMPTY_STATS);
    for (let seq = 1; cont || seq <= PING_COUNT; seq++) {
      if (genRef.current !== myGen) return; // iptal edildi / yeni çalışma başladı
      setResults(prev => capResults([...prev, { seq, status: 'pending' }]));
      let r;
      try {
        const res = await authFetch('/ping', { method: 'POST', body: JSON.stringify({ ip: target, count: 1 }), signal: controller.signal });
        const data = res && res.ok ? await res.json() : null;
        r = (data && data.results && data.results[0]) ? data.results[0] : { status: 'error', latency: null };
      } catch {
        r = { status: 'error', latency: null };
      }
      if (genRef.current !== myGen) return; // durduruldu → sessiz çık (sonuç/istatistik yazma)
      setResults(prev => capResults(prev.map(x => x.seq === seq ? { seq, ...r } : x)));
      setStats(s => {
        const sent = s.sent + 1;
        if (r.status === 'success' && r.latency != null) {
          return { sent, ok: s.ok + 1, sum: s.sum + r.latency,
            min: s.min == null ? r.latency : Math.min(s.min, r.latency),
            max: s.max == null ? r.latency : Math.max(s.max, r.latency) };
        }
        return { ...s, sent };
      });
      // Bir sonraki ping'e kadar 1 sn bekle (sürekli modda hep; sabit modda son hariç)
      if (cont || seq < PING_COUNT) await new Promise(res => setTimeout(res, 1000));
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
          <PlayStopButton running={running} onStart={runPing} onStop={stop} disabled={!valid} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, marginTop: -4 }}>
          <label className="toggle-switch" style={{ flexShrink: 0, opacity: running ? 0.5 : 1 }}>
            <input type="checkbox" checked={continuous} disabled={running}
              onChange={e => { setContinuous(e.target.checked); localStorage.setItem('ping-continuous', e.target.checked ? '1' : '0'); }} />
            <span className="toggle-slider" />
          </label>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('pingContinuous')}</span>
        </div>

        {stats.sent > 0 && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            <span>{t('pingSent')}: <b style={{ color: 'var(--text-main)' }}>{stats.sent}</b></span>
            <span>{t('pingRecv')}: <b style={{ color: 'var(--success)' }}>{stats.ok}</b></span>
            <span>{t('pingLoss')}: <b style={{ color: (stats.sent - stats.ok) > 0 ? 'var(--danger)' : 'var(--text-main)' }}>{Math.round((stats.sent - stats.ok) / stats.sent * 100)}%</b></span>
            {stats.ok > 0 && <span>{t('pingAvg')}: <b style={{ color: 'var(--text-main)' }}>{Math.round(stats.sum / stats.ok)} ms</b> <span style={{ opacity: 0.7 }}>({stats.min}/{stats.max})</span></span>}
          </div>
        )}

        {results.length > 0 && (
          <div ref={listRef} style={{ border: '1px solid var(--border-color)', borderRadius: 8, maxHeight: 300, overflowY: 'auto', overflowX: 'hidden' }}>
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
