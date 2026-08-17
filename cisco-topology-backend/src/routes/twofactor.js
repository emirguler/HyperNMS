const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin, normalizeRole } = require('../middleware/auth');
const { encryptPassword, decryptPassword } = require('../utils/crypto');
const { logAction } = require('../services/auditLog');
const rateLimiter = require('../middleware/rateLimiter');
const totp = require('../utils/totp');

const router = express.Router();

/* ============================================================================
   IKI ASAMALI DOGRULAMA (TOTP - RFC 6238)

   Secret'lar diskte AES-256-GCM ile sifreli durur (utils/crypto, ENCRYPTION_KEY).
   Uretilen QR'lar Duo Mobile, Google/Microsoft Authenticator ve Authy ile
   uyumludur; hepsi ayni standardi kullanir.

   Tasarim kurallari:
   - Kullanici GECERLI bir kod girene kadar 2FA ACILMAZ. Aksi halde hatali bir
     kurulum admini aninda disarida birakirdi.
   - Kurtarma kodlari kayit aninda BIR KEZ gosterilir; diskte yalnizca hash'leri
     durur. Bu uygulamada kullanici yonetimine tek giris admin oldugu icin,
     telefonunu kaybeden tek admin bunlar olmadan sistemi kalici kilitlerdi.
   - Ikinci bir admin, kilitlenen kullanicinin 2FA'sini sifirlayabilir.
   ========================================================================== */

const ISSUER = 'NetPulse';

// Kod deneme siniri: 6 hane = 1M ihtimal, sinirsiz deneme kaba kuvvetle kirilir
const codeLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10, message: 'Too many attempts, try again in 5 minutes' });

// Yalnizca yerlesik "admin" superkullanicisi baska adminlerin 2FA zorunlulugunu
// yonetir ve yalnizca O, zorunlu kilinmis bir hesapta 2FA'yi kapatabilir.
// Kimlik username==='admin' ile belirlenir — bu kullanici adi form'da kilitli,
// degistirilemez, dolayisiyla kararli bir tanimlayici.
const isSuperAdmin = (u) => !!u && u.username === 'admin';

/** Kullanicinin 2FA durumu (kendi hesabi). */
router.get('/2fa/status', authenticate, (req, res) => {
    const u = store.getUser(req.user.id) || {};
    const required = u.require2fa === true;
    res.json({
        enabled: u.totpEnabled === true,
        recoveryRemaining: Array.isArray(u.recoveryCodes) ? u.recoveryCodes.length : 0,
        required,                                   // admin bu hesap icin 2FA'yi zorunlu kildi mi
        canDisable: !required || isSuperAdmin(u),   // superadmin kendi 2FA'sini her zaman kapatabilir
        mustSetup: required && u.totpEnabled !== true,
    });
});

/** Kurulum baslat: secret uretir ama HENUZ AKTIFLESTIRMEZ (totpPending). */
router.post('/2fa/setup', authenticate, (req, res) => {
    const u = store.getUser(req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.totpEnabled) return res.status(400).json({ error: 'Two-factor is already enabled' });

    const secret = totp.generateSecret();
    store.updateUser(u.id, { totpPending: encryptPassword(secret) });
    res.json({
        secret,                                              // elle girmek isteyen icin
        uri: totp.otpauthUri(u.username, ISSUER, secret),    // QR icin
    });
});

/** Kurulumu tamamla: kod dogrulanirsa aktiflesir ve kurtarma kodlari BIR KEZ doner. */
router.post('/2fa/enable', authenticate, codeLimiter, async (req, res) => {
    const u = store.getUser(req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.totpEnabled) return res.status(400).json({ error: 'Two-factor is already enabled' });
    if (!u.totpPending) return res.status(400).json({ error: 'Start the setup first' });

    const secret = decryptPassword(u.totpPending);
    const v = totp.verify(secret, req.body && req.body.code);
    if (!v.ok) {
        await logAction(req.user, 'TWOFA_ENABLE_FAILED', u.username, { ip: req.ip });
        return res.status(400).json({ error: 'Invalid code — check your phone clock and try again' });
    }

    const codes = totp.generateRecoveryCodes();
    store.updateUser(u.id, {
        totpEnabled: true,
        totpSecret: u.totpPending,
        totpPending: null,
        totpLastStep: v.step,
        recoveryCodes: codes.map(totp.hashRecovery),
    });
    await logAction(req.user, 'TWOFA_ENABLED', u.username, { ip: req.ip });
    // Kodlar SADECE burada duz metin doner; diskte yalnizca hash'leri var.
    res.json({ success: true, recoveryCodes: codes });
});

