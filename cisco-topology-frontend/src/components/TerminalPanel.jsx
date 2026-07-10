import { useCallback, useState } from 'react';
import TerminalPane from '../TerminalPane';
import { useApp } from '../context/AppContext';
import { t } from '../i18n';

const TAB_BAR_HEIGHT = 40;

export default function TerminalPanel() {
  const {
    sshSessions, activeSshTabId, setActiveSshTabId,
    terminalHeight, setTerminalHeight,
    closeSshSession, closeAllSessions
  } = useApp();

  // Küçültme: panel yalnızca sekme çubuğuna iner, arka plan görünür olur.
  // Gövde DOM'da kalır (transform ile aşağı kaydırılır) — böylece SSH bağlantısı kopmaz.
  const [minimized, setMinimized] = useState(false);

  const startResizing = useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    const onMouseMove = (e) => {
      const newHeight = window.innerHeight - e.clientY;
      if (newHeight > 100 && newHeight < window.innerHeight * 0.8) setTerminalHeight(newHeight);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = 'default';
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = 'row-resize';
  }, [setTerminalHeight]);

  if (sshSessions.length === 0) return null;

  return (
    <div style={{
      height: terminalHeight, background: '#020617', borderTop: '1px solid var(--primary)',
      position: 'absolute', bottom: 0, width: '100%', zIndex: 2000,
      boxShadow: '0 -10px 40px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column',
      // Küçültüldüğünde gövdeyi ekran altına kaydır; yalnızca sekme çubuğu kalır.
      transform: minimized ? `translateY(${terminalHeight - TAB_BAR_HEIGHT}px)` : 'translateY(0)',
      transition: 'transform 0.2s ease'
    }}>
      {!minimized && (
        <div onMouseDown={startResizing} style={{ width: '100%', height: '6px', cursor: 'row-resize', background: 'transparent', position: 'absolute', top: -3, zIndex: 2001 }} />
      )}
      <div style={{ background: '#1e293b', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-color)', overflowX: 'auto', height: 40, flexShrink: 0 }}>
        {sshSessions.map(session => (
          <div key={session.id} onClick={() => { setActiveSshTabId(session.id); if (minimized) setMinimized(false); }}
            style={{
              padding: '0 16px', height: '100%', borderRight: '1px solid var(--border-color)',
              cursor: 'pointer', background: activeSshTabId === session.id ? 'var(--primary)' : 'transparent',
              color: activeSshTabId === session.id ? '#0f172a' : 'var(--text-muted)',
              fontWeight: activeSshTabId === session.id ? '600' : '400',
              display: 'flex', alignItems: 'center', gap: 8, minWidth: 120, justifyContent: 'space-between', transition: 'all 0.2s'
            }}>
            <span style={{ fontSize: 13 }}>
              {session.name}
            </span>
            <span onClick={(e) => { e.stopPropagation(); closeSshSession(session.id); }}
              style={{ fontSize: '1.2rem', lineHeight: 0.5, opacity: 0.6, cursor: 'pointer', fontWeight: 700 }}>&times;</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px' }}>
          <button onClick={() => setMinimized(m => !m)} className="btn btn-ghost btn-sm"
            title={minimized ? t('restore') : t('minimize')}
            style={{ color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1, padding: '4px 10px', fontWeight: 700 }}>
            {minimized ? '▴' : '▁'}
          </button>
          <button onClick={closeAllSessions} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', fontSize: '0.75rem', padding: '4px 8px' }}>{t('closeAll')}</button>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#000' }}>
        {sshSessions.map(session => (
          <div key={session.id} style={{ display: activeSshTabId === session.id ? 'block' : 'none', height: '100%', width: '100%' }}>
            <TerminalPane switchId={session.deviceId || session.id} switchName={session.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
