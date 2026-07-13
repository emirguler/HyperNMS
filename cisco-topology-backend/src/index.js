const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const config = require('./config');
const store = require('./utils/memoryStore');
const { encryptPassword } = require('./utils/crypto');
const { startPingService, onStatusChange } = require('./services/pingService');
const { setupWebSocket } = require('./services/sshService');
const { setupHttps } = require('./middleware/httpsRedirect');
const { setupNotificationWs, addNotification, getNotifications } = require('./services/notificationService');
const { authenticate } = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const switchRoutes = require('./routes/switches');
const edgeRoutes = require('./routes/edges');
const userRoutes = require('./routes/users');
const auditRoutes = require('./routes/audit');
const settingsRoutes = require('./routes/settings');
const webproxyRoutes = require('./routes/webproxy');

const app = express();

// Reverse proxy arkasında gerçek istemci IP'si için X-Forwarded-For'a güven
app.set('trust proxy', true);

// --- Core Middleware ---
app.use(compression()); // JSON/statik yanıtları gzip'le (poll yükünü küçültür)
app.use(cors({
    origin: config.CORS_ORIGIN,
    credentials: true  // Required for httpOnly cookies
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// --- M7: Request ID Tracing ---
app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    next();
});

// --- M1: Security Headers ---
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // Modern browsers: disable in favor of CSP
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' ws: wss:; " +
        "font-src 'self'"
    );
    if (config.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});

// --- H1: CSRF Protection (Double Submit Cookie) ---
app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path === '/login' || req.path === '/api/login') return next();

    // Web proxy: cihaz arayüzü formları CSRF token'ımızı bilemez — muaf tut
    if (req.path.includes('/webproxy/')) return next();
    if ((req.headers.referer || '').includes('/webproxy/')) return next();

    // Dev mode: skip CSRF (cross-origin cookie won't work 5173→4000)
    if (config.NODE_ENV !== 'production') return next();

    const csrfCookie = req.cookies?.csrfToken;
    const csrfHeader = req.headers['x-csrf-token'];

    if (!csrfCookie) return res.status(403).json({ error: 'CSRF token required' });
    if (!csrfHeader || csrfHeader !== csrfCookie) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
    }
    next();
});

// --- H6: Global Rate Limiting ---
// Kullanıcı-bazlı anahtarlandığı için (rateLimiter) limit artık kullanıcı başına.
const globalLimiter = rateLimiter({ windowMs: 60000, max: 300, message: 'Too many requests, please slow down' });
app.use((req, res, next) => {
    // Web proxy muaf: cihaz arayüzleri onlarca asset isteği yapar
    if (req.path.includes('/webproxy/') || (req.headers.referer || '').includes('/webproxy/')) return next();
    // Production'da statik varlıklar (JS/CSS chunk'ları, index.html) API limitini tüketmesin
    if (config.NODE_ENV === 'production' && !req.path.startsWith('/api')) return next();
    return globalLimiter(req, res, next);
});

// --- Routes ---
// API routes — mounted at /api for production, root for dev
const apiPrefix = config.NODE_ENV === 'production' ? '/api' : '';
app.use(apiPrefix, authRoutes);
app.use(apiPrefix, switchRoutes);
app.use(apiPrefix, edgeRoutes);
app.use(apiPrefix, userRoutes);
app.use(apiPrefix, auditRoutes);
app.use(apiPrefix, settingsRoutes);
app.use(apiPrefix, webproxyRoutes);

app.get('/notifications', authenticate, (req, res) => {
    res.json(getNotifications(parseInt(req.query.limit) || 50));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// CSRF token endpoint — generates and sets CSRF cookie
// CSRF token endpoint — accessible at both /csrf-token and /api/csrf-token
const csrfHandler = (req, res) => {
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrfToken', csrfToken, {
        httpOnly: false,
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000
    });
    res.json({ csrfToken });
};
app.get('/csrf-token', csrfHandler);
app.get('/api/csrf-token', csrfHandler);

