import { isNative, getServerUrl } from './native/state';

const rawEnv = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const stripSlash = (s) => (s.endsWith('/') ? s.slice(0, -1) : s);

// ESM "canli baglama" (live binding): applyServerBase() bu iki degeri yeniden
// atadiginda, onlari import eden TUM moduller yeni degeri gorur. Tum kullanim
// yerleri degeri fonksiyon govdesinde okudugu icin (modul yuklenirken degil)
// bu guvenlidir — native tarafta adres kullanicidan gelene kadar bos kalabilir.
export let API_BASE = '';
export let WS_BASE = '';

/**
 * API ve WebSocket koklerini hesapla.
 *  - Web  : derleme aninda gelen VITE_API_URL ('/api' ya da tam URL)
 *  - Native: kullanicinin girdigi sunucu adresi (calisma aninda) + '/api'
 *
 * WS_BASE her zaman KOK origin'dir; /ws/* uclari backend'de apiPrefix'ten
 * bagimsiz olarak kokte dinlenir.
 */
export function applyServerBase() {
  if (isNative) {
    const origin = stripSlash(getServerUrl() || '');
    API_BASE = origin ? `${origin}/api` : '';
    WS_BASE = origin ? origin.replace(/^http/, 'ws') : '';
    return;
  }
  const base = stripSlash(rawEnv);
  API_BASE = base;
  // Production: API_BASE '/api' gibi goreli bir yol — WS'i window.location'dan turet
  // Dev: API_BASE tam URL ('http://localhost:4000') — semayi ws'e cevir
  WS_BASE = base.startsWith('http')
    ? base.replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}

applyServerBase();
