import { useState, useRef, useEffect, useId } from 'react';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
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

// Tek bir ping oturumu (bagimsiz kart). Coklu ping'te PingModal bunlardan birden
// fazlasini yan yana (masaustu) / alt alta (mobil) dizer. Ping motoru PingModal'in
// eski tekli mantiginin BIREBIR aynisidir (nesil/abort/StrictMode korumalari dahil).
export default function PingPanel({ initialIp = '', lockIp = false, autoStart = false, onRemove }) {
  const { authFetch } = useAuth();
  const { isPhone, isShort, isTouch } = useViewport();
  const sheet = isPhone || isShort;
  const contId = useId();
  const [ip, setIp] = useState(initialIp);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [continuous, setContinuous] = useState(() => localStorage.getItem('ping-continuous') === '1');
  const [stats, setStats] = useState(EMPTY_STATS);
  const listRef = useRef(null);
  const genRef = useRef(0);   // çalışma nesli — her yeni runPing öncekini iptal eder
  const abortRef = useRef(null);

  const valid = IPV4_RE.test(ip.trim());

  // Cihaz bazlı (kilitli IP): açılır açılmaz otomatik başlat. Unmount'ta iptal.
  useEffect(() => {
    if (autoStart && initialIp && IPV4_RE.test(initialIp.trim())) runPing();
    return () => { genRef.current++; if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Yeni sonuç geldikçe listeyi en alta kaydır.
  useEffect(() => {
    const box = listRef.current;
    if (box && box.scrollHeight > box.clientHeight) box.scrollTop = box.scrollHeight;
  }, [results]);

  const stop = () => {
    genRef.current++;
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } }
    setResults(prev => prev.filter(r => r.status !== 'pending'));
    setRunning(false);
  };

  const runPing = async () => {
    const target = ip.trim();
    if (!IPV4_RE.test(target)) return;
    const cont = continuous;
    const myGen = ++genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setStats(EMPTY_STATS);
    for (let seq = 1; cont || seq <= PING_COUNT; seq++) {
      if (genRef.current !== myGen) return;
      setResults(prev => capResults([...prev, { seq, status: 'pending' }]));
      let r;
      try {
        const res = await authFetch('/ping', { method: 'POST', body: JSON.stringify({ ip: target, count: 1 }), signal: controller.signal });
        const data = res && res.ok ? await res.json() : null;
        r = (data && data.results && data.results[0]) ? data.results[0] : { status: 'error', latency: null };
      } catch {
        r = { status: 'error', latency: null };
      }
      if (genRef.current !== myGen) return;
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
      if (cont || seq < PING_COUNT) await new Promise(res => setTimeout(res, 1000));
    }
    if (genRef.current === myGen) setRunning(false);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      width: sheet ? '100%' : 320, flexShrink: 0,
      border: '1px solid var(--border-color)', borderRadius: 12, padding: 14,
      background: 'rgba(255,255,255,0.02)', boxSizing: 'border-box',
    }}>
      {/* IP + başlat/durdur + (kaldır) */}
      <div style={{ display: 'flex', gap: 8 }}>
        {lockIp ? (
          <div className="modern-input" style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>{ip}</div>
        ) : (
          <input className="modern-input" style={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }} value={ip}
            onChange={e => setIp(e.target.value)} placeholder="10.0.0.1" autoComplete="off"
            inputMode="decimal" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
            onKeyDown={e => { if (e.key === 'Enter') runPing(); }}
            autoFocus={!isTouch} />
        )}
        <PlayStopButton running={running} onStart={runPing} onStop={stop} disabled={!valid} />
        {onRemove && (
          <button onClick={onRemove} className="rw-tap" title="Remove this ping" aria-label="Remove this ping"
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', flexShrink: 0, padding: '0 10px' }}>&times;</button>
        )}
      </div>

      {/* Sürekli ping anahtarı */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label className="toggle-switch" style={{ flexShrink: 0, opacity: running ? 0.5 : 1 }}>
          <input id={contId} type="checkbox" checked={continuous} disabled={running}
            onChange={e => { setContinuous(e.target.checked); localStorage.setItem('ping-continuous', e.target.checked ? '1' : '0'); }} />
          <span className="toggle-slider" />
        </label>
        <label htmlFor={contId} style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('pingContinuous')}</label>
      </div>

      {/* İstatistikler */}
      {stats.sent > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>{t('pingSent')}: <b style={{ color: 'var(--text-main)' }}>{stats.sent}</b></span>
          <span>{t('pingRecv')}: <b style={{ color: 'var(--success)' }}>{stats.ok}</b></span>
          <span>{t('pingLoss')}: <b style={{ color: (stats.sent - stats.ok) > 0 ? 'var(--danger)' : 'var(--text-main)' }}>{Math.round((stats.sent - stats.ok) / stats.sent * 100)}%</b></span>
          {stats.ok > 0 && <span>{t('pingAvg')}: <b style={{ color: 'var(--text-main)' }}>{Math.round(stats.sum / stats.ok)} ms</b> <span style={{ opacity: 0.7 }}>({stats.min}/{stats.max})</span></span>}
        </div>
      )}

      {/* Sonuç listesi */}
      {results.length > 0 && (
        <div ref={listRef} style={{ border: '1px solid var(--border-color)', borderRadius: 8, maxHeight: 280, overflowY: 'auto', overflowX: 'hidden' }}>
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
  );
}
