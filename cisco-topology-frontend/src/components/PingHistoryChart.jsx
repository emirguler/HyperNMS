import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export default function PingHistoryChart({ deviceId }) {
  const [data, setData] = useState([]);
  const [range, setRange] = useState('1H');
  const [hover, setHover] = useState(null); // { x, y, ms, time }
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const { authFetch } = useAuth();
  const ranges = { '1H': 3600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000 };

  const fetchHistory = useCallback(async () => {
    try {
      const res = await authFetch(`/switches/${deviceId}/ping-history?duration=${ranges[range]}`);
      if (res && res.ok) {
        const d = await res.json();
        setData(d.map(h => ({
          ts: h.timestamp,
          ms: h.value === -1 ? 0 : h.value
        })));
      }
    } catch (e) { /* ignore */ }
  }, [deviceId, authFetch, range]);

  useEffect(() => {
    fetchHistory();
    const i = setInterval(fetchHistory, 10000);
    return () => clearInterval(i);
  }, [fetchHistory]);

  // Canvas ile çizim — her noktaya birebir erişim
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || data.length === 0) return;

    const rect = container.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD_L = 50, PAD_R = 15, PAD_T = 10, PAD_B = 30;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;

    const maxMs = Math.max(1, ...data.map(d => d.ms));
    const minTs = data[0].ts;
    const maxTs = data[data.length - 1].ts;
    const tsRange = maxTs - minTs || 1;

    const toX = (ts) => PAD_L + ((ts - minTs) / tsRange) * chartW;
    const toY = (ms) => PAD_T + chartH - (ms / maxMs) * chartH;

    // Arka plan temizle
    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD_T + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
    }

    // Y axis labels
    ctx.fillStyle = 'rgba(148,163,184,0.8)';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxMs * (4 - i) / 4);
      const y = PAD_T + (chartH / 4) * i;
      ctx.fillText(val + ' ms', PAD_L - 6, y + 3);
    }

    // X axis labels
    ctx.textAlign = 'center';
    const labelCount = Math.min(6, data.length);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor((data.length - 1) * i / (labelCount - 1));
      const d = data[idx];
      const x = toX(d.ts);
      const timeStr = new Date(d.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(timeStr, x, H - 6);
    }

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + chartH);
    gradient.addColorStop(0, 'rgba(56,189,248,0.25)');
    gradient.addColorStop(1, 'rgba(56,189,248,0)');

    ctx.beginPath();
    ctx.moveTo(toX(data[0].ts), PAD_T + chartH);
    data.forEach(d => ctx.lineTo(toX(d.ts), toY(d.ms)));
    ctx.lineTo(toX(data[data.length - 1].ts), PAD_T + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = toX(d.ts);
      const y = toY(d.ms);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(56,189,248,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Hover noktası
    if (hover) {
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Dikey çizgi
      ctx.beginPath();
      ctx.moveTo(hover.x, PAD_T);
      ctx.lineTo(hover.x, PAD_T + chartH);
      ctx.strokeStyle = 'rgba(56,189,248,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [data, hover]);

  // Mouse move — en yakın veri noktasını bul
  const handleMouseMove = useCallback((e) => {
    if (data.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    const W = rect.width;
    const H = rect.height;
    const PAD_L = 50, PAD_R = 15, PAD_T = 10, PAD_B = 30;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const minTs = data[0].ts;
    const maxTs = data[data.length - 1].ts;
    const tsRange = maxTs - minTs || 1;
    const maxMs = Math.max(1, ...data.map(d => d.ms));

    // Mouse X → timestamp → en yakın noktayı bul (binary search)
    const mouseTs = minTs + ((mouseX - PAD_L) / chartW) * tsRange;
    let closest = data[0], closestDist = Infinity;
    for (const d of data) {
      const dist = Math.abs(d.ts - mouseTs);
      if (dist < closestDist) { closestDist = dist; closest = d; }
    }

    const x = PAD_L + ((closest.ts - minTs) / tsRange) * chartW;
    const y = PAD_T + chartH - (closest.ms / maxMs) * chartH;
    const time = new Date(closest.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setHover({ x, y, ms: closest.ms, time });
  }, [data]);

  const handleMouseLeave = useCallback(() => setHover(null), []);

  return (
    <div className="chart-container" style={{ height: 350 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary)' }}>Ping History (ms)</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {['1H', '1D', '1W', '1M'].map(r => (
            <button key={r} onClick={() => setRange(r)} className={`nav-btn ${range === r ? 'active' : ''}`}
              style={{ fontSize: '0.75rem', padding: '6px 12px', border: '1px solid var(--border-color)' }}>{r}</button>
          ))}
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 'calc(100% - 60px)', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {hover && (
          <div style={{
            position: 'absolute',
            left: Math.min(hover.x + 12, (containerRef.current?.clientWidth || 300) - 100),
            top: Math.max(hover.y - 45, 0),
            background: 'var(--bg-panel)', border: '1px solid var(--primary)',
            borderRadius: 8, padding: '6px 10px', boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
            pointerEvents: 'none', zIndex: 10
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{hover.time}</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--primary)' }}>{hover.ms} ms</div>
          </div>
        )}
      </div>
    </div>
  );
}
