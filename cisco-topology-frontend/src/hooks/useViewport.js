import { useSyncExternalStore } from 'react';

/**
 * useViewport
 * -----------
 * Uygulama genelinde TEK bir matchMedia kurulumu uzerinden responsive durumu paylasan hook.
 *
 * Neden useSyncExternalStore?
 *  - matchMedia listesi modul seviyesinde bir kez olusturulur; 40 bilesen bu hook'u cagirsa
 *    bile 4 MediaQueryList vardir, bilesen basina 4 tane degil.
 *  - Snapshot nesnesi cache'lenir; hicbir deger degismediyse ayni referans doner, boylece
 *    React sonsuz render dongusune girmez ve resize sirasinda gereksiz render olmaz.
 *
 * Kirilma noktalari (responsive.css ile birebir ayni olmak ZORUNDA):
 *   isPhone  -> (max-width: 768px)
 *   isTablet -> (max-width: 1024px)
 *   isShort  -> (max-height: 500px)   telefon yatay / bolunmus ekran
 *   isTouch  -> (hover: none)
 *
 * @typedef  {Object} ViewportState
 * @property {boolean} isPhone   Telefon katmani (<=768px genislik)
 * @property {boolean} isTablet  Tablet ve alti (<=1024px genislik)
 * @property {boolean} isShort   Kisa viewport (<=500px yukseklik)
 * @property {boolean} isTouch   Dokunmatik (hover yok)
 * @property {number}  width     window.innerWidth
 * @property {number}  height    window.innerHeight
 *
 * @returns {ViewportState}
 *
 * @example
 * import { useViewport } from '../hooks/useViewport';
 * const { isPhone, isShort } = useViewport();
 * if (isPhone) return <MobileList />;
 *
 * NOT: width/height "gorsel olcu" icindir (ornegin bir grafigin px genisligi). Karar verirken
 * isPhone/isTablet/isShort kullanin - onlar dogrudan CSS media query'lerinden gelir, dolayisiyla
 * scrollbar/URL-bar farklarinda CSS ile hicbir zaman ayrisamazlar.
 */

// --- Sorgular. responsive.css'teki breakpoint sistemiyle ayni olmali. ---
const Q_PHONE = '(max-width: 768px)';
const Q_TABLET = '(max-width: 1024px)';
const Q_SHORT = '(max-height: 500px)';
const Q_TOUCH = '(hover: none)';

const hasWindow = typeof window !== 'undefined';
const hasMatchMedia = hasWindow && typeof window.matchMedia === 'function';

// Modul seviyesinde TEK sefer olusturulur, tum tuketiciler bunlari paylasir.
const mqls = hasMatchMedia
  ? {
      phone: window.matchMedia(Q_PHONE),
      tablet: window.matchMedia(Q_TABLET),
      short: window.matchMedia(Q_SHORT),
      touch: window.matchMedia(Q_TOUCH),
    }
  : null;

// SSR / window yokken donen sabit anlik goruntu. Masaustu varsayilani secildi:
// "desktop degismez" kuralinin en guvenli tarafi.
const SERVER_SNAPSHOT = Object.freeze({
  isPhone: false,
  isTablet: false,
  isShort: false,
  isTouch: false,
  width: 1280,
  height: 800,
});

/** Son uretilen snapshot. Referans kararliligi buradan gelir. */
let cachedSnapshot = null;

/**
 * Canli degerleri okur; hicbiri degismediyse ONCEKI nesneyi aynen dondurur.
 * useSyncExternalStore getSnapshot'i render sirasinda cagirir, bu yuzden her
 * cagrida yeni nesne uretmek sonsuz donguye sebep olur - o yuzden karsilastiriyoruz.
 * @returns {ViewportState}
 */
function getSnapshot() {
  if (!hasWindow) return SERVER_SNAPSHOT;

  const width = window.innerWidth;
  const height = window.innerHeight;

  // matchMedia yoksa (cok eski tarayici / test ortami) olculere geri dus.
  const isPhone = mqls ? mqls.phone.matches : width <= 768;
  const isTablet = mqls ? mqls.tablet.matches : width <= 1024;
  const isShort = mqls ? mqls.short.matches : height <= 500;
  const isTouch = mqls ? mqls.touch.matches : false;

  const prev = cachedSnapshot;
  if (
    prev !== null &&
    prev.isPhone === isPhone &&
    prev.isTablet === isTablet &&
    prev.isShort === isShort &&
    prev.isTouch === isTouch &&
    prev.width === width &&
    prev.height === height
  ) {
    return prev; // hicbir sey degismedi -> ayni referans -> React render etmez
  }

  cachedSnapshot = { isPhone, isTablet, isShort, isTouch, width, height };
  return cachedSnapshot;
}

/** @returns {ViewportState} */
function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

// --- Abonelik altyapisi -------------------------------------------------------

/** @type {Set<() => void>} */
const listeners = new Set();
let isBound = false;

// Resize sirasinda saniyede onlarca olay gelir; hepsini tek bir kareye topluyoruz.
const canRaf = hasWindow && typeof window.requestAnimationFrame === 'function';
let frameHandle = 0;
let framePending = false;

function flush() {
  framePending = false;
  frameHandle = 0;
  // Kopya uzerinde donuyoruz: bir dinleyici abonelikten cikarsa Set bozulmasin.
  for (const listener of Array.from(listeners)) listener();
}

function scheduleFlush() {
  if (framePending) return;
  framePending = true;
  frameHandle = canRaf ? window.requestAnimationFrame(flush) : setTimeout(flush, 16);
}

function cancelFlush() {
  if (!framePending) return;
  framePending = false;
  if (canRaf) window.cancelAnimationFrame(frameHandle);
  else clearTimeout(frameHandle);
  frameHandle = 0;
}

// Safari 13 ve altinda MediaQueryList.addEventListener yok, addListener var.
function onMql(mql, fn) {
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', fn);
  else if (typeof mql.addListener === 'function') mql.addListener(fn);
}
function offMql(mql, fn) {
  if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', fn);
  else if (typeof mql.removeListener === 'function') mql.removeListener(fn);
}

function bind() {
  if (isBound || !hasWindow) return;
  isBound = true;
  // resize -> width/height icin. orientationchange -> iOS'ta resize'in gec/hic gelmedigi durumlar icin.
  window.addEventListener('resize', scheduleFlush, { passive: true });
  window.addEventListener('orientationchange', scheduleFlush, { passive: true });
  if (mqls) {
    onMql(mqls.phone, scheduleFlush);
    onMql(mqls.tablet, scheduleFlush);
    onMql(mqls.short, scheduleFlush);
    onMql(mqls.touch, scheduleFlush);
  }
}

function unbind() {
  if (!isBound || !hasWindow) return;
  isBound = false;
  window.removeEventListener('resize', scheduleFlush);
  window.removeEventListener('orientationchange', scheduleFlush);
  if (mqls) {
    offMql(mqls.phone, scheduleFlush);
    offMql(mqls.tablet, scheduleFlush);
    offMql(mqls.short, scheduleFlush);
    offMql(mqls.touch, scheduleFlush);
  }
  cancelFlush();
}

/**
 * @param {() => void} listener
 * @returns {() => void} abonelikten cikma fonksiyonu
 */
function subscribe(listener) {
  listeners.add(listener);
  bind(); // ilk tuketicide DOM dinleyicileri baglanir
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) unbind(); // son tuketici gidince temizle, sizinti olmasin
  };
}

/**
 * Viewport durumunu dondurur. Bkz. yukaridaki ViewportState.
 * @returns {ViewportState}
 */
export function useViewport() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default useViewport;