// Web proxy fallback: cihaz sayfaları asset'leri mutlak yolla ister (/style.css gibi).
// Referer'ı webproxy olan bu istekleri 307 ile proxy prefix'ine geri yönlendir.
app.use((req, res, next) => {
    if (req.originalUrl.includes('/webproxy/')) return next();
    const ref = req.headers.referer || '';
    const m = ref.match(/\/webproxy\/([^/]+)\/(https?)/);
    if (m) {
        const prefix = (config.NODE_ENV === 'production' ? '/api' : '') + `/webproxy/${m[1]}/${m[2]}`;
        return res.redirect(307, prefix + req.originalUrl);
    }
    next();
});

if (config.NODE_ENV === 'production') {
    const publicPath = path.resolve(__dirname, '../public');
    if (fs.existsSync(publicPath)) {
        app.use(express.static(publicPath));
        // SPA catch-all: any GET request not handled by /api routes or static files
        // → serve index.html so React Router handles client-side routing
        app.use((req, res, next) => {
            if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
                return res.sendFile(path.join(publicPath, 'index.html'));
            }
            next();
        });
    }
}

// --- DB Initialization ---
async function initDB() {
    store.init();

    // Default admin with random password if no users exist
    if (store.getUsers().length === 0) {
        const defaultPw = crypto.randomBytes(12).toString('base64url');
        const hashedPw = await bcrypt.hash(defaultPw, config.BCRYPT_ROUNDS);
        store.addUser({ id: 1, username: 'admin', password: hashedPw, role: 'Administrator', mustChangePassword: true });
        console.log(`[INIT] Default admin created. Temporary password: ${defaultPw}`);
        console.log('[INIT] ⚠️  CHANGE THIS PASSWORD IMMEDIATELY ON FIRST LOGIN');
    }

    // Migration: plain-text user passwords
    for (const user of store.getUsers()) {
        if (user.password && !user.password.startsWith('$2')) {
            store.updateUser(user.id, { password: await bcrypt.hash(user.password, config.BCRYPT_ROUNDS) });
        }
    }

    // Migration: re-encrypt old format SSH passwords (M3: remove legacy format support)
    for (const sw of store.getSwitches()) {
        if (sw.sshPassword && !sw.sshPassword.includes(':')) {
            // Plain text → encrypt
            store.updateSwitch(sw.id, { sshPassword: encryptPassword(sw.sshPassword) });
        } else if (sw.sshPassword) {
            const parts = sw.sshPassword.split(':');
            if (parts.length === 3) {
                // Old format (3-part) → decrypt with old method then re-encrypt with new format
                try {
                    const { decryptPassword } = require('./utils/crypto');
                    const plain = decryptPassword(sw.sshPassword);
                    if (plain && plain !== sw.sshPassword) {
                        store.updateSwitch(sw.id, { sshPassword: encryptPassword(plain) });
                    }
                } catch {}
            }
        }
    }
}

// --- Status change → notification ---
onStatusChange((change) => {
    const emoji = change.newStatus === 'UP' ? '🟢' : '🔴';
    console.log(`${emoji} [STATUS] ${change.deviceName} (${change.deviceIp}): ${change.previousStatus} → ${change.newStatus}`);

    addNotification({
        type: change.newStatus === 'DOWN' ? 'alert' : 'info',
        severity: change.newStatus === 'DOWN' ? 'critical' : 'resolved',
        title: change.newStatus === 'DOWN' ? `${change.deviceName} is DOWN` : `${change.deviceName} is back UP`,
        message: `${change.deviceName} (${change.deviceIp}) ${change.previousStatus} → ${change.newStatus}`,
        deviceId: change.deviceId, deviceName: change.deviceName, deviceIp: change.deviceIp
    });
});

// --- Graceful shutdown ---
process.on('SIGINT', () => { store.flushSync(); process.exit(0); });
process.on('SIGTERM', () => { store.flushSync(); process.exit(0); });

// --- Server Start ---
const httpServer = http.createServer(app);
const { server, protocol } = setupHttps(httpServer, app, config.PORT);

setupWebSocket(server);
setupNotificationWs(server);

initDB().then(() => {
    startPingService();
    server.listen(config.PORT, () => {
        console.log(`[SERVER] ${protocol.toUpperCase()} Port ${config.PORT}`);
    });
}).catch(err => {
    console.error('[INIT] Startup error:', err);
    process.exit(1);
});
