const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const store = require('../utils/memoryStore');
const { SECRET_KEY, JWT_EXPIRY, BCRYPT_ROUNDS } = require('../config');
const rateLimiter = require('../middleware/rateLimiter');
const { authenticate, setTokenCookie, clearTokenCookie } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');
const { authenticateAD } = require('../services/adService');
const twofactor = require('./twofactor');

const router = express.Router();

// Native (Android) istemci httpOnly cookie tasiyamaz — ayni JWT'yi yanit govdesinde
// ister ve sonraki isteklerde "Authorization: Bearer" ile gonderir (middleware/auth
// bunu zaten destekliyor). Token YALNIZCA 'X-Auth-Mode: token' gonderen istemciye
// govdede verilir; web istemcisi bu basligi gondermez, yani token orada httpOnly
// cookie'de kalmaya devam eder (XSS'e karsi koruma bozulmaz).
const wantsTokenInBody = (req) => String(req.headers['x-auth-mode'] || '').toLowerCase() === 'token';

// Password strength validator
function validatePasswordStrength(password) {
    if (!password || password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
    return null;
}

const loginLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10, message: 'Too many login attempts, please try again in 5 minutes' });

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Generic error message to prevent user enumeration (M5)
    const INVALID_MSG = 'Invalid username or password';

    const user = store.getUserByUsername(username);
    if (!user) {
        // Constant-time delay to prevent timing attacks
        await bcrypt.hash('dummy', 4);
        return res.status(401).json({ error: INVALID_MSG });
    }

    if (user.authType === 'ad') {
        // AD kullanicisi: kendi AD sifresiyle LDAP bind. Yalnizca store'da kayitli AD kullanicilari girebilir (allowlist).
        try {
            await authenticateAD(username, password);
        } catch (e) {
            await logAction({ username }, 'LOGIN_FAILED', username, { ip: req.ip, authType: 'ad', reason: e.message });
            return res.status(401).json({ error: INVALID_MSG });
        }
    } else {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            await logAction({ username }, 'LOGIN_FAILED', username, { ip: req.ip });
            return res.status(401).json({ error: INVALID_MSG });
        }
    }

    // --- Ikinci asama: 2FA acikken burada OTURUM ACILMAZ ---
    // Kisa omurlu, stage:'2fa' isaretli bir gecis token'i veririz. Bu token
    // middleware/auth tarafindan oturum token'i olarak REDDEDILIR; yalnizca
    // /login/2fa onu kabul eder.
    if (user.totpEnabled === true) {
        const pendingToken = jwt.sign(
            { id: user.id, username: user.username, stage: '2fa' },
            SECRET_KEY,
            { expiresIn: '5m' }
        );
        return res.json({ twoFactorRequired: true, pendingToken });
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        SECRET_KEY,
        { expiresIn: JWT_EXPIRY }
    );

    // Set httpOnly cookie (C2)
    setTokenCookie(res, token);

    await logAction(user, 'LOGIN', username, { ip: req.ip });
    // Son basarili girisi damgala (User Management "Last login" kolonu). Bu dala
    // yalnizca oturum GERCEKTEN acildiginda gelinir; 2FA bekleyen kullanici
    // yukarida erken donmustu, yani buraya 2FA'sini gecmis kullanici duser.
    store.updateUser(user.id, { lastLogin: new Date().toISOString() });
    res.json({
        role: user.role,
        username: user.username,
        mustChangePassword: user.mustChangePassword || false,
        allowedCommands: user.allowedCommands || [],
        fullSsh: user.fullSsh === true,
        // Bu dala yalnizca totpEnabled=false iken gelinir (2FA kodu adimi yukarida
        // erken doner). Dolayisiyla require2fa aciksa kullanici kurulum ekranina
        // zorlanmali — sifre adimindan SONRA, mustChangePassword ile ayni desen.
        mustSetup2fa: user.require2fa === true,
        ...(wantsTokenInBody(req) ? { token } : {}),
    });
});

