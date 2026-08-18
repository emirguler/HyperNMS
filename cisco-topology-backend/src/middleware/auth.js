const jwt = require('jsonwebtoken');
const { SECRET_KEY, NODE_ENV } = require('../config');
const presence = require('../services/presence');
const store = require('../utils/memoryStore');

// Cookie options
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true', // Only true when HTTPS is configured
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    path: '/'
};

// Set JWT as httpOnly cookie
function setTokenCookie(res, token) {
    res.cookie('token', token, COOKIE_OPTIONS);
}

// Clear JWT cookie
function clearTokenCookie(res) {
    res.clearCookie('token', { path: '/' });
}

// JWT authentication — reads from cookie first, then Authorization header as fallback
const authenticate = (req, res, next) => {
    let token = req.cookies?.token;

    // Fallback: Authorization header (for API clients)
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader) token = authHeader.split(' ')[1];
    }

    if (!token) return res.status(401).json({ error: 'Authentication required' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                clearTokenCookie(res);
                return res.status(401).json({ error: 'Session expired, please login again' });
            }
            return res.status(403).json({ error: 'Invalid token' });
        }
        // GUVENLIK: "2FA bekliyor" token'i bir OTURUM token'i DEGILDIR. Bu kontrol
        // olmadan istemci pending token'i cookie'ye koyup ikinci adimi tamamen
        // atlayabilirdi - yani 2FA hic devrede olmazdi.
        if (user && user.stage === '2fa') {
            return res.status(401).json({ error: 'Two-factor authentication not completed' });
        }
        req.user = user;
        presence.touch(user.id); // aktif kullanıcı takibi (User Management "Active" rozeti)
        next();
    });
};

// Roller (yetki sirasi):
//   Administrator — tam yetki
//   Operator      — Restricted-Config: SSH (izinli komutlar), arayuz konfigi, cihaz reload
//   Viewer        — User (View Only): sadece izleme; SSH/konfig/reload yok
const ROLES = { ADMIN: 'Administrator', OPERATOR: 'Operator', VIEWER: 'Viewer' };

// Eski kayitlardaki 'User' rolu = bugunun Operator'u (isim degisikligi geriye donuk uyum)
const normalizeRole = (role) => (role === 'User' ? ROLES.OPERATOR : role);

// Operator yetkisi: cihaza dokunan islemler (SSH, interface config, reload)
const canOperate = (role) => {
    const r = normalizeRole(role);
    return r === ROLES.ADMIN || r === ROLES.OPERATOR;
};

// Istegin GECERLI rolu: kayitli hesaptan okunur, token'dan degil.
// Token rolu giris aninda dondurulur ve JWT_EXPIRY boyunca degismez; bu yuzden hem
// yetki yukseltme (kullanici cikip girene kadar reddedilir) hem de yetki DUSURME
// (8 saat boyunca etkisiz kalir) gecikiyordu. Hesap silinmisse token roluna duseriz.
const effectiveRole = (req) => {
    const account = store.getUser(req.user.id);
    return (account && account.role) || req.user.role;
};

// Admin role check
const requireAdmin = (req, res, next) => {
    if (normalizeRole(effectiveRole(req)) !== ROLES.ADMIN) {
        return res.status(403).json({ error: 'Administrator privileges required' });
    }
    next();
};

// Yerlesik "admin" superkullanicisi kontrolu — kullanici adi kayittan okunur.
// 'admin' kullanici adi form'da kilitli oldugu icin kararli bir tanimlayici.
// 2FA yonetimi ve oturum kaydi silme gibi en ayricalikli islemler icin.
const requireSuperAdmin = (req, res, next) => {
    const account = store.getUser(req.user.id);
    const username = (account && account.username) || req.user.username;
    if (username !== 'admin') {
        return res.status(403).json({ error: 'Only the built-in "admin" account can do this' });
    }
    next();
};

// Operator (veya Administrator) role check — Viewer (View Only) engellenir
const requireOperator = (req, res, next) => {
    const role = effectiveRole(req);
    if (!canOperate(role)) {
        return res.status(403).json({ error: `Your role ("${role || 'unknown'}") is not permitted to perform device operations` });
    }
    next();
};

// WebSocket JWT — reads from cookie in upgrade request, then query param fallback
function authenticateWs(req) {
    // Try cookie first
    let token = null;
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
        if (match) token = match[1];
    }

    // Fallback: query param (for clients that can't send cookies on WS)
    if (!token) {
        const url = new URL(req.url, 'http://localhost');
        token = url.searchParams.get('token');
    }

    if (!token) return null;
    try {
        const payload = jwt.verify(token, SECRET_KEY);
        // HTTP tarafiyla ayni kural: yarim kalmis 2FA ile WS acilamaz
        if (payload && payload.stage === '2fa') return null;
        return payload;
    } catch {
        return null;
    }
}

module.exports = {
    authenticate, requireAdmin, requireOperator, requireSuperAdmin, authenticateWs,
    setTokenCookie, clearTokenCookie, COOKIE_OPTIONS,
    ROLES, normalizeRole, canOperate
};
