import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import SettingsModal from './SettingsModal';
import PingModal from './PingModal';
import PingIcon from './PingIcon';
import SettingsIcon from './SettingsIcon';

export default function Navbar({ onAddDevice }) {
  const { logout, isAdmin, username } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const [showSettings, setShowSettings] = useState(false);
  const [showPing, setShowPing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const go = (p) => { navigate(p); setMobileOpen(false); };
  const cls = (p) => `nav-btn ${path === p ? 'active' : ''}`;

  return (
    <>
      <header className="nav-header" onClick={e => e.stopPropagation()}>
        {/* Left — Brand + Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => go('/dashboard')}>
            <img src="/app-icon.png" alt="NetPulse" style={{ width: 26, height: 26, filter: 'drop-shadow(0 0 6px var(--primary))' }} />
            <span style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-main)' }}>NetPulse</span>
          </div>

          <div style={{ width: 1, height: 24, background: 'var(--border-color)', margin: '0 4px' }} className="nav-desktop-right" />

          <nav className="nav-menu">
            <button className={cls('/dashboard')} onClick={() => go('/dashboard')}>Dashboard</button>
            <button className={cls('/devices')} onClick={() => go('/devices')}>Devices</button>

            <div className="dropdown">
              <button className={`nav-btn ${path.startsWith('/topology') || path === '/geomap' ? 'active' : ''}`}>Maps ▾</button>
              <div className="dropdown-content">
                <a className="dropdown-item" onClick={() => go('/topology')}>Topology Map</a>
                <a className="dropdown-item" onClick={() => go('/geomap')}>Geographic Map</a>
              </div>
            </div>

            <button className={cls('/mac-search')} onClick={() => go('/mac-search')}>MAC Search</button>
            {isAdmin && <button className={cls('/command-line')} onClick={() => go('/command-line')}>Command-line</button>}
            {isAdmin && <button className={cls('/audit')} onClick={() => go('/audit')}>Audit Log</button>}

            {isAdmin && (path === '/devices' || path.startsWith('/topology')) && onAddDevice && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={onAddDevice}>+ Add Device</button>
            )}
          </nav>
        </div>

        {/* Right — bell always visible; details on desktop, hamburger on mobile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowPing(true)} title="Ping"><PingIcon size={16} /> Ping</button>
          <NotificationBell />

          <span className="nav-desktop-right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isAdmin && <button className={cls('/users')} onClick={() => go('/users')} title="User Management">Users</button>}
            {isAdmin && <button className="nav-btn" onClick={() => setShowSettings(true)} title="Settings" style={{ display: 'flex', alignItems: 'center', padding: '6px 10px' }}><SettingsIcon size={18} /></button>}
            <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 4px' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: 4 }}>{username}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login'); }} style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Sign Out</button>
          </span>

          <button className="nav-hamburger" onClick={() => setMobileOpen(o => !o)} aria-label="Menu">{mobileOpen ? '✕' : '☰'}</button>
        </div>

        {/* Mobile dropdown panel */}
        <div className={`nav-mobile-panel ${mobileOpen ? 'open' : ''}`}>
          <button className={cls('/dashboard')} onClick={() => go('/dashboard')}>Dashboard</button>
          <button className={cls('/devices')} onClick={() => go('/devices')}>Devices</button>
          <button className={cls('/topology')} onClick={() => go('/topology')}>Topology Map</button>
          <button className={cls('/geomap')} onClick={() => go('/geomap')}>Geographic Map</button>
          <button className={cls('/mac-search')} onClick={() => go('/mac-search')}>MAC Search</button>
          {isAdmin && <button className={cls('/command-line')} onClick={() => go('/command-line')}>Command-line</button>}
          {isAdmin && <button className={cls('/audit')} onClick={() => go('/audit')}>Audit Log</button>}
          {isAdmin && <button className={cls('/users')} onClick={() => go('/users')}>Users</button>}
          {isAdmin && (path === '/devices' || path.startsWith('/topology')) && onAddDevice && (
            <button className="btn btn-primary btn-sm" onClick={() => { onAddDevice(); setMobileOpen(false); }}>+ Add Device</button>
          )}
          {isAdmin && <button className="nav-btn" onClick={() => { setShowSettings(true); setMobileOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SettingsIcon size={16} /> Settings</button>}
          <div className="nav-mobile-user">
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{username}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login'); }} style={{ color: 'var(--danger)' }}>Sign Out</button>
          </div>
        </div>
      </header>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showPing && <PingModal onClose={() => setShowPing(false)} />}
    </>
  );
}