/**
 * Girisin ikinci asamasi: gecis token'i + TOTP kodu (ya da kurtarma kodu).
 * Asil oturum JWT'si YALNIZCA burada uretilir.
 */
const twoFaLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10, message: 'Too many attempts, please try again in 5 minutes' });
router.post('/login/2fa', twoFaLimiter, async (req, res) => {
    const { pendingToken, code } = req.body || {};
    let payload;
    try {
        payload = jwt.verify(pendingToken, SECRET_KEY);
    } catch (e) {
        return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    // Yalnizca stage:'2fa' token'i kabul: gecerli bir OTURUM token'i ile bu uca
    // gelip baskasinin adina oturum acilamasin.
    if (!payload || payload.stage !== '2fa') {
        return res.status(401).json({ error: 'Invalid session' });
    }

    const user = store.getUser(payload.id);
    if (!user || user.totpEnabled !== true) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    const v = twofactor.verifyAny(user, code);
    if (!v.ok) {
        await logAction(user, 'LOGIN_2FA_FAILED', user.username, { ip: req.ip, reason: v.reused ? 'code-reused' : 'invalid' });
        return res.status(401).json({
            error: v.reused
                ? 'That code was already used — wait for the next one'
                : 'Invalid code',
        });
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        SECRET_KEY,
        { expiresIn: JWT_EXPIRY }
    );
    setTokenCookie(res, token);
    await logAction(user, 'LOGIN', user.username, { ip: req.ip, twoFactor: v.viaRecovery ? 'recovery-code' : 'totp' });
    // Ikinci asama tamamlandi = oturum acildi; son giris zamanini simdi damgala.
    store.updateUser(user.id, { lastLogin: new Date().toISOString() });

    const fresh = store.getUser(user.id);
    res.json({
        role: fresh.role,
        username: fresh.username,
        mustChangePassword: fresh.mustChangePassword || false,
        allowedCommands: fresh.allowedCommands || [],
        fullSsh: fresh.fullSsh === true,
        // Kurtarma koduyla girildiyse kullaniciya kalan sayiyi soyle
        recoveryUsed: v.viaRecovery,
        recoveryRemaining: Array.isArray(fresh.recoveryCodes) ? fresh.recoveryCodes.length : 0,
        ...(wantsTokenInBody(req) ? { token } : {}),
    });
});

// Logout — clear cookie
router.post('/logout', (req, res) => {
    clearTokenCookie(res);
    res.json({ success: true });
});

// Session check — verify current cookie/token is valid
router.get('/me', authenticate, (req, res) => {
    const user = store.getUser(req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword || false,
        allowedCommands: user.allowedCommands || [],
        fullSsh: user.fullSsh === true,
        twoFactorEnabled: user.totpEnabled === true,
        // require2fa acik ve henuz kurulmamissa arayuz zorlayici ekrani acar
        // (mevcut mustChangePassword deseninin aynisi). Sayfa her acildiginda
        // /me cagrildigi icin, admin zorunlulugu actiktan sonra kullanici
        // yeniden girmese bile bir sonraki yenilemede kapiya takilir.
        mustSetup2fa: user.require2fa === true && user.totpEnabled !== true,
    });
});

// Password change (H5: strong password policy)
router.post('/change-password', authenticate, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    // Strong password validation
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
        return res.status(400).json({ error: strengthError });
    }

    const user = store.getUser(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.authType === 'ad') return res.status(400).json({ error: 'AD users manage their password in Active Directory' });

    // Current password check (except forced change)
    if (!user.mustChangePassword) {
        if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Don't allow reusing the same password
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) return res.status(400).json({ error: 'New password must be different from current password' });

    store.updateUser(req.user.id, {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false
    });

    await logAction(req.user, 'PASSWORD_CHANGE', req.user.username);
    res.json({ success: true });
});

module.exports = router;
