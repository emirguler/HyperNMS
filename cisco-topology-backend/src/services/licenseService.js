// Lisans dogrulama (cevrimdisi, imzali). Uretici OZEL anahtari lisans-uretici.html'de
// tutar; buraya YALNIZ GENEL anahtar gomulur. Genel anahtardan ozel anahtar URETILEMEZ,
// yani bu deger acikca dursa bile kimse sahte lisans basamaz.
//
// Lisans anahtari bicimi: "NLIC1." + base64url(payloadJSON) + "." + base64url(imza)
// payload: { v, id, customer, edition, issuedAt, expiresAt, boundTo }
// imza: RSASSA-PKCS1-v1_5 + SHA-256, payloadB64 metni uzerinde.
const crypto = require('crypto');
const store = require('../utils/memoryStore');

// RSA-2048 genel anahtar (SPKI DER, base64). Uretici tarafinca uretildi.
const PUBLIC_KEY_B64 = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuQcrBGFF4x04rKDRWwvt8a3If6JRaQ5+7LmVvZ5kKRD4eFuunRAGUSLio0nzJ+1Erqt63ar+nJqKJG0+PQpUrQ28tqc6Kp+uSQW4cKH/KRdTBUKeeeGzrzNvZTgcoyFumXvQoC6WwSbpYwBU8gIbODrRKIeZeW7Fw60LUYQMkyIF/vQiqWdDdid5LA4qItCmSY1ezwJURdeOKV8n+MscnpTAVzCpGdvIIffAB1MdN0gd27OJF+w3CJ5GC3JUIHq8VPldzJKf+jjJOsZvGW35heMJFUCfO7tE0weIpfxAjND23kw8YE8fhRw5NDnYqPUMLJYgnmI6tyVy4fch6Mxk9QIDAQAB';

let PUBLIC_KEY = null;
try {
    PUBLIC_KEY = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY_B64, 'base64'), format: 'der', type: 'spki' });
} catch (e) {
    console.error('[LICENSE] Genel anahtar yuklenemedi:', e.message);
}

const WARN_DAYS = 15; // bitise bu kadar gun kala uyari banner'i

function b64urlToBuf(s) {
    let str = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64');
}

// Kurulum kimligi: ilk cagride uretilir, ayarlarda (veri-volumu) saklanir. Container
// yeniden olusturmada korunur; kuruluma-bagli lisans bu kimlikle eslesir.
function getInstallId() {
    const s = store.getSettings();
    if (s.installId) return s.installId;
    const id = crypto.randomUUID();
    store.updateSettings({ installId: id });
    return id;
}

// Lisans anahtarini coz + imzayi dogrula. Gecersiz/kurcalanmissa null.
function parseLicenseKey(key) {
    if (!PUBLIC_KEY || !key) return null;
    const parts = String(key).trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'NLIC1') return null;
    const payloadB64 = parts[1];
    let sig, payload;
    try { sig = b64urlToBuf(parts[2]); } catch { return null; }
    try { payload = JSON.parse(b64urlToBuf(payloadB64).toString('utf8')); } catch { return null; }
    let ok = false;
    try { ok = crypto.verify('sha256', Buffer.from(payloadB64, 'utf8'), PUBLIC_KEY, sig); } catch { ok = false; }
    return ok ? payload : null;
}

// Depolanan lisansin durumu. Guard + kart bunu okur.
//   status: 'valid' | 'expired' | 'wrong_install' | 'invalid' | 'none'
//   blocked: yalnizca 'expired' ve 'wrong_install' -> sayfalar kilitlenir.
//   'none' (lisans girilmemis) BLOKE ETMEZ: urun once kurulur, sonra lisans girilir.
function getStatus() {
    const installId = getInstallId();
    const key = store.getSettings().license || null;
    const base = { installId, customer: null, edition: null, issuedAt: null, expiresAt: null, daysLeft: null, warnDays: WARN_DAYS };
    if (!key) return { ...base, status: 'none', valid: false, blocked: false };
    const p = parseLicenseKey(key);
    if (!p) return { ...base, status: 'invalid', valid: false, blocked: false };
    if (p.boundTo && p.boundTo !== installId) return { ...base, status: 'wrong_install', valid: false, blocked: true, customer: p.customer || null };
    const now = Date.now();
    const exp = p.expiresAt ? new Date(p.expiresAt).getTime() : null;
    const hasExp = exp != null && Number.isFinite(exp);
    const expired = hasExp && now > exp;
    return {
        ...base,
        status: expired ? 'expired' : 'valid',
        valid: !expired,
        blocked: expired,
        customer: p.customer || null,
        edition: p.edition || null,
        issuedAt: p.issuedAt || null,
        expiresAt: p.expiresAt || null,
        daysLeft: hasExp ? Math.ceil((exp - now) / 86400000) : null,
    };
}

// Yeni lisans uygula. Imza gecersiz ya da baska kuruluma aitse REDDET (depolanmaz).
function applyLicense(key) {
    const installId = getInstallId();
    const p = parseLicenseKey(key);
    if (!p) return { ok: false, error: 'Gecersiz lisans anahtari (imza dogrulanamadi).' };
    if (p.boundTo && p.boundTo !== installId) {
        return { ok: false, error: 'Bu lisans baska bir kuruluma ait (kurulum kimligi uyusmuyor).' };
    }
    store.updateSettings({ license: String(key).trim() });
    return { ok: true, status: getStatus() };
}

// Sayfa/yazma kilidi: yalnizca suresi dolmus ya da yanlis-kurulum lisansinda.
function isBlocked() {
    return getStatus().blocked === true;
}

module.exports = { getInstallId, parseLicenseKey, getStatus, applyLicense, isBlocked, WARN_DAYS };
