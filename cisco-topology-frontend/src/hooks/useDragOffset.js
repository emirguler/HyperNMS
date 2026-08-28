import { useRef, useState, useCallback } from 'react';

// Bir modal'i baslik cubugundan tutup surukleyebilmek icin kucuk yardimci.
// Modal .modal-overlay icinde flexbox ile ORTALANIR; biz sadece merkeze gore bir
// translate ofseti tutariz. pos=null iken hicbir transform yok → modal ortada kalir
// (ilk acilis gorunumu degismez). enabled=false iken (mobil/alt-sayfa) tamamen pasif.
export function useDragOffset(enabled) {
  const [pos, setPos] = useState(null); // { x, y } merkezden ofset (px) — null = dokunulmamis
  const drag = useRef(null);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    if (e.button != null && e.button !== 0) return;            // yalnizca sol tus
    // Buton/alan gibi etkilesimli bir ogeden baslamayi surukleme sayma — tik/odak calissin.
    if (e.target.closest && e.target.closest('button, input, textarea, select, a, label')) return;
    e.preventDefault();                                        // metin secimini engelle
    drag.current = { x: e.clientX, y: e.clientY, px: (pos && pos.x) || 0, py: (pos && pos.y) || 0 };
    const move = (ev) => {
      const d = drag.current;
      if (!d) return;
      setPos({ x: d.px + (ev.clientX - d.x), y: d.py + (ev.clientY - d.y) });
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [enabled, pos]);

  const style = pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined;
  // handleProps: suruklenecek baslik cubuguna yayilir.
  const handleProps = enabled ? { onPointerDown, style: { cursor: 'move', touchAction: 'none' } } : {};
  return { style, handleProps };
}
