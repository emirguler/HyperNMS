import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useViewport } from '../hooks/useViewport';

export function severityColor(severity) {
  if (severity === 'critical') return 'var(--danger)';
  if (severity === 'resolved') return 'var(--success)';
  return 'var(--text-muted)';
}

// dvh destegi yoksa vh'ye dus. Inline stilde iki kez ayni ozellik yazilamadigi
// icin fallback burada bir kez olculuyor.
const VH = (typeof window !== 'undefined' && window.CSS && typeof window.CSS.supports === 'function'
  && window.CSS.supports('height', '100dvh')) ? 'dvh' : 'vh';

// Telefonda "8/14/2026, 10:23:45 AM" satiri kirar; goreli bicim tek satirda kalir.
function relativeTime(ts) {
  const d = new Date(ts);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

const panelBaseStyle = {
  background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
  borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.5)', zIndex: 9999,
  overflow: 'hidden'
};

const headBaseStyle = {
  padding: '12px 16px', borderBottom: '1px solid var(--border-color)',
  fontWeight: 600, fontSize: '0.9rem'
};

const closeBtnStyle = {
  flexShrink: 0, width: 44, height: 44, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'none', border: 'none', padding: 0,
  margin: '-10px -8px', color: 'var(--text-muted)', fontSize: '1.2rem',
  lineHeight: 1, cursor: 'pointer', borderRadius: 8, touchAction: 'manipulation'
};

export default function NotificationBell() {
  const { notifications, unreadCount, markNotificationsRead } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const { isPhone, isShort, width, height } = useViewport();

  // Telefon VEYA kisa ekran: acilir menu yerine tam genislikte sabit panel.
  const compact = isPhone || isShort;
  const landscape = width > height;
  const navH = isShort ? 44 : 48; // responsive.css --nav-h / --nav-h-compact

  // Panel açıkken dışarı tıklama / Escape ile kapansın.
  // pointerdown: iOS'ta bos alana dokunulunca mousedown guvenilir gelmiyor.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Ekran donunce / kirilma noktasi asilinca panel konumu gecersiz kalir -> kapat.
  // Effect yerine render sirasinda ayarlama (React'in turev state sifirlama kalibi).
  const closeKey = `${isPhone}|${isShort}|${landscape}`;
  const [prevCloseKey, setPrevCloseKey] = useState(closeKey);
  if (prevCloseKey !== closeKey) {
    setPrevCloseKey(closeKey);
    if (open) setOpen(false);
  }

  const panelStyle = compact
    ? {
        ...panelBaseStyle,
        position: 'fixed',
        top: navH + 4,
        left: 'max(8px, env(safe-area-inset-left))',
        right: 'max(8px, env(safe-area-inset-right))',
        width: 'auto',
        maxHeight: `calc(100${VH} - ${navH + 16}px)`,
        display: 'flex',
        flexDirection: 'column'
      }
    : { ...panelBaseStyle, position: 'absolute', top: '100%', right: 0, width: 360, maxHeight: 400 };

  const headStyle = compact
    ? { ...headBaseStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flex: '0 0 auto' }
    : headBaseStyle;

  const listStyle = compact
    ? { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', paddingBottom: 'env(safe-area-inset-bottom)' }
    : { maxHeight: 350, overflowY: 'auto' };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="nav-btn"
        type="button"
        onClick={() => { setOpen(!open); markNotificationsRead(); }}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-expanded={open}
        style={{ fontSize: '1.2rem', position: 'relative', overflow: 'visible' }}
      >
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
        <div style={panelStyle} role="dialog" aria-label="Notifications">
          <div style={headStyle}>
            <span>Notifications</span>
            {compact && (
              <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications" style={closeBtnStyle}>✕</button>
            )}
          </div>
          <div style={listStyle}>
            {notifications.length > 0 ? notifications.map(n => (
              <div key={n.id}
                className={n.deviceId ? 'notif-clickable' : undefined}
                onClick={n.deviceId ? () => { setOpen(false); navigate(`/devices/${n.deviceId}`); } : undefined}
                title={n.deviceId ? n.deviceName : undefined}
                style={{
                  padding: compact ? '12px 14px' : '10px 16px',
                  minHeight: compact ? 56 : undefined,
                  boxSizing: 'border-box',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex', gap: 10, alignItems: 'flex-start'
                }}>
                <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{n.severity === 'critical' ? '🔴' : '🟢'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: severityColor(n.severity) }}>{n.title}</div>
                  <div style={{ fontSize: compact ? '0.8125rem' : '0.75rem', color: 'var(--text-muted)', marginTop: 2, overflowWrap: 'anywhere' }}>{n.message}</div>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {n.topologyPage && (
                      <span style={{
                        background: 'rgba(56,189,248,0.15)', color: 'var(--primary)',
                        padding: '1px 6px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 600
                      }}>🗺️ {n.topologyPage}</span>
                    )}
                    <span style={{ fontSize: compact ? '0.75rem' : '0.7rem', color: 'var(--text-muted)' }}>
                      {compact ? relativeTime(n.timestamp) : new Date(n.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
                {compact && n.deviceId && (
                  <span aria-hidden="true" style={{ flexShrink: 0, alignSelf: 'center', color: 'var(--text-dim)', fontSize: '1.1rem', lineHeight: 1 }}>›</span>
                )}
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
