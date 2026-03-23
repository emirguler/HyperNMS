import { useState, useEffect, useCallback } from 'react';

let toastId = 0;
let addToastGlobal = null;

// Dışarıdan çağrılabilir fonksiyon
export function showToast(message, type = 'info', duration = 3500) {
    if (addToastGlobal) addToastGlobal({ id: ++toastId, message, type, duration });
}

export default function ToastContainer() {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((toast) => {
        setToasts(prev => [...prev, toast]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== toast.id));
        }, toast.duration);
    }, []);

    useEffect(() => { addToastGlobal = addToast; return () => { addToastGlobal = null; }; }, [addToast]);

    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

    return (
        <div style={{ position:'fixed', top:80, right:24, zIndex:9999, display:'flex', flexDirection:'column', gap:10, pointerEvents:'none' }}>
            {toasts.map(t => (
                <div key={t.id} className={`toast toast-${t.type}`} style={{ pointerEvents:'auto' }}>
                    <span className="toast-icon">{icons[t.type]}</span>
                    <span>{t.message}</span>
                    <button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>&times;</button>
                </div>
            ))}
        </div>
    );
}
