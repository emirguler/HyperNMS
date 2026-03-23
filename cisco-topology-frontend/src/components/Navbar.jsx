import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import NotificationBell from './NotificationBell';
import SettingsModal from './SettingsModal';
import { t } from '../i18n';

export default function Navbar({ onAddDevice }) {
  const { logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <header className="nav-header" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '1.8rem', filter: 'drop-shadow(0 0 5px var(--primary))' }}>⚡</span>
          <div>
            <h3 style={{ margin: 0, lineHeight: 1 }}>NetPulse</h3>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '1px' }}>Keep the Pulse of Your Network</span>
          </div>
          <nav className="nav-menu" style={{ marginLeft: 40 }}>
            <button className={`nav-btn ${path === '/dashboard' ? 'active' : ''}`} onClick={() => navigate('/dashboard')}>Dashboard</button>
            <button className={`nav-btn ${path === '/devices' ? 'active' : ''}`} onClick={() => navigate('/devices')}>{t('devices')}</button>
            <div className="dropdown">
              <button className={`nav-btn ${path.startsWith('/topology') || path === '/geomap' ? 'active' : ''}`}>{t('maps')} ▼</button>
              <div className="dropdown-content">
                <a className="dropdown-item" onClick={() => navigate('/topology')}>🕸️ {t('topology')}</a>
                <a className="dropdown-item" onClick={() => navigate('/geomap')}>🌍 {t('geographic')}</a>
              </div>
            </div>
            {isAdmin && <button className={`nav-btn ${path === '/audit' ? 'active' : ''}`} onClick={() => navigate('/audit')}>Audit Log</button>}
            {isAdmin && (path === '/devices' || path.startsWith('/topology')) && onAddDevice && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 15 }} onClick={onAddDevice}>{t('addDevice')}</button>
            )}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NotificationBell />
          <button className="nav-btn" onClick={toggleTheme} title={t('changeTheme')} style={{ fontSize: '1.2rem' }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          {isAdmin && <button className={`nav-btn ${path === '/users' ? 'active' : ''}`} onClick={() => navigate('/users')}>👥 {t('users')}</button>}
          {isAdmin && <button className="nav-btn" onClick={() => setShowSettings(true)} title="Settings" style={{ fontSize: '1.1rem' }}>⚙️</button>}
          <button className="btn btn-danger btn-sm" onClick={() => { logout(); navigate('/login'); }}>{t('logout')}</button>
        </div>
      </header>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
