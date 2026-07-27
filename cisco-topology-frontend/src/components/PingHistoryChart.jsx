import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';

// Birleşik nokta şekli (backend): { t, avg, min, max, up, down }
//  - 1H       -> ham 5sn örnekler (avg=min=max=latency, down=0/1)
//  - 1D/1W/1M -> 5dk özet (rollup) kovaları (avg/min/max + up/down sayıları)
const RANGES = ['1H', '1D', '1W', '1M'];
const RANGE_MS = { '1H': 3600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000 };

// Renkler (App.css token'larıyla uyumlu; canvas CSS değişkeni kullanamadığından sabit)
const C_LINE = 'rgba(56,189,248,0.95)';
const C_AREA_TOP = 'rgba(56,189,248,0.22)';
const C_AREA_BOT = 'rgba(56,189,248,0)';
const C_BAND = 'rgba(56,189,248,0.13)';
const C_UP = 'rgba(34,197,94,0.75)';
const C_DOWN = 'rgba(239,68,68,0.9)';
const C_EMPTY = 'rgba(148,163,184,0.12)';
const C_GRID = 'rgba(255,255,255,0.06)';
const C_AXIS = 'rgba(148,163,184,0.8)';

const pad2 = (n) => String(n).padStart(2, '0');

function niceCeil(x) {
  if (!(x > 0)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

function percentile(sortedAsc, q) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(sortedAsc.length * q)));
  return sortedAsc[idx];
}

function fmtMs(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return Math.round(v) + ' ms';
}

// X ekseni etiketi — aralığa göre tarih içerir (çok günlük görünümlerde belirsizliği önler)
function fmtAxis(ts, range) {
  const d = new Date(ts);
  if (range === '1H' || range === '1D') return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (range === '1W') return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' ' + pad2(d.getHours()) + ':00';
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1); // 1M
}

function fmtTip(ts, range) {
  const d = new Date(ts);
  const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (range === '1H' || range === '1D') return time;
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' ' + time;
}

// Noktaları [tMin,tMax] aralığında N eşit görüntü kovasına indir (çizim + şerit + hover).
// Empty kova = o zaman diliminde hiç örnek yok (line'da boşluk, şeritte gri).
function bucketize(points, tMin, tMax, N) {
  const span = Math.max(1, tMax - tMin);
  const width = span / N;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = { t: tMin + i * width, width, sum: 0, up: 0, down: 0, min: null, max: null };
  }
  for (const p of points) {
    const idx = Math.floor((p.t - tMin) / width);
    if (idx < 0 || idx >= N) continue;
    const b = out[idx];
    const up = p.up || 0, down = p.down || 0;
    b.up += up; b.down += down;
    if (p.avg != null && up) b.sum += p.avg * up;
    if (p.min != null && (b.min === null || p.min < b.min)) b.min = p.min;
    if (p.max != null && (b.max === null || p.max > b.max)) b.max = p.max;
  }
  for (const b of out) {
    b.avg = b.up ? b.sum / b.up : null;
    b.empty = b.up === 0 && b.down === 0;
  }
  return out;
}

// Bitişik "veri var" (avg != null) kova koşuları -> [start, end) çiftleri
function segments(buckets) {
  const segs = [];
  const N = buckets.length;
  let i = 0;
  while (i < N) {
    if (buckets[i].avg == null) { i++; continue; }
    let j = i;
    while (j < N && buckets[j].avg != null) j++;
    segs.push([i, j]);
    i = j;
  }
  return segs;
}

function computeStats(points) {
  let up = 0, down = 0, sum = 0, mn = null, mx = null;
  for (const p of points) {
    up += p.up || 0; down += p.down || 0;
    if (p.avg != null && p.up) sum += p.avg * p.up;
    if (p.min != null && (mn === null || p.min < mn)) mn = p.min;
    if (p.max != null && (mx === null || p.max > mx)) mx = p.max;
  }
  const total = up + down;
  let current = null, currentDown = false;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.avg != null) { current = p.avg; break; }
    if (p.down) { currentDown = true; break; }
  }
  return {
    uptime: total ? (up / total) * 100 : null,
    avg: up ? sum / up : null,
    min: mn, max: mx,
    current, currentDown,
    hasData: total > 0,
  };
}

