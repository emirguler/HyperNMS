import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useApp } from '../context/AppContext';
import { severityColor } from '../components/NotificationBell';
import { t } from '../i18n';

export default function DashboardPage() {
  const { rawDevices, topoTabs, notifications } = useApp();
  const navigate = useNavigate();

  // DOWN cihazlar tablosu — topoloji sayfası + tip filtresi
  const [downPage, setDownPage] = useState('all');
  const [downType, setDownType] = useState('all');

  const downDevices = useMemo(() => rawDevices.filter(d => d.status !== 'UP'), [rawDevices]);
  const downTypes = useMemo(() => [...new Set(downDevices.map(d => d.type || 'switch'))].sort(), [downDevices]);
  const filteredDown = useMemo(() => downDevices.filter(d =>
    (downPage === 'all' || (d.topologyPage || 'main') === downPage) &&
    (downType === 'all' || (d.type || 'switch') === downType)
  ), [downDevices, downPage, downType]);
  const pageName = (id) => topoTabs.find(tab => tab.id === (id || 'main'))?.name || (id || 'main');

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
      <div className="grid-stats" style={{ marginBottom: 14 }}>
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

      <div className="grid-dash-main">
        {/* Network Health Pie */}
        <div className="chart-container" style={{ textAlign: 'center' }}>
          <h3 className="dash-section-title">{t('networkHealth')}</h3>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <ResponsiveContainer width={130} height={130}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={58} dataKey="value" strokeWidth={0}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: stats.healthPct >= 80 ? 'var(--success)' : stats.healthPct >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{stats.healthPct}%</div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, maxHeight: 190, overflowY: 'auto' }}>
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

        {/* Notifications (zil ile aynı veri) */}
        <div className="chart-container" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
            <h3 className="dash-section-title" style={{ margin: 0 }}>🔔 {t('notifications')}</h3>
          </div>
          <div style={{ maxHeight: 190, overflowY: 'auto' }}>
            {notifications.length > 0 ? notifications.map(n => (
              <div key={n.id}
                className={n.deviceId ? 'notif-clickable' : undefined}
                onClick={n.deviceId ? () => navigate(`/devices/${n.deviceId}`) : undefined}
                title={n.deviceId ? n.deviceName : undefined}
                style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1rem', lineHeight: 1.2 }}>{n.severity === 'critical' ? '🔴' : '🟢'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: severityColor(n.severity) }}>{n.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    {n.topologyPage && (
                      <span style={{ background: 'rgba(56,189,248,0.15)', color: 'var(--primary)', padding: '1px 6px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 600 }}>🗺️ {n.topologyPage}</span>
                    )}
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{new Date(n.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('noNotifications')}</div>
            )}
          </div>
        </div>

      </div>

      {/* DOWN cihazlar — sayfa sekmeleri + tip filtresi */}
      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden', marginTop: 14 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h3 className="dash-section-title" style={{ margin: 0 }}>
            🔴 {t('downDevices')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({filteredDown.length})</span>
          </h3>
          <select className="modern-input" value={downType} onChange={e => setDownType(e.target.value)}
            style={{ width: 'auto', minWidth: 140, fontSize: '0.8rem', padding: '8px 12px' }}>
            <option value="all">{t('allTypes')}</option>
            {downTypes.map(ty => <option key={ty} value={ty} style={{ textTransform: 'capitalize' }}>{ty}</option>)}
          </select>
        </div>

        {/* Sayfa sekmeleri */}
        <div className="topology-tabs" style={{ padding: '0 12px', flexWrap: 'wrap' }}>
          <div className={`topology-tab ${downPage === 'all' ? 'active' : ''}`} onClick={() => setDownPage('all')}>{t('allPages')}</div>
          {topoTabs.map(tab => (
            <div key={tab.id} className={`topology-tab ${downPage === tab.id ? 'active' : ''}`} onClick={() => setDownPage(tab.id)}>{tab.name}</div>
          ))}
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          <table className="modern-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 24 }}>Status</th>
                <th>Name</th>
                <th>IP</th>
                <th>Type</th>
                <th style={{ paddingRight: 24 }}>Page</th>
              </tr>
            </thead>
            <tbody>
              {filteredDown.length > 0 ? filteredDown.map(d => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${d.id}`, { state: { from: '/dashboard' } })}>
                  <td style={{ paddingLeft: 24 }}><span className="status-badge status-down" style={{ fontSize: '0.7rem', padding: '3px 8px' }}>DOWN</span></td>
                  <td style={{ fontWeight: 500, fontSize: '0.85rem' }}>{d.name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.ip}</td>
                  <td style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>{d.type || 'switch'}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingRight: 24 }}>{pageName(d.topologyPage)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{t('noDownDevices')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
