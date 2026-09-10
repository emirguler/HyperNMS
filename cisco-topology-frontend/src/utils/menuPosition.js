// Yuzen baglam menusunun ekran icinde kalmasi icin konum hesabi.
// ActionMenu ile ayni dosyada duruyordu; react-refresh bir bilesen dosyasinin
// yaninda fonksiyon dısa acmasını sevmiyor (her degisiklikte tam reload).

/**
 * Yuzen baglam menusunu goruntu alaninin icinde tutar.
 * .context-menu position:fixed oldugu icin clientX/clientY dogrudan kullanilir;
 * kirpma olmadan 375px genislikte sag kenardan tasip erisilemez hale geliyordu.
 * @param   {number} x clientX
 * @param   {number} y clientY
 * @param   {number} w menunun tahmini genisligi
 * @param   {number} h menunun tahmini yuksekligi
 * @returns {{top:number,left:number}}
 */
export function clampMenu(x, y, w = 200, h = 200) {
  if (typeof window === 'undefined') return { top: y, left: x };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.max(8, Math.min(x, vw - w - 8)),
    top: Math.max(8, Math.min(y, vh - h - 8)),
  };
}
