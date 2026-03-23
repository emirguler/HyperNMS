const express = require('express');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { readJSON, writeJSON } = require('./utils/db');
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

const app = express();

// --- Middleware ---
app.use(cors({
    origin: config.CORS_ORIGIN,
    credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Security headers
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

// Notifications REST endpoint
app.get('/notifications', authenticate, (req, res) => {
    res.json(getNotifications(parseInt(req.query.limit) || 50));
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        env: config.NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// Production: serve frontend static files
if (config.NODE_ENV === 'production') {
    const publicPath = path.resolve(__dirname, '../public');
    if (fs.existsSync(publicPath)) {
        app.use(express.static(publicPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(publicPath, 'index.html'));
        });
    }
}

// --- DB Initialization ---
async function initDB() {
    if (!fs.existsSync(config.DATA_DIR)) {
        fs.mkdirSync(config.DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(config.DB_SWITCHES)) fs.writeFileSync(config.DB_SWITCHES, JSON.stringify([]));
    if (!fs.existsSync(config.DB_HISTORY)) fs.writeFileSync(config.DB_HISTORY, JSON.stringify([]));
    if (!fs.existsSync(config.DB_EDGES)) fs.writeFileSync(config.DB_EDGES, JSON.stringify([]));

    if (!fs.existsSync(config.DB_USERS)) {
        const hashedPw = await bcrypt.hash('admin123', config.BCRYPT_ROUNDS);
        fs.writeFileSync(config.DB_USERS, JSON.stringify([
            { id: 1, username: 'admin', password: hashedPw, role: 'Administrator', mustChangePassword: true }
        ]));
        console.log('[INIT] Varsayılan admin oluşturuldu (parola: admin123)');
    }

    // Migration: plain-text user parolaları
    const users = readJSON(config.DB_USERS);
    let migrated = false;
    for (const user of users) {
        if (user.password && !user.password.startsWith('$2')) {
            user.password = await bcrypt.hash(user.password, config.BCRYPT_ROUNDS);
            migrated = true;
        }
    }
    if (migrated) writeJSON(config.DB_USERS, users);

    // Migration: plain-text SSH parolaları
    const switches = readJSON(config.DB_SWITCHES);
    let sshMigrated = false;
    for (const sw of switches) {
        if (sw.sshPassword && !sw.sshPassword.includes(':')) {
            sw.sshPassword = encryptPassword(sw.sshPassword);
            sshMigrated = true;
        }
    }
    if (sshMigrated) writeJSON(config.DB_SWITCHES, switches);
}

// --- Durum değişikliği → bildirim ---
onStatusChange((change) => {
    const emoji = change.newStatus === 'UP' ? '🟢' : '🔴';
    console.log(`${emoji} [STATUS] ${change.deviceName} (${change.deviceIp}): ${change.previousStatus} → ${change.newStatus}`);

    addNotification({
        type: change.newStatus === 'DOWN' ? 'alert' : 'info',
        severity: change.newStatus === 'DOWN' ? 'critical' : 'resolved',
        title: change.newStatus === 'DOWN'
            ? `${change.deviceName} is DOWN`
            : `${change.deviceName} is back UP`,
        message: `${change.deviceName} (${change.deviceIp}) changed from ${change.previousStatus} to ${change.newStatus}`,
        deviceId: change.deviceId,
        deviceName: change.deviceName,
        deviceIp: change.deviceIp
    });
});

// --- Server Başlat ---
const httpServer = http.createServer(app);
const { server, protocol } = setupHttps(httpServer, app, config.PORT);

setupWebSocket(server);
setupNotificationWs(server);

initDB().then(() => {
    startPingService();
    server.listen(config.PORT, () => {
        console.log(`[SERVER] ${protocol.toUpperCase()} Port ${config.PORT} üzerinde çalışıyor (${config.NODE_ENV})`);
        console.log(`[SERVER] CORS origin: ${config.CORS_ORIGIN}`);
    });
}).catch(err => {
    console.error('[INIT] Başlatma hatası:', err);
    process.exit(1);
});
