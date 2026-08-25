import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from './state';
import { showToast } from '../Toast';
import { t } from '../i18n';

// Native kabuk davranislari (gorunur cikti uretmez):
//   - durum cubugu rengi/stili
//   - Android donanim geri tusu
// Router'in ICINDE monte edilmeli (useNavigate/useLocation kullanir).
export default function NativeShell() {
  const navigate = useNavigate();
  const location = useLocation();
  // Geri tusu dinleyicisi bir kez kurulur; guncel yolu ref uzerinden okur ki
  // her gezinmede listener sokup takmak zorunda kalmayalim.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const exitArmedRef = useRef(0);

  useEffect(() => {
    if (!isNative) return undefined;

    // Durum cubugu: uygulama kendi arka planini cizsin (overlay yok) — boylece
    // icerik cubugun altina kacmaz ve ust safe-area ile ugrasmaya gerek kalmaz.
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});   // acik renkli ikonlar
    StatusBar.setBackgroundColor({ color: '#0c111d' }).catch(() => {});

    let handle;
    CapApp.addListener('backButton', () => {
      const path = pathRef.current;
      // Acik bir modal/overlay varsa once onu kapat — geri tusunun dogal beklentisi.
      const overlay = document.querySelector('.modal-overlay');
      if (overlay) {
        const closeBtn = overlay.querySelector('[aria-label="Close"], .rw-sheet-close');
        if (closeBtn) { closeBtn.click(); return; }
      }
      // Ana ekranda degilsek geri git.
      if (path !== '/dashboard' && path !== '/' && window.history.length > 1) {
        navigate(-1);
        return;
      }
      // Ana ekranda: kazara cikisi onlemek icin iki kez bas.
      const now = Date.now();
      if (now - exitArmedRef.current < 2000) { CapApp.exitApp(); return; }
      exitArmedRef.current = now;
      showToast(t('exitConfirm'), 'info', 2000);
    }).then(h => { handle = h; }).catch(() => {});

    return () => { if (handle) handle.remove(); };
  }, [navigate]);

  return null;
}
