/* ==========================================================================
   ActionMenu — TEK menu govdesi, iki sunum (fare: yuzen popup, dokunmatik: alt sayfa).

   Once TopologyPage.jsx icinde "TopoMenu" olarak duruyordu. Devices sayfasindaki
   satir menusu de ayni davranisi istedigi icin buraya tasindi: iki sayfa ayni
   bileseni kullanir, biri duzeltilince digeri de duzelir.

   React 19: bilesen govdesi ICINDE bilesen tanimlanmaz (her render remount eder).
   Bu yuzden bilesen ve tum stil sabitleri modul kapsaminda durur.
   ========================================================================== */

// --- Alt sayfa (bottom sheet) sunumu ---
const SHEET_BACKDROP = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10004 };
const SHEET_BOX = {
  position: 'fixed', left: 0, right: 0, bottom: 0, top: 'auto',
  width: '100%', minWidth: 0, maxWidth: '100%',
  padding: 0, paddingBottom: 'calc(6px + env(safe-area-inset-bottom))',
  borderRadius: '18px 18px 0 0', borderBottom: 'none',
  overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
  // iOS'ta tam genislikte backdrop-filter her kaydirma karesinde repaint eder
  backdropFilter: 'none', WebkitBackdropFilter: 'none',
  zIndex: 10005,
};
const SHEET_HEAD = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
  position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 1,
};
const SHEET_TITLE = {
  fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)',
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const SHEET_CLOSE = {
  minWidth: 44, minHeight: 44, background: 'none', border: 'none', color: 'var(--text-muted)',
  fontSize: '1.4rem', lineHeight: 1, cursor: 'pointer', borderRadius: 8, touchAction: 'manipulation',
};
const SHEET_ROW = { minHeight: 48, padding: '0 16px', fontSize: '0.95rem', gap: 12, whiteSpace: 'normal', borderRadius: 0 };
const POPUP_TITLE = { padding: '4px 10px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 };

/**
 * TopoMenu - TEK menu govdesi, iki sunum.
 *   sheet=false -> ekran icine kirpilmis yuzen popup (fare)
 *   sheet=true  -> alt sayfa: tam genislik, 48px satirlar, guvenli alan dolgusu
 *
 * Menu DURUM nesneleri (menu/edgeMenu/tabMenu/selMenu) aynen kalir; yalnizca sunum
 * degisir - menu mantigi catallanmaz. .context-menu sinifi iki modda da korunur ki
 * disari-tiklama koruyucusu (.closest('.context-menu')) ve responsive.css calissin.
 *
 * @param {Object}  props
 * @param {boolean} props.sheet  alt sayfa sunumu mu
 * @param {boolean} props.short  kisa ekran (yatay telefon) - sayfa daha yuksek olabilir
 * @param {{key:string,label:any,onClick:Function,danger?:boolean,style?:Object}[]} props.items
 */
export function ActionMenu({ sheet, short, top, left, zIndex, title, popupTitle, items, onClose }) {
  const rows = (items || []).filter(Boolean);
  if (rows.length === 0) return null;

  if (!sheet) {
    return (
      <div className="context-menu" style={{ top, left, zIndex }}
        onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
        {popupTitle ? <div style={POPUP_TITLE}>{popupTitle}</div> : null}
        {rows.map(it => (
          <div key={it.key} className="context-menu-item"
            style={{ ...(it.style || null), ...(it.danger ? { color: 'var(--danger)' } : null) }}
            onClick={it.onClick}>{it.label}</div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div style={SHEET_BACKDROP} onClick={onClose} />
      <div className="context-menu" style={{ ...SHEET_BOX, maxHeight: short ? '88vh' : '70vh' }}
        onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
        <div style={SHEET_HEAD}>
          <span style={SHEET_TITLE}>{title || 'Actions'}</span>
          <button type="button" style={SHEET_CLOSE} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        {rows.map(it => (
          <div key={it.key} className="context-menu-item"
            style={{ ...SHEET_ROW, ...(it.danger ? { color: 'var(--danger)' } : null) }}
            onClick={it.onClick}>{it.label}</div>
        ))}
      </div>
    </>
  );
}