/** 2FA'yi kapat — gecerli bir kod (ya da kurtarma kodu) sart. */
router.post('/2fa/disable', authenticate, codeLimiter, async (req, res) => {
    const u = store.getUser(req.user.id);
    if (!u || !u.totpEnabled) return res.status(400).json({ error: 'Two-factor is not enabled' });
    // require2fa acik olan hesap kendi 2FA'sini kapatamaz; yalnizca "admin" istisna.
    if (u.require2fa === true && !isSuperAdmin(u)) {
        return res.status(403).json({ error: 'An administrator requires two-factor on your account' });
    }
    if (!verifyAny(u, req.body && req.body.code).ok) {
        await logAction(req.user, 'TWOFA_DISABLE_FAILED', u.username, { ip: req.ip });
        return res.status(400).json({ error: 'Invalid code' });
    }
    clear2fa(u.id);
    await logAction(req.user, 'TWOFA_DISABLED', u.username, { ip: req.ip });
    res.json({ success: true });
});

/** Kurtarma kodlarini yenile (eskiler gecersizlesir). */
router.post('/2fa/recovery', authenticate, codeLimiter, async (req, res) => {
    const u = store.getUser(req.user.id);
    if (!u || !u.totpEnabled) return res.status(400).json({ error: 'Two-factor is not enabled' });
    const v = verifyAny(u, req.body && req.body.code);
    if (!v.ok) return res.status(400).json({ error: 'Invalid code' });

    const codes = totp.generateRecoveryCodes();
    store.updateUser(u.id, { recoveryCodes: codes.map(totp.hashRecovery), ...(v.step ? { totpLastStep: v.step } : {}) });
    await logAction(req.user, 'TWOFA_RECOVERY_REGENERATED', u.username, { ip: req.ip });
    res.json({ success: true, recoveryCodes: codes });
});

/**
 * BASKA bir kullanicinin 2FA'sini sifirla — kilitlenme kurtarmasi.
 * Yalnizca Administrator. Kendi hesabin icin /2fa/disable kullanilir ki
 * bir admin baska bir admin'i "sifirla" diyerek sessizce zayiflatmasin diye
 * islem denetime yazilir.
 */
router.post('/2fa/reset/:id', authenticate, requireAdmin, async (req, res) => {
    const target = store.getUser(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!target.totpEnabled && !target.totpPending) {
        return res.status(400).json({ error: 'That user does not have two-factor set up' });
    }
    clear2fa(target.id);
    await logAction(req.user, 'TWOFA_RESET', target.username, { ip: req.ip, targetUser: target.username });
    res.json({ success: true });
});

/* --- Kullanici-basina zorunluluk: yalnizca "admin" superkullanicisi yonetir ---
   admin, herhangi bir Administrator hesabi icin 2FA'yi zorunlu kilar/kaldirir.
   Acilinca kullanici bir sonraki giriste kurulum ekranina zorlanir (mustSetup2fa)
   ve 2FA'sini kapatamaz. */
router.put('/2fa/require/:id', authenticate, requireAdmin, async (req, res) => {
    const me = store.getUser(req.user.id);
    if (!isSuperAdmin(me)) {
        return res.status(403).json({ error: 'Only the built-in "admin" account can manage this' });
    }
    const target = store.getUser(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (normalizeRole(target.role) !== 'Administrator') {
        return res.status(400).json({ error: 'Two-factor requirement applies to administrator accounts' });
    }
    if (isSuperAdmin(target)) {
        // "admin" kendini zorunlu kilmaz — zaten istisna, anlamsiz olurdu
        return res.status(400).json({ error: 'The admin account manages this for others' });
    }
    const on = req.body && req.body.require2fa === true;
    store.updateUser(target.id, { require2fa: on });
    await logAction(req.user, on ? 'TWOFA_REQUIRED_ON' : 'TWOFA_REQUIRED_OFF', target.username, { ip: req.ip, targetUser: target.username });
    res.json({ success: true, require2fa: on });
});

/* --- ortak yardimcilar (login rotasi da kullanir) ------------------------ */

/** 2FA alanlarini tamamen temizler. */
function clear2fa(id) {
    store.updateUser(id, {
        totpEnabled: false, totpSecret: null, totpPending: null,
        totpLastStep: null, recoveryCodes: [],
    });
}

/**
 * Once TOTP, tutmazsa kurtarma kodu dener. Basarili TOTP'de totpLastStep
 * guncellenir (tekrar korumasi), basarili kurtarma kodunda o kod tuketilir.
 * @returns {{ok:boolean, viaRecovery:boolean, step:number|null}}
 */
function verifyAny(user, code) {
    if (!user || !user.totpEnabled || !user.totpSecret) return { ok: false, viaRecovery: false, step: null, reused: false };
    const secret = decryptPassword(user.totpSecret);
    const v = totp.verify(secret, code, { lastStep: user.totpLastStep ?? null });
    if (v.ok) {
        store.updateUser(user.id, { totpLastStep: v.step });
        return { ok: true, viaRecovery: false, step: v.step, reused: false };
    }
    const r = totp.consumeRecoveryCode(user.recoveryCodes, code);
    if (r.ok) {
        store.updateUser(user.id, { recoveryCodes: r.remaining });
        return { ok: true, viaRecovery: true, step: null, reused: false };
    }
    return { ok: false, viaRecovery: false, step: null, reused: v.reused === true };
}

module.exports = router;
module.exports.verifyAny = verifyAny;
module.exports.clear2fa = clear2fa;
module.exports.isSuperAdmin = isSuperAdmin;
