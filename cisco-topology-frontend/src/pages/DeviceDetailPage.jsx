import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Gauge from '../components/Gauge';
import PingHistoryChart from '../components/PingHistoryChart';
import { t } from '../i18n';

export default function DeviceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { authFetch } = useAuth();
  // Geri dön: gelinen sayfaya (topoloji sekmesi / Devices / Dashboard ...).
  // Doğrudan link ile açıldıysa (state yok) Devices'a düş.
  const backTo = location.state?.from || '/devices';
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
        <button onClick={() => navigate(backTo)} className="btn btn-ghost">{t('goBack')}</button>
        <h2 style={{ margin: 0, fontSize: '1.8rem' }}>{displayHostname}</h2>
        <span className={`status-badge ${details.status === 'UP' ? 'status-up' : 'status-down'}`} style={{ marginLeft: 'auto' }}>{details.status}</span>
      </div>

      <div className="chart-container" style={{ marginBottom: 24, padding: '24px 32px' }}>
        <div className="grid-stats" style={{ textAlign: 'center', marginBottom: details.snmpCommunity || details.sshUsername ? 20 : 0 }}>
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
        {details.sshPasswordSet !== undefined && (
          <div style={{ display: 'flex', gap: 32, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>SNMP Community</span>
              <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', marginTop: 4, color: details.snmpCommunity ? 'var(--text-main)' : 'var(--danger)' }}>
                {details.snmpCommunity || 'Not set  ✕'}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>SSH Username</span>
              <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', marginTop: 4, color: details.sshUsername ? 'var(--text-main)' : 'var(--danger)' }}>
                {details.sshUsername || 'Not set  ✕'}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>SSH Password</span>
              <div style={{ fontSize: '0.9rem', marginTop: 4, color: details.sshPasswordSet ? 'var(--success)' : 'var(--danger)' }}>
                {details.sshPasswordSet ? '••••••••  ✓' : 'Not set  ✕'}
              </div>
            </div>
            {details.model && (
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Model</span>
                <div style={{ fontSize: '0.9rem', marginTop: 4 }}>{details.model}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid-detail-main" style={{ marginBottom: 24 }}>
        <PingHistoryChart deviceId={id} />
        <Gauge value={details.cpu || 0} label="CPU Load" color={(details.cpu || 0) > 80 ? 'var(--danger)' : 'var(--primary)'} />
        <Gauge value={details.ram || 0} label="RAM Usage" color={(details.ram || 0) > 80 ? 'var(--danger)' : '#8b5cf6'} />
      </div>

      {/* Show Run Kartı */}
      <ShowRunCard deviceId={id} />

      <div className="chart-container" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary)' }}>Physical Interfaces</h3>
        </div>
        <table className="modern-table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 24, width: '20%' }}>Port</th>
              <th style={{ width: '12%' }}>VLAN</th>
              <th style={{ width: '28%' }}>VLAN Name</th>
              <th style={{ width: '15%' }}>Status</th>
              <th style={{ width: '10%' }}>Capacity</th>
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
                  {i.trunkVlans && i.trunkVlans.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 200 }}>
                      {i.trunkVlans.join(', ')}
                    </div>
                  )}
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

function ShowRunCard({ deviceId }) {
  const { isAdmin, authFetch } = useAuth();
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const fetchShowRun = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`/switches/${deviceId}/exec`, {
        method: 'POST',
        body: JSON.stringify({ command: 'show running-config' })
      });
      if (res.ok) {
        const data = await res.json();
        setOutput(data.output || 'No output');
        setExpanded(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed');
      }
    } catch (e) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  // Running config yalnızca admin'e. (Hook'lardan SONRA dönülüyor — hook sırası bozulmasın.)
  // Backend'de de requireAdmin var: UI'ı gizlemek tek başına yetki denetimi değildir.
  if (!isAdmin) return null;

  return (
    <div className="chart-container" style={{ marginTop: 24, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary)' }}>Running Configuration</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {output && (
            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={fetchShowRun} disabled={loading}>
            {loading ? 'Loading...' : output ? 'Refresh' : 'Load Config'}
          </button>
        </div>
      </div>
      {error && (
        <div style={{ padding: '12px 24px', color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>
      )}
      {expanded && output && (
        <pre style={{
          margin: 0, padding: '16px 24px', fontSize: '0.75rem', lineHeight: 1.5,
          fontFamily: 'monospace', color: 'var(--text-main)', background: 'rgba(0,0,0,0.3)',
          maxHeight: 500, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
        }}>
          {output}
        </pre>
      )}
    </div>
  );
}
