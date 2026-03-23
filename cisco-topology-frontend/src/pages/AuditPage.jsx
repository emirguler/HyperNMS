import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AuditPage() {
  const { authFetch, isAdmin } = useAuth();

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Audit Log</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`nav-btn ${filter === '' ? 'active' : ''}`} onClick={() => setFilter('')}
            style={{ fontSize: '0.8rem', padding: '6px 12px', border: '1px solid var(--border-color)' }}>All</button>
          {actions.map(a => (
            <button key={a} className={`nav-btn ${filter === a ? 'active' : ''}`} onClick={() => setFilter(a)}
              style={{ fontSize: '0.7rem', padding: '4px 8px', border: '1px solid var(--border-color)' }}>{a.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          <table className="modern-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 24 }}>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length > 0 ? logs.map(log => (
                <tr key={log.id}>
                  <td style={{ paddingLeft: 24, fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td style={{ fontWeight: 600 }}>{log.username}</td>
                  <td>
                    <span style={{ color: actionColor(log.action), fontWeight: 600, fontSize: '0.8rem' }}>{log.action}</span>
                  </td>
                  <td>{log.target}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{log.ip || '-'}</td>
                </tr>
              )) : (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No audit logs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
