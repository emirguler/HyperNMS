import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Gauge from '../components/Gauge';
import PingHistoryChart from '../components/PingHistoryChart';
import { t } from '../i18n';

export default function DeviceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const f = async () => {
      try {
        const res = await authFetch(`/switches/${id}/details`);
        if (res && res.ok) setDetails(await res.json());
      } catch (e) { /* ignore */ } finally { setLoading(false); }
    };
    f();
    const i = setInterval(f, 5000);
    return () => clearInterval(i);
  }, [id, authFetch]);

  if (loading && !details) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{t('loadingDetails')}</div>;
  if (!details) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>{t('noData')}</div>;

  const displayHostname = details.snmpHostname || details.name || 'Unknown';
  const formatTraffic = (bps) => {
    if (!bps || bps === 0) return '0 Mbps';
    const mbps = bps / 1000000;
    return mbps >= 1000 ? (mbps / 1000).toFixed(2) + ' Gbps' : mbps.toFixed(2) + ' Mbps';
  };
  const formatSpeed = (bps) => {
    if (!bps) return '-';
    if (bps >= 10000000000) return '10 G';
    if (bps >= 1000000000) return (bps / 1000000000).toFixed(0) + ' G';
    return (bps / 1000000).toFixed(0) + ' M';
  };

  return (
    <div className="list-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <button onClick={() => navigate('/devices')} className="btn btn-ghost">{t('goBack')}</button>
        <h2 style={{ margin: 0, fontSize: '1.8rem' }}>{displayHostname}</h2>
        <span className={`status-badge ${details.status === 'UP' ? 'status-up' : 'status-down'}`} style={{ marginLeft: 'auto' }}>{details.status}</span>
      </div>

      <div className="chart-container" style={{ marginBottom: 24, padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, textAlign: 'center' }}>
          {[
            { label: 'Real Hostname', value: displayHostname, color: 'var(--primary)' },
            { label: 'IP Address', value: details.ip, mono: true },
            { label: 'System Uptime', value: details.uptime || '-' },
            { label: 'Vendor', value: details.detectedVendor || '-' }
          ].map((item, i) => (
            <div key={i} style={i < 3 ? { borderRight: '1px solid var(--border-color)' } : {}}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{item.label}</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: item.color, fontFamily: item.mono ? 'monospace' : undefined }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 24, marginBottom: 24 }}>
        <PingHistoryChart deviceId={id} />
        <Gauge value={details.cpu || 0} label="CPU Load" color={(details.cpu || 0) > 80 ? 'var(--danger)' : 'var(--primary)'} />
        <Gauge value={details.ram || 0} label="RAM Usage" color={(details.ram || 0) > 80 ? 'var(--danger)' : '#8b5cf6'} />
      </div>

      <div className="chart-container" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary)' }}>Physical Interfaces</h3>
        </div>
        <table className="modern-table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 24 }}>Port</th>
              <th>VLAN</th>
              <th>VLAN Name</th>
              <th>Status</th>
              <th>Capacity</th>
            </tr>
          </thead>
          <tbody>
            {(details.interfaces || []).length > 0 ? details.interfaces.map(i => (
              <tr key={i.index}>
                <td style={{ paddingLeft: 24 }}><span style={{ fontWeight: 600 }}>{i.name}</span></td>
                <td>
                  <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'monospace', color: i.vlan && i.vlan !== '-' ? 'var(--text-main)' : 'var(--text-muted)', minWidth: '30px', display: 'inline-block', textAlign: 'center' }}>
                    {i.vlan || '-'}
                  </span>
                </td>
                <td style={{ fontSize: '0.8rem', color: i.vlanName && i.vlanName !== '-' ? 'var(--text-main)' : 'var(--text-muted)' }}>
                  {i.vlanName || '-'}
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, background: i.status === 'up' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', color: i.status === 'up' ? 'var(--success)' : 'var(--text-muted)', border: `1px solid ${i.status === 'up' ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
                    {i.status === 'up' ? '● UP' : '○ DOWN'}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{formatSpeed(i.speed)}</td>
              </tr>
            )) : (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                {details.status === 'UP' ? t('noPortsFound') : t('deviceDown')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
