import { useState, useEffect, useRef } from 'react';
import { WS_BASE, API_BASE } from '../config';
import { useAuth } from '../context/AuthContext';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const wsRef = useRef(null);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    // Fetch initial notifications
    fetch(`${API_BASE}/notifications`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setNotifications(data);
        setUnreadCount(data.filter(n => !n.read).length);
      })
      .catch(() => {});

    // WebSocket for real-time
    const ws = new WebSocket(`${WS_BASE}/ws/notifications`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'notification') {
          setNotifications(prev => [msg.data, ...prev].slice(0, 50));
          setUnreadCount(prev => prev + 1);
        } else if (msg.type === 'history') {
          setNotifications(msg.data);
          setUnreadCount(msg.data.filter(n => !n.read).length);
        }
      } catch (e) { /* ignore */ }
    };

    return () => { try { ws.close(); } catch (e) {} };
  }, [isAuthenticated]);

  const severityColor = (severity) => {
    if (severity === 'critical') return 'var(--danger)';
    if (severity === 'resolved') return 'var(--success)';
    return 'var(--text-muted)';
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="nav-btn" onClick={() => { setOpen(!open); setUnreadCount(0); }} style={{ fontSize: '1.2rem', position: 'relative' }}>
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2, background: 'var(--danger)',
            color: '#fff', fontSize: '0.6rem', fontWeight: 700, borderRadius: '50%',
            width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, width: 360, maxHeight: 400,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
          borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.5)', zIndex: 9999,
          overflow: 'hidden'
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.9rem' }}>
            Notifications
          </div>
          <div style={{ maxHeight: 350, overflowY: 'auto' }}>
            {notifications.length > 0 ? notifications.map(n => (
              <div key={n.id} style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{n.severity === 'critical' ? '🔴' : '🟢'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: severityColor(n.severity) }}>{n.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{n.message}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {new Date(n.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No notifications yet
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
