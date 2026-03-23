import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { getLang } from '../i18n';

export default function PingHistoryChart({ deviceId }) {
  const [data, setData] = useState([]);
  const [range, setRange] = useState('1H');
  const { authFetch } = useAuth();
  const ranges = { '1H': 3600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000 };

  const fetchHistory = useCallback(async () => {
    try {
      const res = await authFetch(`/switches/${deviceId}/ping-history?duration=${ranges[range]}`);
      if (res && res.ok) {
        const d = await res.json();
        setData(d.map(h => ({
          time: new Date(h.timestamp).toLocaleTimeString(getLang() === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
          value: h.value === -1 ? 0 : h.value
        })));
      }
    } catch (e) { /* ignore */ }
  }, [deviceId, authFetch, range]);

  useEffect(() => {
    fetchHistory();
    const i = setInterval(fetchHistory, 10000);
    return () => clearInterval(i);
  }, [fetchHistory]);

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
          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="var(--text-muted)" fontSize={11} unit="ms" tickLine={false} axisLine={false} />
          <RechartsTooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--primary)', borderRadius: '8px', color: 'var(--text-main)', boxShadow: '0 10px 20px rgba(0,0,0,0.5)' }} />
          <Area type="monotone" dataKey="value" stroke="var(--primary)" fill="url(#colorPing)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
