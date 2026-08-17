import { useCallback, useState, useEffect } from 'react';
import TerminalPane from '../TerminalPane';
import { useApp } from '../context/AppContext';
import { useViewport } from '../hooks/useViewport';
import { useLongPress } from '../hooks/useLongPress';
import { t } from '../i18n';

const TAB_BAR_HEIGHT = 30;        // masaustu sekme seridi
const TAB_BAR_HEIGHT_TOUCH = 44;  // dokunmatikte minimum dokunma hedefi

// Menu kutusunun tahmini olculeri — ekran disina tasmayi engelleyen kelepceleme icin.
const MENU_W = 180;
const MENU_H = 110;

// Uzun basma prop'lari BAGLANMADIGINDA yayilan sabit nesne (her render'da yenisi uretilmesin).
const NO_PRESS_PROPS = Object.freeze({});

/**
 * Tek bir SSH sekmesi.
 * MODUL SEVIYESINDE tanimli: uzun basma hook'u gerektirdigi icin ayri bir bilesen olmali
 * ve TerminalPanel'in govdesinde tanimlanirsa her render'da remount olur (SSH kopar).
 */
function SshTab({ session, isActive, status, touchMode, tabMinWidth, tabHeight, onSelect, onClose, onMenu }) {
  // Dokunmatikte sag tik yok; 500ms basili tutmak ayni menuyu acar.
  const bind = useLongPress((e) => onMenu(session.id, e.clientX, e.clientY));
  // ...ama YALNIZCA dokunmatikte baglanir: farede 500ms'lik yavas bir sol tik da
  // menuyu aciyor, ustelik hook'un onClickCapture'i tiki yuttugu icin sekme secilmiyordu.
  const pressProps = touchMode ? bind : NO_PRESS_PROPS;

  const handleContextMenu = (e) => {
    bind.onContextMenu(e); // dokunmatikte iOS metin balonunu bastirir
    e.preventDefault();
    e.stopPropagation();
    onMenu(session.id, e.clientX, e.clientY);
  };

  const dot = (
    <span
      title={status === false ? 'Disconnected' : status === true ? 'Connected' : 'Connecting…'}
      style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: status === false ? 'var(--danger)' : status === true ? '#34d399' : 'var(--text-muted)'
      }}
    />
  );

  return (
    <div
      {...pressProps}
      onClick={() => onSelect(session.id)}
      onContextMenu={handleContextMenu}
      title={touchMode ? undefined : 'Sağ tık: Reconnect / Close'}
      style={{
        padding: touchMode ? '0 8px' : '0 16px', height: '100%',
        borderRight: '1px solid var(--border-color)',
        cursor: 'pointer', background: isActive ? 'var(--primary)' : 'transparent',
        color: isActive ? '#0f172a' : 'var(--text-muted)',
        fontWeight: isActive ? '600' : '400',
        display: 'flex', alignItems: 'center', gap: 8, minWidth: tabMinWidth,
        justifyContent: 'space-between', transition: 'all 0.2s',
        // Uzun basma hedefi: iOS'un secim balonunu / suruk onizlemesini kes.
        ...(touchMode ? { touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } : null)
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: touchMode ? 14 : 13, minWidth: 0 }}>
        {dot}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.name}</span>
      </span>

      {/* Dokunmatikte gorunur menu dugmesi — uzun basma tek basina kesfedilemez. */}
      {touchMode && (
        <button
          type="button"
          aria-label="Session menu"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(session.id, r.left, r.bottom);
          }}
          style={{
            background: 'none', border: 'none', padding: 0, color: 'inherit', fontFamily: 'inherit',
            fontSize: '1.05rem', lineHeight: 1, opacity: 0.75, cursor: 'pointer',
            minWidth: 34, height: tabHeight, display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          ⋮
        </button>
      )}

      <button
        type="button"
        aria-label="Close session"
        onClick={(e) => { e.stopPropagation(); onClose(session.id); }}
        style={touchMode
          ? {
              background: 'none', border: 'none', padding: 0, color: 'inherit', fontFamily: 'inherit',
              fontSize: '1.3rem', lineHeight: 1, opacity: 0.7, cursor: 'pointer', fontWeight: 700,
              minWidth: 40, height: tabHeight, display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 -8px 0 0'
            }
          : {
              background: 'none', border: 'none', padding: 0, color: 'inherit', fontFamily: 'inherit',
              fontSize: '1.2rem', lineHeight: 0.5, opacity: 0.6, cursor: 'pointer', fontWeight: 700
            }}
      >
        &times;
      </button>
    </div>
  );
}

