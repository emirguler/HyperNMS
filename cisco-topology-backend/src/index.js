const express = require('express');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const store = require('./utils/memoryStore');
const { encryptPassword } = require('./utils/crypto');
const { startPingService, onStatusChange } = require('./services/pingService');
const { setupWebSocket } = require('./services/sshService');
const { setupHttps } = require('./middleware/httpsRedirect');
const { setupNotificationWs, addNotification, getNotifications } = require('./services/notificationService');
const { authenticate } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const switchRoutes = require('./routes/switches');
const edgeRoutes = require('./routes/edges');
const userRoutes = require('./routes/users');
const auditRoutes = require('./routes/audit');
const settingsRoutes = require('./routes/settings');

const app = express();

// --- Middleware ---
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (config.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// --- Routes ---
app.use(authRoutes);
app.use(switchRoutes);
app.use(edgeRoutes);
app.use(userRoutes);
app.use(auditRoutes);
app.use(settingsRoutes);

app.get('/notifications', authenticate, (req, res) => {
    res.json(getNotifications(parseInt(req.query.limit) || 50));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        env: config.NODE_ENV,
        devices: store.getSwitches().length,
        cacheInfo: `SNMP cache active`,
        timestamp: new Date().toISOString()
    });
});

if (config.NODE_ENV === 'production') {
    const publicPath = path.resolve(__dirname, '../public');
    if (fs.existsSync(publicPath)) {
        app.use(express.static(publicPath));
        app.get('*', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
    }
}

// --- DB Initialization ---
async function initDB() {
    // MemoryStore'u başlat (dosyalardan yükler)
    store.init();

    // Varsayılan admin yoksa oluştur
    if (store.getUsers().length === 0) {
        const hashedPw = await bcrypt.hash('admin123', config.BCRYPT_ROUNDS);
        store.addUser({ id: 1, username: 'admin', password: hashedPw, role: 'Administrator', mustChangePassword: true });
        console.log('[INIT] Varsayılan admin oluşturuldu (parola: admin123)');
    }

    // Migration: plain-text user parolaları
    for (const user of store.getUsers()) {
        if (user.password && !user.password.startsWith('$2')) {
            store.updateUser(user.id, { password: await bcrypt.hash(user.password, config.BCRYPT_ROUNDS) });
        }
    }

    // Migration: plain-text SSH parolaları
    for (const sw of store.getSwitches()) {
        if (sw.sshPassword && !sw.sshPassword.includes(':')) {
            store.updateSwitch(sw.id, { sshPassword: encryptPassword(sw.sshPassword) });
        }
    }
}

// --- Durum değişikliği → bildirim ---
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

// --- Server Başlat ---
const httpServer = http.createServer(app);
const { server, protocol } = setupHttps(httpServer, app, config.PORT);

setupWebSocket(server);
setupNotificationWs(server);

initDB().then(() => {
    startPingService();
    server.listen(config.PORT, () => {
        console.log(`[SERVER] ${protocol.toUpperCase()} Port ${config.PORT} (${config.NODE_ENV})`);
        console.log(`[SERVER] CORS: ${config.CORS_ORIGIN}`);
    });
}).catch(err => {
    console.error('[INIT] Başlatma hatası:', err);
    process.exit(1);
});
