import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import NotificationBell from './NotificationBell';
import SettingsModal from './SettingsModal';
import PingModal from './PingModal';
import PingIcon from './PingIcon';
import TraceModal from './TraceModal';
import TraceIcon from './TraceIcon';
import SettingsIcon from './SettingsIcon';

// Marka artik <div onClick> degil gercek bir <button>: klavye ve ekran okuyucu
// erisimi icin. font:'inherit' tarayici varsayilanlarini eski div ile birebir
// ayni hale getirir, boylece masaustu gorunumu degismez.
const brandButtonStyle = {
  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
  background: 'none', border: 'none', padding: 0, margin: 0,
  font: 'inherit', color: 'inherit', WebkitAppearance: 'none', minWidth: 0
};

// Cekmece basligi (sadece hamburger modunda cizilir).
const drawerHeadStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, padding: '0 4px 6px', marginBottom: 4,
  borderBottom: '1px solid var(--border-color)'
};

const drawerTitleStyle = {
  fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.6px',
  textTransform: 'uppercase', color: 'var(--text-dim)'
};

// Cekmece arka plani: header'in ONUNDE bir kardes olarak cizilir, boylece
// header (z-index 10000) ve panel onun ustunde kalir.
const backdropStyle = {
  position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.55)',
  zIndex: 9998, touchAction: 'none'
};

export default function Navbar({ onAddDevice }) {
  const { logout, isAdmin, username } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const [showSettings, setShowSettings] = useState(false);
  const [showPing, setShowPing] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);

  const { isTablet, isShort, width, height } = useViewport();
  // responsive.css bolum 05 ile ayni esik: hamburger <=1024px VEYA <=500px yukseklikte.
  const drawerMode = isTablet || isShort;
  // 480px altinda Ping/Trace etiketleri dusuyor, butonlar 44x44 ikon oluyor.
  const iconOnly = width <= 480;
  const landscape = width > height;

  const go = (p) => { navigate(p); setMobileOpen(false); setMapsOpen(false); };
  const cls = (p) => `nav-btn ${path === p ? 'active' : ''}`;

  // Acik menu su durumlarda erisilemez hale gelir ve kapanmali:
  //   - rota degisti (yeni sayfaya gecildi)
  //   - kirilma noktasi asildi (hamburger gorunurlugu degisti)
  //   - cihaz dondu (dikey <-> yatay)
  // Effect yerine render sirasinda ayarlama: React'in "turev state'i sifirla"
  // kalibi; ekstra bir render dalgasi yaratmaz.
  const resetKey = `${path}|${isTablet}|${isShort}|${landscape}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    if (mobileOpen) setMobileOpen(false);
    if (mapsOpen) setMapsOpen(false);
  }

  // Cekmece aciksa: Escape kapatir, arkadaki sayfa kaymaz.
  useEffect(() => {
    if (!mobileOpen || !drawerMode) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen, drawerMode]);

  // Maps menusu dokunmatikte hover ile acilamiyor -> tik ile aciliyor.
  // Disari dokununca kapansin (pointerdown hem fare hem parmagi kapsar).
  useEffect(() => {
    if (!mapsOpen) return;
    const onDown = (e) => {
      const el = e.target;
      if (!el || typeof el.closest !== 'function' || !el.closest('.dropdown')) setMapsOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [mapsOpen]);

  return (
    <>
      {drawerMode && mobileOpen && (
        <div aria-hidden="true" onClick={() => setMobileOpen(false)} style={backdropStyle} />
      )}

      <header className="nav-header" onClick={e => e.stopPropagation()}>
        {/* Left — Brand + Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, minWidth: 0 }}>
          <button type="button" className="rw-tap" style={brandButtonStyle} onClick={() => go('/dashboard')} aria-label="NetPulse home">
            <img src="/app-icon.png" alt="" style={{ width: 26, height: 26, filter: 'drop-shadow(0 0 6px var(--primary))' }} />
            <span className="rw-truncate" style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-main)' }}>NetPulse</span>
          </button>

          <div style={{ width: 1, height: 24, background: 'var(--border-color)', margin: '0 4px' }} className="nav-desktop-right" />

          <nav className="nav-menu">
            <button className={cls('/dashboard')} onClick={() => go('/dashboard')}>Dashboard</button>
            <button className={cls('/devices')} onClick={() => go('/devices')}>Devices</button>

            <div className={`dropdown ${mapsOpen ? 'open' : ''}`}>
              <button
                className={`nav-btn ${path.startsWith('/topology') || path === '/geomap' ? 'active' : ''}`}
                onClick={() => setMapsOpen(o => !o)}
                aria-expanded={mapsOpen}
              >Maps ▾</button>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowPing(true)}
            title="Ping"
            aria-label="Ping"
            style={iconOnly ? { minWidth: 44 } : undefined}
          ><PingIcon size={16} />{!iconOnly && ' Ping'}</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowTrace(true)}
            title="Trace"
            aria-label="Trace"
            style={iconOnly ? { minWidth: 44 } : undefined}
          ><TraceIcon size={16} />{!iconOnly && ' Trace'}</button>
          <NotificationBell />

          <span className="nav-desktop-right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isAdmin && <button className={cls('/users')} onClick={() => go('/users')} title="User Management">Users</button>}
            {isAdmin && <button className="nav-btn" onClick={() => setShowSettings(true)} title="Settings" style={{ display: 'flex', alignItems: 'center', padding: '6px 10px' }}><SettingsIcon size={18} /></button>}
            <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 4px' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: 4 }}>{username}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login'); }} style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Sign Out</button>
          </span>

          <button
            className="nav-hamburger"
            onClick={() => setMobileOpen(o => !o)}
            aria-label={mobileOpen ? 'Close menu' : 'Menu'}
            aria-expanded={mobileOpen}
            aria-controls="nav-mobile-panel"
          >{mobileOpen ? '✕' : '☰'}</button>
        </div>

        {/* Mobile drawer */}
        <div id="nav-mobile-panel" className={`nav-mobile-panel ${mobileOpen ? 'open' : ''}`}>
          {drawerMode && (
            <div style={drawerHeadStyle}>
              <span style={drawerTitleStyle}>Menu</span>
              <button type="button" className="nav-hamburger" onClick={() => setMobileOpen(false)} aria-label="Close menu">✕</button>
            </div>
          )}
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
            <span className="rw-truncate" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{username}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login'); }} style={{ color: 'var(--danger)', flexShrink: 0 }}>Sign Out</button>
          </div>
        </div>
      </header>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showPing && <PingModal onClose={() => setShowPing(false)} />}
      {showTrace && <TraceModal onClose={() => setShowTrace(false)} />}
    </>
  );
}
