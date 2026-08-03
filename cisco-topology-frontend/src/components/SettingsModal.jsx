import { useState } from 'react';
import AdSettingsCard from './AdSettingsCard';
import BackupRestorePanel from './BackupRestorePanel';

// Ayarlar hub'i: ikonlu kartlar. Bir karta tiklayinca ilgili ayar popup'i acilir.
const TILES = [
  { id: 'backup', icon: '📦', title: 'Backup & Restore', desc: 'Export or import the full configuration' },
  { id: 'ad', icon: '🪪', title: 'Active Directory', desc: 'LDAP sign-in for AD users' },
];

export default function SettingsModal({ onClose }) {
  const [panel, setPanel] = useState(null); // null | 'backup' | 'ad'
  const meta = TILES.find(t => t.id === panel);

  return (
    <>
      {/* HUB — kart izgarasi */}
      <div className="modal-overlay" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal-content" style={{ width: 540 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>Settings</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {TILES.map(t => (
              <button key={t.id} className="settings-tile" onClick={() => setPanel(t.id)}
                style={{ textAlign: 'left', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 8, color: 'inherit' }}>
                <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>{t.icon}</span>
                <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>{t.title}</span>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{t.desc}</span>
              </button>
            ))}
          </div>

          <div style={{ textAlign: 'right', marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {/* PANEL POPUP — secilen ayar (hub'in uzerinde acilir) */}
      {panel && (
        <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={() => setPanel(null)} onKeyDown={e => { if (e.key === 'Escape') setPanel(null); }}>
          <div className="modal-content" style={{ width: 560, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setPanel(null)} title="Back" style={{ padding: '4px 10px', fontSize: '1rem', lineHeight: 1 }}>←</button>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ marginRight: 8 }}>{meta.icon}</span>{meta.title}
                </h2>
              </div>
              <button onClick={() => setPanel(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>

            {panel === 'backup' && <BackupRestorePanel />}
            {panel === 'ad' && <AdSettingsCard embedded />}
          </div>
        </div>
      )}
    </>
  );
}
