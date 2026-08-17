import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * useLongPress
 * ------------
 * Dokunmatik cihazlarda sag tik yoktur; "uzun basma" onun yerini tutar.
 * Bu hook bir elemana yayilacak (spread) event prop'lari uretir.
 *
 * Iptal kosullari: parmak moveTolerance px'ten fazla kayarsa, pointerup /
 * pointercancel / pointerleave gelirse, eleman blur olursa ya da sayfa kaydirilirsa.
 *
 * @param {(e: LongPressEvent) => void} handler  delay ms dolunca cagrilir
 * @param {Object}  [options]
 * @param {number}  [options.delay=500]          basili tutma suresi (ms)
 * @param {number}  [options.moveTolerance=10]   bu kadar px kayma iptal etmez
 * @returns {{
 *   onPointerDown: (e: PointerEvent) => void,
 *   onPointerMove: (e: PointerEvent) => void,
 *   onPointerUp: (e: PointerEvent) => void,
 *   onPointerCancel: (e: PointerEvent) => void,
 *   onPointerLeave: (e: PointerEvent) => void,
 *   onLostPointerCapture: (e: PointerEvent) => void,
 *   onBlur: () => void,
 *   onContextMenu: (e: Event) => void,
 *   onClickCapture: (e: Event) => void
 * }}
 *
 * @typedef  {Object} LongPressEvent
 * @property {number} clientX
 * @property {number} clientY
 * @property {number} pageX
 * @property {number} pageY
 * @property {string} pointerType  'touch' | 'pen' | 'mouse'
 * @property {EventTarget} target
 * @property {EventTarget} currentTarget  bind'in yayildigi eleman
 * @property {PointerEvent} nativeEvent
 *
 * @example
 * import { useLongPress } from '../hooks/useLongPress';
 * const bind = useLongPress((e) => openMenuAt(e.clientX, e.clientY));
 * <div {...bind} className="node-card"> ... </div>
 *
 * TUKETICIYE CSS NOTU: uzun basma hedefi olan elemana su stilleri verin, yoksa iOS
 * metin secme balonunu / suruk-onizlemesini gosterir:
 *   touch-action: manipulation;   // cift dokunma zoom'unu keser, kaydirmayi BOZMAZ
 *   -webkit-touch-callout: none;
 *   -webkit-user-select: none;
 *   user-select: none;
 * (Bilerek pointerdown'da preventDefault CAGIRMIYORUZ: Safari'de bu, elemanin icinde
 *  bulundugu listenin kaydirilmasini bozabiliyor. Balonu onContextMenu bastiriyor.)
 */

// Modul seviyesinde tek MediaQueryList - bilesen basina yeniden olusturulmaz.
const coarseMql =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;

/** @returns {boolean} parmak/kalem gibi kaba bir isaretleyici mi */
function isCoarsePointer() {
  return coarseMql ? coarseMql.matches : false;
}

export function useLongPress(handler, options = {}) {
  const { delay = 500, moveTolerance = 10 } = options;

  // Handler'i ref'te tutuyoruz ki her render'da yeni fonksiyon gelse bile
  // timer'i yeniden kurmak zorunda kalmayalim.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const timerRef = useRef(0);
  const startRef = useRef(null); // { x, y, pointerId }
  const firedRef = useRef(false); // bu basimda handler calisti mi
  const suppressClickRef = useRef(false); // sonraki click yutulacak mi
  const scrollFnRef = useRef(null);

  // --- Kaydirma izleme: liste kaydirilirken uzun basma tetiklenmemeli ---
  const stopScrollWatch = useCallback(() => {
    if (scrollFnRef.current && typeof window !== 'undefined') {
      window.removeEventListener('scroll', scrollFnRef.current, { capture: true });
    }
    scrollFnRef.current = null;
  }, []);

  /** Bekleyen basimi iptal eder. firedRef/suppressClickRef'e DOKUNMAZ. */
  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
    startRef.current = null;
    stopScrollWatch();
  }, [stopScrollWatch]);

  const onPointerDown = useCallback(
    (e) => {
      // Fare ile sag/orta tikta uzun basma baslatma - orada zaten gercek context menu var.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Ikinci parmak (pinch-zoom) geldiyse basimi dusur.
      if (e.isPrimary === false) {
        cancel();
        return;
      }

      cancel();
      firedRef.current = false;
      suppressClickRef.current = false; // yeni basim: eski yutma bayragi temizlensin

      startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };

      // React sentetik olayinin currentTarget'i dispatch bitince null'lanir; timer
      // icinde lazim oldugu icin degerleri simdi kopyaliyoruz.
      const snap = {
        clientX: e.clientX,
        clientY: e.clientY,
        pageX: e.pageX,
        pageY: e.pageY,
        pointerType: e.pointerType,
        target: e.target,
        currentTarget: e.currentTarget,
        nativeEvent: e.nativeEvent || e,
      };

      timerRef.current = setTimeout(() => {
        timerRef.current = 0;
        startRef.current = null;
        firedRef.current = true;
        // Uzun basmadan sonra gelen click yutulmali, yoksa node hem menuyu acar hem "acilir".
        suppressClickRef.current = true;
        stopScrollWatch();
        const fn = handlerRef.current;
        if (typeof fn === 'function') fn(snap);
      }, delay);

      // Kaydirma basladigi anda iptal. capture:true -> ic scroll container'lari da yakalar.
      if (typeof window !== 'undefined') {
        const onScroll = () => cancel();
        scrollFnRef.current = onScroll;
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      }
    },
    [delay, cancel, stopScrollWatch]
  );

  const onPointerMove = useCallback(
    (e) => {
      const start = startRef.current;
      if (!start) return;
      // Baska bir parmagin hareketi bu basimi ilgilendirmez.
      if (start.pointerId != null && e.pointerId !== start.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > moveTolerance * moveTolerance) cancel();
    },
    [moveTolerance, cancel]
  );

  const onPointerUp = useCallback(() => {
    cancel();
  }, [cancel]);

  const onPointerCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  const onPointerLeave = useCallback(() => {
    cancel();
  }, [cancel]);

  const onLostPointerCapture = useCallback(() => {
    cancel();
  }, [cancel]);

  const onBlur = useCallback(() => {
    cancel();
  }, [cancel]);

  const onContextMenu = useCallback((e) => {
    // Dokunmatikte uzun basinca iOS/Android'in cikardigi metin balonunu ve
    // tarayici menusunu bastir. Farede gercek sag tik menusu calismaya devam etsin.
    if (isCoarsePointer() || firedRef.current) {
      e.preventDefault();
    }
  }, []);

  const onClickCapture = useCallback((e) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    // Capture fazinda durdurmak, elemanin kendi onClick'inin hic calismamasini saglar.
    e.preventDefault();
    e.stopPropagation();
    const native = e.nativeEvent;
    if (native && typeof native.stopImmediatePropagation === 'function') {
      native.stopImmediatePropagation();
    }
  }, []);

  // Basim ortasinda unmount olursa timer'i ve scroll dinleyicisini birak.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = 0;
      startRef.current = null;
      stopScrollWatch();
    };
  }, [stopScrollWatch]);

  return useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onLostPointerCapture,
      onBlur,
      onContextMenu,
      onClickCapture,
    }),
    [
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onLostPointerCapture,
      onBlur,
      onContextMenu,
      onClickCapture,
    ]
  );
}

export default useLongPress;
