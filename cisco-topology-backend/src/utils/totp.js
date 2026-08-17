const crypto = require('crypto');

/* ============================================================================
   TOTP — RFC 6238 (RFC 4226 HOTP uzerine)

   Elle yazildi ama "kendi kriptonu yazma" durumu DEGIL: gercek kriptografi
   Node'un denetlenmis crypto modulundeki HMAC-SHA1; geri kalani RFC'de birebir
   tarif edilmis bir sayac ve kirpma islemi. Dogrulugu RFC 6238'in resmi test
   vektorleriyle sinaniyor (bkz. totp.test), yani bir bagimlilik eklemeden
   davranisi kanitlanabiliyor.

   Uretilen secret'lar Duo Mobile, Google Authenticator, Microsoft Authenticator
   ve Authy ile uyumludur (hepsi ayni standardi kullanir).
   ========================================================================== */

const STEP = 30;          // saniye — standart pencere
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';   // RFC 4648

function base32Encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += B32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, value = 0;
    const out = [];
    for (const ch of clean) {
        const idx = B32.indexOf(ch);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

/** 160-bit rastgele secret (base32). Authenticator uygulamalarinin bekledigi boy. */
function generateSecret() {
    return base32Encode(crypto.randomBytes(20));
}

/**
 * Belirli bir zaman adimi icin kod. RFC 4226 dinamik kirpma.
 * @param {string} secretB32
 * @param {number} step  Math.floor(unixSeconds / 30)
 * @param {number} digits
 */
function codeForStep(secretB32, step, digits = DIGITS) {
    const key = base32Decode(secretB32);
    // 8 baytlik big-endian sayac
    const counter = Buffer.alloc(8);
    counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
    counter.writeUInt32BE(step >>> 0, 4);

    const hmac = crypto.createHmac('sha1', key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24)
        | ((hmac[offset + 1] & 0xff) << 16)
        | ((hmac[offset + 2] & 0xff) << 8)
        | (hmac[offset + 3] & 0xff);
    return String(bin % Math.pow(10, digits)).padStart(digits, '0');
}

/** Su anki adim. */
function currentStep(nowMs = Date.now()) {
    return Math.floor(nowMs / 1000 / STEP);
}

/**
 * Kodu dogrular.
 *
 * @param {string} secretB32
 * @param {string} token           kullanicinin girdigi 6 hane
 * @param {Object} [opts]
 * @param {number} [opts.window=1] +/- kac adim kabul edilsin (saat kaymasi payi)
 * @param {number} [opts.lastStep] daha once BASARIYLA kullanilmis adim - TEKRAR
 *                                 saldirisini engeller: ayni kod 30sn icinde
 *                                 ikinci kez kabul edilmez.
 * @param {number} [opts.nowMs]
 * @returns {{ok: boolean, step: number|null, reused: boolean}}
 *   reused=true: kod DOGRU ama o adim zaten kullanilmis. Cagiran taraf bunu
 *   "gecersiz kod"tan ayirip "bu kod kullanildi, bir sonrakini bekleyin" diyebilir
 *   — 2FA'yi acip ayni 30sn icinde giris yapan kullanici aksi halde kodu yanlis
 *   girdigini saniyor.
 */
function verify(secretB32, token, opts = {}) {
    const { window = 1, lastStep = null, nowMs = Date.now() } = opts;
    const clean = String(token || '').replace(/\D/g, '');
    if (clean.length !== DIGITS || !secretB32) return { ok: false, step: null, reused: false };

    const now = currentStep(nowMs);
    let reused = false;
    for (let d = -window; d <= window; d++) {
        const step = now + d;
        const expected = codeForStep(secretB32, step);
        // Sabit zamanli karsilastirma: kod tahmininde zamanlama sizintisi olmasin
        const a = Buffer.from(expected), b = Buffer.from(clean);
        if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) continue;
        if (lastStep !== null && step <= lastStep) { reused = true; continue; }  // tekrar koruması
        return { ok: true, step, reused: false };
    }
    return { ok: false, step: null, reused };
}

/**
 * Authenticator uygulamasinin QR ile okudugu URI.
 * Not: label ve issuer ayri ayri encode edilir; ":" ayraci encode EDILMEZ.
 */
function otpauthUri(account, issuer, secretB32) {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    const q = new URLSearchParams({
        secret: secretB32,
        issuer,
        algorithm: 'SHA1',
        digits: String(DIGITS),
        period: String(STEP),
    });
    return `otpauth://totp/${label}?${q.toString()}`;
}

/* --- Kurtarma kodlari ---------------------------------------------------- */
/* Telefonu kaybeden TEK admin, kullanici yonetimine tek giris oldugu icin
   sistemi kalici olarak kilitlerdi. Kodlar yuksek entropili (rastgele uretilir,
   kullanici secmez), bu yuzden bcrypt yerine sha256 yeterli ve hizli. */

const RECOVERY_COUNT = 10;

function generateRecoveryCodes(n = RECOVERY_COUNT) {
    const codes = [];
    for (let i = 0; i < n; i++) {
        // 10 karakter base32 ~ 50 bit; okunabilirlik icin ortadan bolunur
        const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
        codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
    }
    return codes;
}

const hashRecovery = (code) =>
    crypto.createHash('sha256').update(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

/**
 * Kurtarma kodunu tuketir. Eslesirse o hash listeden CIKARILIR (tek kullanimlik).
 * @returns {{ok: boolean, remaining: string[]}}
 */
function consumeRecoveryCode(hashes, code) {
    const list = Array.isArray(hashes) ? hashes : [];
    const h = hashRecovery(code);
    const idx = list.indexOf(h);
    if (idx === -1) return { ok: false, remaining: list };
    const remaining = list.slice();
    remaining.splice(idx, 1);
    return { ok: true, remaining };
}

module.exports = {
    generateSecret, codeForStep, currentStep, verify, otpauthUri,
    generateRecoveryCodes, hashRecovery, consumeRecoveryCode,
    base32Encode, base32Decode,
    STEP, DIGITS, RECOVERY_COUNT,
};
