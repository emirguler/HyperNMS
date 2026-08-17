import { useState, useEffect, useCallback, useRef } from 'react';
import { useViewport } from './hooks/useViewport';

let toastId = 0;
let addToastGlobal = null;

// Dışarıdan çağrılabilir fonksiyon
export function showToast(message, type = 'info', duration = 3500) {
    if (addToastGlobal) addToastGlobal({ id: ++toastId, message, type, duration });
}

const ICONS = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

// Telefonda arka arkaya gelen "device down" bildirimleri ekrani kaplamasin.
const MOBILE_STACK_LIMIT = 3;
// Bu kadar px yana suruklenince toast kapanir.
const SWIPE_DISMISS_PX = 90;
// Suruklemenin baslamis sayilmasi icin gereken minimum yatay hareket.
const SWIPE_START_PX = 10;

// Masaustu konumu: hicbir sey degismiyor.
const DESKTOP_CONTAINER = {
    position: 'fixed', top: 80, right: 24, zIndex: 9999,
    display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none'
};

// Telefon dikey: bas parmak bolgesine, tam genislik eksi kenar bosluklari.
const PHONE_CONTAINER = {
    position: 'fixed',
    left: 'max(12px, env(safe-area-inset-left))',
    right: 'max(12px, env(safe-area-inset-right))',
    top: 'auto',
    bottom: 'calc(12px + env(safe-area-inset-bottom))',
    // .nav-header 10000, mobil .modal-overlay 10001 -> toast ikisinin de ustunde.
    zIndex: 10002,
    display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none'
};

// Kisa ekran (telefon yatay): alt bar/terminal ile cakismasin diye ustte kalir,
// ama daraltilmis navbar'in (44px) hemen altina ve dar bir kolona alinir.
const SHORT_CONTAINER = {
    position: 'fixed',
    top: 52,
    right: 'max(12px, env(safe-area-inset-right))',
    left: 'auto',
    bottom: 'auto',
    maxWidth: 'min(380px, calc(100vw - 24px))',
    zIndex: 10002,
    display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none'
};

/**
 * Tek bir toast. Modul seviyesinde tanimli (bilesen icinde tanimlanirsa her
 * render'da yeniden mount olurdu ve giris animasyonu surekli tekrarlardi).
 */
function ToastItem({ toast, onDismiss, swipeable }) {
    const [dx, setDx] = useState(0);
    const dragRef = useRef(null);

    const handlePointerDown = (e) => {
        if (!swipeable) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragRef.current = { x: e.clientX, y: e.clientY, dx: 0, active: false };
    };

    const handlePointerMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        const moveX = e.clientX - d.x;
        const moveY = e.clientY - d.y;
        if (!d.active) {
            // Dikey kaydirma niyetini calma: once yataya karar ver.
            if (Math.abs(moveX) < SWIPE_START_PX || Math.abs(moveX) <= Math.abs(moveY)) return;
            d.active = true;
        }
        d.dx = moveX;
        setDx(moveX);
    };

    // pointerup / pointercancel / pointerleave hepsi buraya duser. pointerleave
    // sart: fare ile suruklerken imlec toast'tan cikarsa pointerup gelmez ve
    // toast yamuk + yari saydam takili kalirdi.
    const endDrag = () => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d && d.active && Math.abs(d.dx) > SWIPE_DISMISS_PX) {
            onDismiss(toast.id);
            return;
        }
        // Masaustunde her fare cikisinda gereksiz render tetiklenmesin.
        if (dx !== 0) setDx(0);
    };

    const dragging = dx !== 0;

    return (
        <div
            className={`toast toast-${toast.type}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={endDrag}
            style={{
                pointerEvents: 'auto',
                ...(swipeable ? { touchAction: 'pan-y' } : null),
                ...(dragging
                    ? {
                        transform: `translateX(${dx}px)`,
                        opacity: Math.max(0.25, 1 - Math.abs(dx) / 240),
                        transition: 'none'
                    }
                    : null)
            }}
        >
            <span className="toast-icon">{ICONS[toast.type]}</span>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{toast.message}</span>
            <button
                type="button"
                className="toast-close"
                aria-label="Dismiss notification"
                onClick={() => onDismiss(toast.id)}
            >&times;</button>
        </div>
    );
}

export default function ToastContainer() {
    const [toasts, setToasts] = useState([]);
    const { isPhone, isTablet, isShort, isTouch, width } = useViewport();

    const addToast = useCallback((toast) => {
        setToasts(prev => [...prev, toast]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== toast.id));
        }, toast.duration);
    }, []);

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    useEffect(() => { addToastGlobal = addToast; return () => { addToastGlobal = null; }; }, [addToast]);

    // Telefon dikeyde alta; kisa ekranda (yatay telefon) ustte ama dar.
    // <=600px'te responsive.css bolum 10'daki `div:has(> .toast)` kurali
    // left/right/top/bottom'u zaten !important ile alta zorluyor; orada SHORT
    // secmek JS ile CSS'i celiskiye dusururdu (or. 568x320 iPhone SE yatay).
    const compact = isPhone || isShort;
    const containerStyle = (isShort && width > 600)
        ? SHORT_CONTAINER
        : (isPhone ? PHONE_CONTAINER : DESKTOP_CONTAINER);
    // Dokunmatikte kaydirarak kapatma; masaustunde hicbir ek stil eklenmez.
    const swipeable = isTablet || isShort || isTouch;
    // Yigin tavani: dar ekranda en son 3 toast gorunur.
    const visible = compact ? toasts.slice(-MOBILE_STACK_LIMIT) : toasts;

    return (
        <div className="toast-container" style={containerStyle}>
            {visible.map(t => (
                <ToastItem key={t.id} toast={t} onDismiss={dismiss} swipeable={swipeable} />
            ))}
        </div>
    );
}
