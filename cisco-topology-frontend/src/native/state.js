// Native (Android) calisma durumu.
//
// Web surumunde sunucu adresi derleme aninda bellidir (VITE_API_URL='/api', ayni
// origin). Paketlenmis mobil uygulamada ise APK her musteride ayni oldugu icin
// sunucu adresi CALISMA ANINDA kullanicidan alinir ve cihazda saklanir.
//
// Kimlik dogrulama da farklidir: WebView kendi origin'inden (https://localhost)
// calistigi icin sunucunun httpOnly cookie'si iste eklenmez. Bunun yerine ayni
// JWT'yi govdede alip 'Authorization: Bearer' ile gonderiyoruz — backend bunu
// zaten destekliyor (middleware/auth.js: cookie yoksa Authorization'a bakar).
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const isNative = Capacitor.isNativePlatform();

const K_SERVER = 'netpulse.serverUrl';
const K_TOKEN = 'netpulse.authToken';

// Preferences API'si asenkron; oysa fetch/WebSocket yamalari senkron calisir.
// Bu yuzden degerleri bellekte de tutariz — disk yalnizca kalicilik icindir.
let serverUrl = '';
let authToken = '';

export const getServerUrl = () => serverUrl;
export const getAuthToken = () => authToken;

/** Uygulama acilisinda bir kez: cihazda saklanan adres + token'i belege al. */
export async function loadNativeState() {
  if (!isNative) return;
  const [s, t] = await Promise.all([
    Preferences.get({ key: K_SERVER }).catch(() => ({ value: null })),
    Preferences.get({ key: K_TOKEN }).catch(() => ({ value: null })),
  ]);
  serverUrl = s.value || '';
  authToken = t.value || '';
}

export async function setServerUrl(url) {
  serverUrl = url || '';
  if (!isNative) return;
  if (serverUrl) await Preferences.set({ key: K_SERVER, value: serverUrl });
  else await Preferences.remove({ key: K_SERVER });
}

export async function setAuthToken(token) {
  authToken = token || '';
  if (!isNative) return;
  if (authToken) await Preferences.set({ key: K_TOKEN, value: authToken });
  else await Preferences.remove({ key: K_TOKEN });
}

/**
 * Kullanicinin yazdigi adresi normalize et: bosluklari at, sondaki '/'yi sil,
 * yol/sorgu kismini at (kok origin isteriz). Sema yoksa BILEREK eklemeyiz —
 * baglanti testi once https, sonra http deneyip calisani saklar.
 */
export function normalizeServerInput(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/\s+/g, '');
  const hasScheme = /^https?:\/\//i.test(s);
  const body = hasScheme ? s.replace(/^https?:\/\//i, '') : s;
  const host = body.split(/[/?#]/)[0]; // yalnizca host[:port]
  if (!host) return '';
  return hasScheme ? `${s.match(/^https?/i)[0].toLowerCase()}://${host}` : host;
}

/** Sema yoksa denenecek adaylar: once https, sonra http. */
export function candidateUrls(normalized) {
  if (/^https?:\/\//i.test(normalized)) return [normalized];
  return [`https://${normalized}`, `http://${normalized}`];
}

/**
 * Adresin gercekten bir NetPulse sunucusu olup olmadigini dogrula.
 * /health kimlik istemeyen ve kok yola bagli tek uctur (apiPrefix'ten bagimsiz).
 * Basarili olan tam URL'i dondurur, hicbiri tutmazsa null.
 */
export async function probeServer(normalized, timeoutMs = 6000) {
  for (const url of candidateUrls(normalized)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}/health`, { signal: ctrl.signal, credentials: 'omit' });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.status === 'ok') return url;
      }
    } catch { /* sonraki adayi dene */ }
    finally { clearTimeout(timer); }
  }
  return null;
}
