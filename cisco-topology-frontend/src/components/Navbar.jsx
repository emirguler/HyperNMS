import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import SettingsModal from './SettingsModal';

export default function Navbar({ onAddDevice }) {
  const { logout, isAdmin, username } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const [showSettings, setShowSettings] = useState(false);

  const navItems = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Devices', path: '/devices' },
  ];

  return (
    <>
      <header className="nav-header" onClick={e => e.stopPropagation()}>
        {/* Left — Brand + Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, var(--primary), #6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1rem', color: '#fff', fontWeight: 700
            }}>N</div>
            <span style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-main)' }}>NetPulse</span>
          </div>

          <div style={{ width: 1, height: 24, background: 'var(--border-color)', margin: '0 4px' }} />

          <nav className="nav-menu">
            {navItems.map(item => (
              <button
                key={item.path}
                className={`nav-btn ${path === item.path ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >{item.label}</button>
            ))}

            <div className="dropdown">
              <button className={`nav-btn ${path.startsWith('/topology') || path === '/geomap' ? 'active' : ''}`}>
                Maps ▾
              </button>
              <div className="dropdown-content">
                <a className="dropdown-item" onClick={() => navigate('/topology')}>Topology Map</a>
                <a className="dropdown-item" onClick={() => navigate('/geomap')}>Geographic Map</a>
              </div>
            </div>

            {isAdmin && (
              <button className={`nav-btn ${path === '/audit' ? 'active' : ''}`} onClick={() => navigate('/audit')}>
                Audit Log
              </button>
            )}

            {isAdmin && (path === '/devices' || path.startsWith('/topology')) && onAddDevice && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={onAddDevice}>
                + Add Device
              </button>
            )}
          </nav>
        </div>

        {/* Right — Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <NotificationBell />

          {isAdmin && (
            <button className={`nav-btn ${path === '/users' ? 'active' : ''}`} onClick={() => navigate('/users')} title="User Management">
              Users
            </button>
          )}

          {isAdmin && (
            <button className="nav-btn" onClick={() => setShowSettings(true)} title="Settings" style={{ fontSize: '0.95rem' }}>
              ⚙
            </button>
          )}

          <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 4px' }} />

          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: 4 }}>{username}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login'); }}
            style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Sign Out
          </button>
        </div>
      </header>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
