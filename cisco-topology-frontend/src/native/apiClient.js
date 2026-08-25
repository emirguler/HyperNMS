// Native modda ag katmani yamalari.
//
// Amac: sayfa/bilesen kodunda TEK SATIR degisiklik yapmadan, mobil uygulamanin
// tum istekleri "Authorization: Bearer" ile gitsin. Uygulamada 50'den fazla
// fetch cagrisi var (bir kismi authFetch'ten gecmiyor); hepsini tek tek elden
// gecirmek yerine dusuk seviyede uc noktayi yamiyoruz:
//   1) fetch        -> API isteklerine token + 'X-Auth-Mode: token' basligi
//   2) WebSocket    -> /ws/* adreslerine ?token= (tarayici WS'inde baslik konamaz)
//   3) <a download> -> blob indirmeleri cihaza kaydet + paylas sayfasini ac
// Uc yama da YALNIZCA native'de kurulur; web surumu hic etkilenmez.
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative, getAuthToken } from './state';
import { API_BASE, WS_BASE } from '../config';
import { showToast } from '../Toast';
import { t } from '../i18n';

const headersToObject = (h) => {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...h };
};

const hasHeader = (obj, name) =>
  Object.keys(obj).some((k) => k.toLowerCase() === name.toLowerCase());

export function installNativeApiClient() {
  if (!isNative || window.__netpulseNativePatched) return;
  window.__netpulseNativePatched = true;

  // --- 1) fetch ---------------------------------------------------------
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    // Yalnizca kendi API'mize giden, dizge olarak verilmis URL'ler. (Request
    // nesnesi gecen bir cagri yok; olsaydi da dokunmadan geciriyoruz.)
    if (typeof input === 'string' && API_BASE && input.startsWith(API_BASE)) {
      const headers = headersToObject(init.headers);
      // Giris uclarina "token'i govdede ver" isareti — backend yalnizca bu
      // basligi gonderen istemciye JWT'yi govdede doner.
      headers['X-Auth-Mode'] = 'token';
      const tok = getAuthToken();
      if (tok && !hasHeader(headers, 'authorization')) headers.Authorization = `Bearer ${tok}`;
      // Cross-origin cookie tasinmaz; credentials:'include' yalnizca CORS'u
      // gereksiz yere sikilastirirdi.
      return origFetch(input, { ...init, headers, credentials: 'omit' });
    }
    return origFetch(input, init);
  };

  // --- 2) WebSocket -----------------------------------------------------
  const NativeWS = window.WebSocket;
  function PatchedWebSocket(url, protocols) {
    let u = url;
    const tok = getAuthToken();
    if (typeof u === 'string' && WS_BASE && u.startsWith(WS_BASE) && tok && !/[?&]token=/.test(u)) {
      u += `${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(tok)}`;
    }
    return protocols === undefined ? new NativeWS(u) : new NativeWS(u, protocols);
  }
  PatchedWebSocket.prototype = NativeWS.prototype;
  PatchedWebSocket.CONNECTING = 0; PatchedWebSocket.OPEN = 1;
  PatchedWebSocket.CLOSING = 2; PatchedWebSocket.CLOSED = 3;
  window.WebSocket = PatchedWebSocket;

  // --- 3) <a download> --------------------------------------------------
  // Uygulamadaki tum disa aktarmalar (CSV, yedek, config, oturum kaydi) ayni
  // deseni kullaniyor: blob URL'li gecici bir <a download> olusturup click().
  // WebView'de bu sessizce hicbir sey yapmaz; yakalayip cihaza yaziyoruz.
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
    const href = this.getAttribute('href') || '';
    if (this.download && (href.startsWith('blob:') || href.startsWith('data:'))) {
      saveUrlToDevice(href, this.download);
      return;
    }
    return origAnchorClick.call(this);
  };
}

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.readAsDataURL(blob);
  });

/** Blob/data URL'ini cihaza yazip paylas sayfasini acar. */
async function saveUrlToDevice(url, filename) {
  try {
    const blob = await (await fetch(url)).blob();
    await saveBlobToDevice(blob, filename);
  } catch {
    showToast(t('dlFailed'), 'error');
  }
}

export async function saveBlobToDevice(blob, filename) {
  const data = await blobToBase64(blob);
  // Directory.Cache: uygulamaya ozel alan — hicbir depolama izni gerektirmez ve
  // her Android surumunde calisir. (Public Documents klasoru Android 11+'ta
  // MANAGE_EXTERNAL_STORAGE olmadan yazilamaz.) Kullanici dosyayi paylas
  // sayfasindan Dosyalar/Drive/e-posta gibi kalici bir yere aktarir.
  const res = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({ title: filename, files: [res.uri] });
  } catch {
    // Kullanici paylas sayfasini kapatti — hata degil.
  }
  showToast(`${t('dlReady')}: ${filename}`, 'success');
}

/**
 * Kimlik gerektiren bir sunucu URL'ini indir.
 * Web'de yeni sekmede acilir (cookie ile calisir); native'de yamalanmis fetch
 * token'i ekler, dosya cihaza kaydedilir.
 */
export async function downloadAuthedUrl(url, filename) {
  if (!isNative) { window.open(url, '_blank'); return; }
  try {
    const res = await fetch(url);
    if (!res || !res.ok) throw new Error('download failed');
    await saveBlobToDevice(await res.blob(), filename);
  } catch {
    showToast(t('dlFailed'), 'error');
  }
}
