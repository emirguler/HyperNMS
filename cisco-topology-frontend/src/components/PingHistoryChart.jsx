import { useState, useEffect, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { getLang } from '../i18n';

// Veriyi downsample et — çok yoğun olunca peak'ler kaybolmasın
function downsample(data, maxPoints = 200) {
  if (data.length <= maxPoints) return data;

  const bucketSize = Math.ceil(data.length / maxPoints);
  const result = [];

  for (let i = 0; i < data.length; i += bucketSize) {
    const bucket = data.slice(i, i + bucketSize);
    // Her bucket'tan max değeri ve son değeri al (peak koruması)
    const maxItem = bucket.reduce((max, item) => item.ms > max.ms ? item : max, bucket[0]);
    const lastItem = bucket[bucket.length - 1];

    // Peak farklıysa ikisini de ekle
    if (maxItem !== lastItem && maxItem.ms > lastItem.ms * 1.3) {
      result.push(maxItem);
    }
    result.push(lastItem);
  }

  return result;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'var(--bg-panel)', border: '1px solid var(--primary)',
      borderRadius: 8, padding: '8px 12px', boxShadow: '0 10px 20px rgba(0,0,0,0.5)'
    }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--primary)' }}>
        {payload[0].value} ms
      </div>
    </div>
  );
};

export default function PingHistoryChart({ deviceId }) {
  const [rawData, setRawData] = useState([]);
  const [range, setRange] = useState('1H');
  const { authFetch } = useAuth();
  const ranges = { '1H': 3600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000 };

  const fetchHistory = useCallback(async () => {
    try {
      const res = await authFetch(`/switches/${deviceId}/ping-history?duration=${ranges[range]}`);
      if (res && res.ok) {
        const d = await res.json();
        const locale = getLang() === 'tr' ? 'tr-TR' : 'en-US';
        const timeOpts = range === '1H' || range === '1D'
          ? { hour: '2-digit', minute: '2-digit' }
          : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

        setRawData(d.map(h => ({
          time: new Date(h.timestamp).toLocaleString(locale, timeOpts),
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

  const data = useMemo(() => downsample(rawData, 500), [rawData]);

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
      <ResponsiveContainer width="100%" height="80%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorPing" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis stroke="var(--text-muted)" fontSize={11} unit=" ms" tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
          <Area type="linear" dataKey="ms" stroke="var(--primary)" fill="url(#colorPing)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 1.5, fill: 'var(--primary)' }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
