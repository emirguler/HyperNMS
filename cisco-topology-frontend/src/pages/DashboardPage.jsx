import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useApp } from '../context/AppContext';
import { t } from '../i18n';

export default function DashboardPage() {
  const { rawDevices } = useApp();
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const upCount = rawDevices.filter(d => d.status === 'UP').length;
    const downCount = rawDevices.filter(d => d.status !== 'UP').length;
    const avgLatency = upCount > 0 ? Math.round(rawDevices.filter(d => d.status === 'UP' && d.latency > 0).reduce((s, d) => s + d.latency, 0) / (upCount || 1)) : 0;
    const healthPct = rawDevices.length > 0 ? Math.round((upCount / rawDevices.length) * 100) : 0;
    const typeGroups = {};
    rawDevices.forEach(d => { typeGroups[d.type || 'other'] = (typeGroups[d.type || 'other'] || 0) + 1; });
    return { upCount, downCount, avgLatency, healthPct, typeGroups };
  }, [rawDevices]);

  const pieData = [{ name: 'UP', value: stats.upCount }, { name: 'DOWN', value: stats.downCount }];
  const COLORS = ['#22c55e', '#ef4444'];

  return (
    <div className="list-container">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 24 }}>
        {[
          { label: t('totalDevices'), value: rawDevices.length, color: undefined },
          { label: t('activeUp'), value: stats.upCount, color: 'var(--success)' },
          { label: t('inactiveDown'), value: stats.downCount, color: 'var(--danger)' },
          { label: t('avgLatency'), value: stats.avgLatency, color: 'var(--primary)', suffix: ' ms' }
        ].map((card, i) => (
          <div key={i} className="chart-container dash-stat-card">
            <h3 className="dash-stat-label">{card.label}</h3>
            <p className="dash-stat-value" style={card.color ? { color: card.color } : {}}>
              {card.value}{card.suffix && <span style={{ fontSize: '1rem', fontWeight: 400 }}>{card.suffix}</span>}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 20 }}>
        {/* Network Health Pie */}
        <div className="chart-container" style={{ textAlign: 'center' }}>
          <h3 className="dash-section-title">{t('networkHealth')}</h3>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} dataKey="value" strokeWidth={0}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: stats.healthPct >= 80 ? 'var(--success)' : stats.healthPct >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{stats.healthPct}%</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>● UP: {stats.upCount}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>● DOWN: {stats.downCount}</span>
          </div>
        </div>

        {/* Device Types */}
        <div className="chart-container">
          <h3 className="dash-section-title">{t('deviceTypes')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {Object.entries(stats.typeGroups).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', textTransform: 'capitalize' }}>{type}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 6, background: 'var(--border-color)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(count / rawDevices.length) * 100}%`, height: '100%', background: 'var(--primary)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: 20, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Device Status Table */}
        <div className="chart-container" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
            <h3 className="dash-section-title" style={{ margin: 0 }}>{t('deviceStatus')}</h3>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="modern-table" style={{ borderSpacing: 0 }}>
              <tbody>
                {rawDevices.slice(0, 10).map(d => (
                  <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${d.id}`, { state: { from: '/dashboard' } })}>
                    <td style={{ padding: '10px 16px', width: 80 }}>
                      <span className={`status-badge ${d.status === 'UP' ? 'status-up' : 'status-down'}`} style={{ fontSize: '0.7rem', padding: '3px 8px' }}>{d.status}</span>
                    </td>
                    <td style={{ padding: '10px 0', fontWeight: 500, fontSize: '0.85rem' }}>{d.name}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.ip}</td>
                    <td style={{ padding: '10px 16px', fontSize: '0.8rem', color: d.latency > 100 ? 'var(--danger)' : 'var(--text-muted)' }}>{d.latency > 0 ? d.latency + ' ms' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
