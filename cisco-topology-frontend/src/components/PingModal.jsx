import { useState, useRef } from 'react';
import { useViewport } from '../hooks/useViewport';
import PingIcon from './PingIcon';
import PingPanel from './PingPanel';
import { t } from '../i18n';

// Ping popup'i. Serbest-IP modunda (anasayfa Ping butonu) sag ustteki + ile yan yana
// birden fazla ping paneli acilir → ayni anda birden cok IP'ye ping. Cihaz bazli
// (lockIp) modda tek panel gosterilir, + yoktur.
// ip: baslangic IP'si; lockIp: true ise IP kilitli (cihaz bazli ping).
export default function PingModal({ ip: initialIp = '', lockIp = false, onClose }) {
  const { isPhone, isShort } = useViewport();
  const sheet = isPhone || isShort;
  const multi = !lockIp; // coklu ping yalnizca serbest-IP modunda

  const [panels, setPanels] = useState([{ id: 0, ip: initialIp, autoStart: lockIp }]);
  const nextId = useRef(1);

  const addPanel = () => setPanels(p => [...p, { id: nextId.current++, ip: '', autoStart: false }]);
  const removePanel = (id) => setPanels(p => (p.length > 1 ? p.filter(x => x.id !== id) : p));

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" onClick={e => e.stopPropagation()}
        style={{ width: sheet ? 'min(440px, 94vw)' : `min(${panels.length * 332 + 64}px, 94vw)`, maxWidth: '94vw', maxHeight: '88dvh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        {/* Baslik + (coklu ise) ekle butonu + kapat */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: sheet ? '1rem' : '1.2rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <PingIcon size={20} /> {t('pingTool')}{multi && panels.length > 1 ? ` (${panels.length})` : ''}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {multi && (
              <button onClick={addPanel} className="btn btn-ghost btn-sm rw-tap" title="Add another ping" aria-label="Add another ping"
                style={{ fontSize: '1.2rem', lineHeight: 1, padding: sheet ? '6px 12px' : '4px 12px' }}>+</button>
            )}
            <button onClick={onClose} className="rw-tap" aria-label="Close"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
          </div>
        </div>

        {/* Paneller: masaustunde yan yana (yatay kaydirma), mobilde alt alta (dikey kaydirma). */}
        <div style={{
          display: 'flex', flexDirection: sheet ? 'column' : 'row', gap: 12,
          overflowX: sheet ? 'visible' : 'auto', paddingBottom: 2, minHeight: 0,
        }}>
          {panels.map(p => (
            <PingPanel key={p.id} initialIp={p.ip} lockIp={lockIp} autoStart={p.autoStart}
              onRemove={panels.length > 1 ? () => removePanel(p.id) : null} />
          ))}
        </div>
      </div>
    </div>
  );
}
