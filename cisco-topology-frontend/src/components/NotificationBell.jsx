import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';

export function severityColor(severity) {
  if (severity === 'critical') return 'var(--danger)';
  if (severity === 'resolved') return 'var(--success)';
  return 'var(--text-muted)';
}

export default function NotificationBell() {
  const { notifications, unreadCount, markNotificationsRead } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Panel açıkken dışarı tıklama / Escape ile kapansın
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button className="nav-btn" onClick={() => { setOpen(!open); markNotificationsRead(); }} style={{ fontSize: '1.2rem', position: 'relative' }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    {n.topologyPage && (
                      <span style={{
                        background: 'rgba(56,189,248,0.15)', color: 'var(--primary)',
                        padding: '1px 6px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 600
                      }}>🗺️ {n.topologyPage}</span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {new Date(n.timestamp).toLocaleString()}
                    </span>
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