export default function PingHistoryChart({ deviceId }) {
  const [payload, setPayload] = useState(null); // { mode, bucketMs, rangeMs, points }
  const [range, setRange] = useState('1H');
  const [hover, setHover] = useState(null); // görüntü kovası indeksi
  const [sizeTick, setSizeTick] = useState(0);
  const baseRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const geomRef = useRef(null);
  const reqIdRef = useRef(0);
  const { authFetch } = useAuth();

  const fetchHistory = useCallback(async () => {
    const myId = ++reqIdRef.current;
    const reqRange = range;
    try {
      const res = await authFetch(`/switches/${deviceId}/ping-history?range=${reqRange}`);
      if (res && res.ok) {
        const data = await res.json();
        // Yalnızca en son istek uygulanır (yarış/yanlış-etiket önlenir); payload'a ait aralık etiketlenir
        if (myId === reqIdRef.current) setPayload({ ...data, _range: reqRange });
      }
    } catch (e) { /* ignore */ }
  }, [deviceId, authFetch, range]);

  useEffect(() => {
    fetchHistory();
    const i = setInterval(fetchHistory, 10000);
    return () => clearInterval(i);
  }, [fetchHistory]);

  // Konteyner yeniden boyutlanınca yeniden çiz
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSizeTick((x) => x + 1));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const points = payload?.points || [];
  const rangeMs = payload?.rangeMs || RANGE_MS[range];
  const stats = useMemo(() => computeStats(points), [points]);

  // Taban çizimi (veri/boyut değişince)
  useEffect(() => {
    const canvas = baseRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const W = Math.max(1, rect.width), H = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    for (const c of [baseRef.current, overlayRef.current]) {
      if (!c) continue;
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const PAD_L = 46, PAD_R = 12, PAD_T = 8;
    const STRIP_H = 12, XLBL_H = 16, GAP = 6;
    const chartBottom = H - STRIP_H - XLBL_H - GAP;
    const chartH = Math.max(1, chartBottom - PAD_T);
    const chartW = Math.max(1, W - PAD_L - PAD_R);

    const tMax = Date.now();
    const tMin = tMax - rangeMs;
    const axisRange = payload?._range || range; // etiket formatı çizilen payload'ın aralığına göre

    const N = Math.max(30, Math.min(320, Math.floor(chartW / 3)));
    const buckets = bucketize(points, tMin, tMax, N);

    // Y üst sınırı: P95 ile tek gecikme sıçramasının tabanı ezmesini önle (tepe KPI'da görünür)
    const maxes = [];
    for (const b of buckets) if (b.max != null) maxes.push(b.max);
    maxes.sort((a, b) => a - b);
    const yMax = maxes.length ? niceCeil(Math.max(percentile(maxes, 0.95), 5)) : 10;

    const toX = (ts) => PAD_L + ((ts - tMin) / (tMax - tMin)) * chartW;
    const toY = (ms) => PAD_T + chartH - (Math.min(ms, yMax) / yMax) * chartH;

    geomRef.current = { W, H, dpr, PAD_L, PAD_R, PAD_T, chartBottom, chartH, chartW, STRIP_H, tMin, tMax, yMax, buckets, range: axisRange, mode: payload?.mode, toX, toY };

    if (!stats.hasData) {
      ctx.fillStyle = 'rgba(148,163,184,0.6)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(t('noHistoryRange'), W / 2, H / 2);
      return;
    }

    // Grid + Y etiketleri
    ctx.strokeStyle = C_GRID; ctx.lineWidth = 1;
    ctx.fillStyle = C_AXIS; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = PAD_T + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.fillText(Math.round(yMax * (4 - i) / 4) + ' ms', PAD_L - 6, y + 3);
    }

    // X etiketleri (aralığa duyarlı; kenarları hizala, kırpma yok)
    const nLabels = 5;
    for (let i = 0; i < nLabels; i++) {
      const ts = tMin + (tMax - tMin) * i / (nLabels - 1);
      ctx.textAlign = i === 0 ? 'left' : i === nLabels - 1 ? 'right' : 'center';
      const x = Math.max(PAD_L, Math.min(W - PAD_R, toX(ts)));
      ctx.fillText(fmtAxis(ts, axisRange), x, chartBottom + 12);
    }

    const segs = segments(buckets);
    const cx = (b) => toX(b.t + b.width / 2);

    // min-max bandı (rollup'ta gecikme yayılımı; ham veride min=max -> görünmez)
    ctx.fillStyle = C_BAND;
    for (const [a, b] of segs) {
      ctx.beginPath();
      for (let k = a; k < b; k++) { const bk = buckets[k]; ctx.lineTo(cx(bk), toY(bk.max != null ? bk.max : bk.avg)); }
      for (let k = b - 1; k >= a; k--) { const bk = buckets[k]; ctx.lineTo(cx(bk), toY(bk.min != null ? bk.min : bk.avg)); }
      ctx.closePath(); ctx.fill();
    }

    // avg altında gradyan alan
    const grad = ctx.createLinearGradient(0, PAD_T, 0, chartBottom);
    grad.addColorStop(0, C_AREA_TOP); grad.addColorStop(1, C_AREA_BOT);
    ctx.fillStyle = grad;
    for (const [a, b] of segs) {
      ctx.beginPath();
      ctx.moveTo(cx(buckets[a]), chartBottom);
      for (let k = a; k < b; k++) ctx.lineTo(cx(buckets[k]), toY(buckets[k].avg));
      ctx.lineTo(cx(buckets[b - 1]), chartBottom);
      ctx.closePath(); ctx.fill();
    }

    // ortalama referans çizgisi (kesikli)
    if (stats.avg != null) {
      const y = toY(stats.avg);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(148,163,184,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.restore();
    }

    // avg çizgisi (kesintide boşluk)
    ctx.strokeStyle = C_LINE; ctx.lineWidth = 1.5;
    for (const [a, b] of segs) {
      ctx.beginPath();
      for (let k = a; k < b; k++) { const x = cx(buckets[k]), y = toY(buckets[k].avg); if (k === a) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }

    // izole (tek kova) veri noktaları çizgide görünmez kalır -> nokta ile göster
    ctx.fillStyle = C_LINE;
    for (const [a, b] of segs) {
      if (b - a === 1) { const bk = buckets[a]; ctx.beginPath(); ctx.arc(cx(bk), toY(bk.avg), 1.8, 0, Math.PI * 2); ctx.fill(); }
    }

    // Uygunluk şeridi (altta): yeşil=up, kırmızı=kesinti, gri=veri yok
    const stripY = H - STRIP_H;
    for (const b of buckets) {
      const x0 = toX(b.t), x1 = toX(b.t + b.width);
      ctx.fillStyle = b.empty ? C_EMPTY : (b.down > 0 ? C_DOWN : C_UP);
      ctx.fillRect(x0, stripY, Math.max(1, x1 - x0), STRIP_H);
    }
  }, [payload, sizeTick, range, stats, points, rangeMs]);

  // Hover overlay (ayrı canvas -> mousemove taban grafiği yeniden çizmez)
  useEffect(() => {
    const canvas = overlayRef.current;
    const g = geomRef.current;
    if (!canvas || !g) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    if (hover == null) return;
    const b = g.buckets[hover];
    if (!b || b.empty) return;
    const x = g.toX(b.t + b.width / 2);
    ctx.strokeStyle = 'rgba(56,189,248,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, g.PAD_T); ctx.lineTo(x, g.chartBottom); ctx.stroke();
    if (b.avg != null) {
      const y = g.toY(b.avg);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8'; ctx.fill();
      ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2; ctx.stroke();
    } else if (b.down > 0) {
      ctx.beginPath(); ctx.arc(x, g.chartBottom, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444'; ctx.fill();
    }
  }, [hover, payload, sizeTick]);

  const handleMouseMove = useCallback((e) => {
    const g = geomRef.current;
    if (!g) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    if (mouseX < g.PAD_L || mouseX > g.W - g.PAD_R) { setHover(null); return; }
    const frac = (mouseX - g.PAD_L) / g.chartW;
    const idx = Math.max(0, Math.min(g.buckets.length - 1, Math.floor(frac * g.buckets.length)));
    setHover(idx);
  }, []);
  const handleMouseLeave = useCallback(() => setHover(null), []);

  // Tooltip konumu (geomRef güncel; hover değişimi zaten yeniden render tetikler)
  let tip = null;
  const g = geomRef.current;
  if (hover != null && g && g.buckets[hover] && !g.buckets[hover].empty) {
    const b = g.buckets[hover];
    tip = { x: g.toX(b.t + b.width / 2), y: b.avg != null ? g.toY(b.avg) : g.chartBottom, b };
  }

  const activeRange = payload?._range || range; // etiketler çizilen payload'ın aralığına göre
  const uptimeColor = stats.uptime == null ? 'var(--text-muted)'
    : stats.uptime >= 99 ? 'var(--success)'
      : stats.uptime >= 90 ? 'var(--warning)'
        : 'var(--danger)';
  const tiles = [
    { label: t('statUptime'), value: stats.uptime == null ? '—' : stats.uptime.toFixed(stats.uptime >= 99.95 ? 0 : 1) + '%', color: uptimeColor },
    { label: t('statCurrent'), value: stats.currentDown ? 'DOWN' : fmtMs(stats.current), color: stats.currentDown ? 'var(--danger)' : undefined },
    { label: t('statMin'), value: fmtMs(stats.min) },
    { label: t('statAvg'), value: fmtMs(stats.avg) },
    { label: t('statMax'), value: fmtMs(stats.max) },
  ];

  return (
    <div className="chart-container" style={{ height: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary)' }}>{t('pingHistory')}</h3>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: C_UP }} />UP</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: C_DOWN }} />DOWN</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`nav-btn ${range === r ? 'active' : ''}`}
              style={{ fontSize: '0.75rem', padding: '6px 12px', border: '1px solid var(--border-color)' }}>{r}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', marginBottom: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 4px' }}>
        {tiles.map((tile, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', borderRight: i < tiles.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{tile.label}</div>
            <div style={{ fontSize: '1.02rem', fontWeight: 600, color: tile.color || 'var(--text-main)' }}>{tile.value}</div>
          </div>
        ))}
      </div>

      <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas ref={baseRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
        {tip && (
          <div style={{
            position: 'absolute',
            left: Math.min(tip.x + 12, (containerRef.current?.clientWidth || 300) - 130),
            top: Math.max(tip.y - 52, 0),
            background: 'var(--bg-panel)',
            border: `1px solid ${tip.b.down > 0 && tip.b.up === 0 ? 'var(--danger)' : 'var(--primary)'}`,
            borderRadius: 8, padding: '6px 10px', boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
            pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap'
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{fmtTip(tip.b.t + tip.b.width / 2, activeRange)}</div>
            {tip.b.avg != null ? (
              <>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--primary)' }}>{fmtMs(tip.b.avg)}</div>
                {payload?.mode === 'rollup' && tip.b.min != null && tip.b.max != null && (tip.b.max - tip.b.min > 0.5) && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>min {Math.round(tip.b.min)} · max {Math.round(tip.b.max)}</div>
                )}
                {tip.b.down > 0 && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>%{Math.round(tip.b.down / (tip.b.up + tip.b.down) * 100)} {t('packetLoss')}</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--danger)' }}>● DOWN</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