export default function TerminalPanel() {
  const {
    sshSessions, activeSshTabId, setActiveSshTabId,
    terminalHeight, setTerminalHeight,
    closeSshSession, closeAllSessions, reconnectSshSession
  } = useApp();

  const { isPhone, isShort, isTouch } = useViewport();
  // Telefon VEYA kisa ekran: dock yerine tam ekran sayfa. Tablet/masaustu dock'ta kalir.
  const fullScreen = isPhone || isShort;
  const touchMode = isTouch || fullScreen;
  const tabHeight = touchMode ? TAB_BAR_HEIGHT_TOUCH : TAB_BAR_HEIGHT;
  // Kucultme/kapat kontrolleri sekme seridiyle birlikte KAYMAMALI (375px'te ekran disi kaliyordu).
  const pinControls = touchMode;

  const [connStatus, setConnStatus] = useState({}); // sessionId -> bağlı mı (true/false/undefined)
  const [tabMenu, setTabMenu] = useState(null);      // sekme menüsü { id, left, bottom }
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [kbInset, setKbInset] = useState(0);         // yazılım klavyesinin yediği alt boşluk

  // Menüyü dış tıklama / Escape ile kapat.
  // pointerdown: fare + kalem + dokunmayı tek olayda kapsar ('mousedown' dokunmada güvenilmez).
  useEffect(() => {
    if (!tabMenu) return;
    const onDown = (e) => { if (!e.target.closest('.ssh-tab-menu')) setTabMenu(null); };
    const onEsc = (e) => { if (e.key === 'Escape') setTabMenu(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [tabMenu]);

  // "Close All" dokunmatikte tek dokunuşla tüm oturumları kapatıyordu; iki adıma böl.
  useEffect(() => {
    if (!confirmCloseAll) return;
    const id = setTimeout(() => setConfirmCloseAll(false), 3000);
    return () => clearTimeout(id);
  }, [confirmCloseAll]);

  // Yazılım klavyesi açılınca visualViewport küçülür ama layout viewport küçülmez;
  // tam ekran modda paneli klavyenin üstüne çek, yoksa terminal klavyenin altında kalır.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const inset = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      // 80px eşiği: URL bar gizlenip görünmesi klavye sanılmasın.
      setKbInset(inset > 80 ? inset : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);

  // Küçültme: panel yalnızca sekme çubuğuna iner, arka plan görünür olur.
  // Gövde DOM'da kalır (transform ile aşağı kaydırılır) — böylece SSH bağlantısı kopmaz.
  const [minimized, setMinimized] = useState(false);

  // Pointer olayları: fare + dokunma + kalem tek yolda. Eskiden yalnızca mousedown vardı,
  // bu yüzden tablette dock yüksekliği hiç değiştirilemiyordu.
  const startResizing = useCallback((downEvent) => {
    downEvent.preventDefault();
    const handle = downEvent.currentTarget;
    try { handle.setPointerCapture(downEvent.pointerId); } catch (e) { /* ignore */ }
    const onMove = (e) => {
      const newHeight = window.innerHeight - e.clientY;
      if (newHeight > 100 && newHeight < window.innerHeight * 0.8) setTerminalHeight(newHeight);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = 'default';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.body.style.cursor = 'row-resize';
  }, [setTerminalHeight]);

  // Menüyü her iki eksende de ekran içine kelepçele (yatayda 375px'in sağ kenarı,
  // dikeyde kısa ekranda menünün ekranın üstüne taşması).
  const openTabMenu = useCallback((id, x, y) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(x, vw - MENU_W - 8));
    const bottom = Math.max(8, Math.min(vh - y, Math.max(8, vh - MENU_H - 8)));
    setTabMenu({ id, left, bottom });
  }, []);

  const handleSelect = useCallback((id) => {
    setActiveSshTabId(id);
    setMinimized(false);
  }, [setActiveSshTabId]);

  if (sshSessions.length === 0) return null;

  const menuSession = tabMenu ? sshSessions.find(s => s.id === tabMenu.id) : null;
  const activeDown = activeSshTabId != null && connStatus[activeSshTabId] === false;
  // Tam ekranda çentik/durum çubuğu şeridi yiyor; sekme çubuğuna güvenli alan payı ver.
  const safeTop = fullScreen ? 'env(safe-area-inset-top)' : '0px';

  const rootStyle = fullScreen
    ? {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: kbInset,
        background: '#020617',
        // .nav-header ile ayni katman ama DOM'da sonra geldigi icin ustte cizilir;
        // .modal-overlay (mobilde 10001) ise terminalin USTUNDE kalir - istenen sira.
        zIndex: 10000,
        boxShadow: '0 -10px 40px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column',
        boxSizing: 'border-box',
        transform: minimized ? `translateY(calc(100% - ${tabHeight}px - ${safeTop}))` : 'translateY(0)',
        transition: 'transform 0.2s ease'
      }
    : {
        height: terminalHeight, background: '#020617', borderTop: '1px solid var(--primary)',
        position: 'absolute', bottom: 0, width: '100%', zIndex: 2000,
        boxShadow: '0 -10px 40px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column',
        transform: minimized ? `translateY(${terminalHeight - tabHeight}px)` : 'translateY(0)',
        transition: 'transform 0.2s ease'
      };

  return (
    <div className="terminal-panel" style={rootStyle}>
      {/* Tam ekran modda dock yok -> yeniden boyutlandirma kolu da yok. */}
      {!minimized && !fullScreen && (
        <div
          onPointerDown={startResizing}
          style={{
            width: '100%', height: touchMode ? 20 : 6, cursor: 'row-resize', background: 'transparent',
            position: 'absolute', top: touchMode ? -10 : -3, zIndex: 2001,
            touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          {/* Dokunmatikte 6px seffaf serit gorunmez bir hedefti; gorunur bir tutamak koy. */}
          {touchMode && <span style={{ width: 46, height: 4, borderRadius: 2, background: 'var(--primary)', opacity: 0.7 }} />}
        </div>
      )}

      <div style={{
        background: '#1e293b', display: 'flex', alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        overflowX: pinControls ? 'hidden' : 'auto',
        height: fullScreen ? `calc(${tabHeight}px + ${safeTop})` : tabHeight,
        paddingTop: fullScreen ? safeTop : 0,
        paddingLeft: fullScreen ? 'env(safe-area-inset-left)' : 0,
        paddingRight: fullScreen ? 'env(safe-area-inset-right)' : 0,
        boxSizing: 'border-box', flexShrink: 0
      }}>
        {/* Sekmeler kendi seridinde kayar; sagdaki kontroller kaymaz. */}
        <div
          className={pinControls ? 'rw-scroll-x' : undefined}
          style={{
            display: 'flex', alignItems: 'stretch', alignSelf: 'stretch', minWidth: 0,
            // Masaustunde '0 1 auto': sekmeler eskisi gibi once kendi minWidth:120'sine
            // kadar daralip ucnokta alir, ancak ondan sonra serit yatay kayar.
            flex: pinControls ? '1 1 auto' : '0 1 auto',
            overflowX: pinControls ? 'auto' : 'visible'
          }}
        >
          {sshSessions.map(session => (
            <SshTab
              key={session.id}
              session={session}
              isActive={activeSshTabId === session.id}
              status={connStatus[session.id]}
              touchMode={touchMode}
              tabMinWidth={touchMode ? 84 : 120}
              tabHeight={tabHeight}
              onSelect={handleSelect}
              onClose={closeSshSession}
              onMenu={openTabMenu}
            />
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', flexShrink: 0 }}>
          {/* Kopan oturum icin dokunmatikte gorunur kurtarma yolu (sag tik yok). */}
          {touchMode && activeDown && (
            <button onClick={() => reconnectSshSession(activeSshTabId)} className="btn btn-ghost btn-sm"
              style={{ color: 'var(--primary)', fontSize: '0.75rem', padding: '4px 10px', border: '1px solid var(--primary)' }}>
              Reconnect
            </button>
          )}
          <button onClick={() => setMinimized(m => !m)} className="btn btn-ghost btn-sm"
            title={minimized ? t('restore') : t('minimize')}
            style={{ color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1, padding: '4px 10px', fontWeight: 700 }}>
            {minimized ? '▴' : '▁'}
          </button>
          <button
            onClick={() => {
              if (touchMode && !confirmCloseAll) { setConfirmCloseAll(true); return; }
              setConfirmCloseAll(false);
              closeAllSessions();
            }}
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--danger)', fontSize: '0.75rem', padding: '4px 8px', whiteSpace: 'nowrap' }}
          >
            {confirmCloseAll ? 'Sure?' : t('closeAll')}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#000', minHeight: 0 }}>
        {sshSessions.map(session => (
          <div key={session.id} style={{ display: activeSshTabId === session.id ? 'block' : 'none', height: '100%', width: '100%' }}>
            <TerminalPane
              key={session.reconnectNonce || 0}
              switchId={session.deviceId || session.id}
              switchName={session.name}
              active={activeSshTabId === session.id}
              minimized={minimized}
              onStatus={(ok) => setConnStatus(prev => (prev[session.id] === ok ? prev : { ...prev, [session.id]: ok }))}
            />
          </div>
        ))}
      </div>

      {tabMenu && (
        <>
          {/* Dokunmatikte menunun arkasinda kapatma yuzeyi — panelin backdrop'u yok. */}
          {touchMode && (
            <div
              onPointerDown={() => setTabMenu(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 10004, background: 'rgba(0,0,0,0.35)' }}
            />
          )}
          <div
            className="context-menu ssh-tab-menu"
            style={touchMode
              ? {
                  position: 'fixed', left: 8, right: 8, bottom: 'calc(8px + env(safe-area-inset-bottom))',
                  zIndex: 10005, minWidth: 0
                }
              : { position: 'fixed', left: tabMenu.left, bottom: tabMenu.bottom, zIndex: 3000 }}
            onClick={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
          >
            {touchMode && menuSession && (
              <div style={{
                padding: '10px 14px', fontSize: '0.8rem', color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border-color)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {menuSession.name}
              </div>
            )}
            <div className="context-menu-item" onClick={() => { reconnectSshSession(tabMenu.id); setTabMenu(null); }}>🔄 Reconnect</div>
            <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={() => { closeSshSession(tabMenu.id); setTabMenu(null); }}>✕ Close</div>
          </div>
        </>
      )}
    </div>
  );
}
