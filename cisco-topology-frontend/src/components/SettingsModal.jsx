import { useState } from 'react';
import AdSettingsCard from './AdSettingsCard';
import TwoFactorCard from './TwoFactorCard';
import BackupRestorePanel from './BackupRestorePanel';
import GeneralSettingsCard from './GeneralSettingsCard';
import { useViewport } from '../hooks/useViewport';
import { useAuth } from '../context/AuthContext';

// Ayarlar hub'i: ikonlu kartlar. Bir karta tiklayinca ilgili ayar popup'i acilir.
// 'security' (2FA) yalnizca yerlesik "admin" superkullanicisina gorunur —
// 2FA'yi yalnizca admin yonetir; diger adminler icin gizlenir (adminOnly).
const TILES = [
  { id: 'general', icon: '🎛️', title: 'General', desc: 'Device-wide display & behavior' },
  { id: 'backup', icon: '📦', title: 'Backup & Restore', desc: 'Export or import the full configuration' },
  { id: 'ad', icon: '🪪', title: 'Active Directory', desc: 'LDAP sign-in for AD users' },
  { id: 'security', icon: '🔐', title: 'Two-Factor Auth', desc: 'TOTP codes for sign-in', adminOnly: true },
];

// Kart (masaustu) ve satir (dar govde) gorunumleri. Modul seviyesinde:
// bilesen govdesinde tanimlanirsa her render'da yeniden monte olur.
function SettingsTile({ tile, compact, onOpen }) {
  if (compact) {
    // Dar govde: 64px'lik dokunulabilir liste satiri (ikon | baslik+aciklama | chevron)
    return (
      <button className="settings-tile" onClick={onOpen}
        style={{
          textAlign: 'left', cursor: 'pointer', background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--border-color)', borderRadius: 12, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, width: '100%',
          color: 'inherit', boxSizing: 'border-box',
        }}>
        <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>{tile.icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>{tile.title}</span>
          <span className="rw-truncate" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{tile.desc}</span>
        </span>
        <span aria-hidden="true" style={{ fontSize: '1.1rem', color: 'var(--text-dim)', flexShrink: 0 }}>›</span>
      </button>
    );
  }
  return (
    <button className="settings-tile" onClick={onOpen}
      style={{ textAlign: 'left', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 8, color: 'inherit' }}>
      <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>{tile.icon}</span>
      <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>{tile.title}</span>
      <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{tile.desc}</span>
    </button>
  );
}

export default function SettingsModal({ onClose }) {
  const [panel, setPanel] = useState(null); // null | 'general' | 'backup' | 'ad' | 'security'
  const { username } = useAuth();
  const isSuperAdmin = username === 'admin';
  // adminOnly kartlar yalnizca "admin"e gorunur
  const tiles = TILES.filter(tl => !tl.adminOnly || isSuperAdmin);
  const meta = tiles.find(t => t.id === panel);
  // "dar govde" = telefon VEYA kisa ekran; responsive.css'teki
  // (max-width:768px),(max-height:500px) sorgusuyla birebir ayni.
  const { isPhone, isShort } = useViewport();
  const compact = isPhone || isShort;
  // Dar govdede hub ile panel AYNI ANDA acik olmaz: iki ust uste overlay yerine
  // tek katman + geri (←) kontrolu. Masaustunde eski davranis aynen korunur.
  const showHub = !compact || !panel;
  // Yatay telefon genis ama kisa: 3 satir yan yana sigar, dikeyde tek kolon.
  const tileGridCols = compact
    ? (isShort && !isPhone ? 'repeat(auto-fit, minmax(200px, 1fr))' : '1fr')
    : '1fr 1fr';

  return (
    <>
      {/* HUB — kart izgarasi */}
      {showHub && (
        <div className="modal-overlay" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
          {/* maxHeight/overflow BILEREK inline degil: dar govdede responsive.css
              zaten !important ile veriyor, masaustunde ise hicbir sey degismemeli. */}
          <div className={compact ? 'modal-content rw-sheet' : 'modal-content'} style={{ width: 540 }} onClick={e => e.stopPropagation()}>
            <div className={compact ? 'rw-sheet-head' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 0 : 22 }}>
              <h2 style={{ margin: 0, fontSize: compact ? '1rem' : '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>Settings</h2>
              {/* rw-tap SADECE (pointer:coarse) altinda calisir -> masaustunde etkisiz,
                  compact olmayan dokunmatik tablette 44x44 hedef verir. */}
              <button onClick={onClose} className={compact ? 'rw-sheet-close' : 'rw-tap'} aria-label="Close"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>

            <div className={compact ? 'rw-sheet-body' : undefined}>
              <div style={{ display: 'grid', gridTemplateColumns: tileGridCols, gap: compact ? 10 : 14 }}>
                {tiles.map(tile => (
                  <SettingsTile key={tile.id} tile={tile} compact={compact} onOpen={() => setPanel(tile.id)} />
                ))}
              </div>
            </div>

            <div className={compact ? 'rw-sheet-foot' : undefined} style={{ textAlign: 'right', marginTop: compact ? 0 : 20 }}>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* PANEL POPUP — secilen ayar. Masaustunde hub'in uzerinde, dar govdede
          hub'in YERINE acilir (tek overlay, tek backdrop-filter). */}
      {panel && (
        <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={() => setPanel(null)} onKeyDown={e => { if (e.key === 'Escape') setPanel(null); }}>
          <div className={compact ? 'modal-content rw-sheet' : 'modal-content'} style={{ width: 560, maxHeight: '88dvh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className={compact ? 'rw-sheet-head' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 0 : 20, gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <button className="btn btn-ghost btn-sm rw-tap" onClick={() => setPanel(null)}
                  title="Back" aria-label="Back to Settings"
                  style={{ padding: compact ? undefined : '4px 10px', fontSize: '1rem', lineHeight: 1, flexShrink: 0 }}>←</button>
                <h2 style={{ margin: 0, minWidth: 0, fontSize: compact ? '1rem' : '1.15rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ marginRight: 8 }}>{meta.icon}</span>{meta.title}
                </h2>
              </div>
              {/* Dar govdede hub kapali oldugu icin × tum Ayarlar'i kapatir; ← geri goturur. */}
              <button onClick={() => (compact ? onClose() : setPanel(null))} className={compact ? 'rw-sheet-close' : 'rw-tap'} aria-label="Close settings"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>

            <div className={compact ? 'rw-sheet-body' : undefined}>
              {panel === 'general' && <GeneralSettingsCard embedded />}
              {panel === 'backup' && <BackupRestorePanel />}
              {panel === 'ad' && <AdSettingsCard embedded />}
              {panel === 'security' && isSuperAdmin && <TwoFactorCard />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
