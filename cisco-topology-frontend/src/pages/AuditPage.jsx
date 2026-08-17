import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';

// Telefonda tam toLocaleString() tek basina ~160px; gun/ay + saat yeter.
const fmtTs = (ts, short) => {
  const d = new Date(ts);
  if (!short) return d.toLocaleString();
  return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function AuditPage() {
  const { authFetch, isAdmin } = useAuth();
  // Erken return'un USTUNDE cagrilmali, yoksa hook sirasi bozulur
  const { isPhone, isTablet, isShort, isTouch } = useViewport();
  const compact = isPhone || isShort;

  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      const url = filter ? `/audit?action=${filter}` : '/audit';
      const res = await authFetch(url);
      if (res && res.ok) setLogs(await res.json());
    };
    fetchLogs();
    const i = setInterval(fetchLogs, 10000);
    return () => clearInterval(i);
  }, [authFetch, filter]);

  const actions = ['LOGIN', 'LOGIN_FAILED', 'DEVICE_CREATE', 'DEVICE_UPDATE', 'DEVICE_DELETE', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'EDGE_CREATE', 'EDGE_DELETE'];

  const actionColor = (action) => {
    if (action.includes('DELETE') || action === 'LOGIN_FAILED') return 'var(--danger)';
    if (action.includes('CREATE')) return 'var(--success)';
    if (action === 'LOGIN') return 'var(--primary)';
    return 'var(--text-muted)';
  };

  return (
    <div className="list-container">
      {/* Satir kaydirma + bosluk .rw-actions'tan gelir (<=1024px). Inline flexWrap/gap
          yazilirsa masaustunde de gecerli olurdu -> bilerek yok. */}
      <div className="rw-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Audit Log</h2>
        {/* 12 cip 351px'e sigmiyordu: tablet ve altinda yatay kayan, tutunan bir serit.
            whiteSpace:nowrap da isTablet'e bagli: masaustunde ciplerin daralabilmesi
            (metnin sarilabilmesi) bugunku davranis, orada degistirmiyoruz. */}
        <div className="rw-scroll-x" style={{ display: 'flex', gap: 6, scrollSnapType: isTablet ? 'x proximity' : undefined }}>
          <button className={`nav-btn ${filter === '' ? 'active' : ''}`} onClick={() => setFilter('')}
            style={{ fontSize: '0.8rem', padding: isTouch ? '10px 14px' : '6px 12px', border: '1px solid var(--border-color)', flexShrink: isTablet ? 0 : undefined, scrollSnapAlign: isTablet ? 'start' : undefined, whiteSpace: isTablet ? 'nowrap' : undefined }}>All</button>
          {actions.map(a => (
            <button key={a} className={`nav-btn ${filter === a ? 'active' : ''}`} onClick={() => setFilter(a)}
              style={{ fontSize: isTouch ? '0.8rem' : '0.7rem', padding: isTouch ? '10px 14px' : '4px 8px', border: '1px solid var(--border-color)', flexShrink: isTablet ? 0 : undefined, scrollSnapAlign: isTablet ? 'start' : undefined, whiteSpace: isTablet ? 'nowrap' : undefined }}>{a.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Dar govdede ic dikey kaydiriciyi birak: sayfanin kendi kaydirmasi yeter.
            (calc(100vh - 200px) yatay telefonda 175px = 4 satir ediyordu.) */}
        <div className="rw-scroll-x" style={{ maxHeight: compact ? 'none' : 'calc(100vh - 200px)', overflowY: compact ? 'visible' : 'auto' }}>
          <table className="modern-table rw-cards">
            <thead>
              <tr>
                <th style={{ paddingLeft: isPhone ? undefined : 24 }}>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th className="rw-hide-md">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length > 0 ? logs.map(log => (
                <tr key={log.id}>
                  <td data-label="Time" style={{ paddingLeft: isPhone ? undefined : 24, fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {fmtTs(log.timestamp, compact)}
                  </td>
                  <td data-label="User" style={{ fontWeight: 600 }}>{log.username}</td>
                  <td data-label="Action">
                    <span style={{ color: actionColor(log.action), fontWeight: 600, fontSize: '0.8rem' }}>{log.action}</span>
                  </td>
                  <td data-label="Target">{log.target}</td>
                  <td data-label="IP" className="rw-hide-md" style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{log.ip || '-'}</td>
                </tr>
              )) : (
                // justifyContent sadece kart modunda (display:flex) etkili, masaustunde no-op
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', justifyContent: 'center' }}>No audit logs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
