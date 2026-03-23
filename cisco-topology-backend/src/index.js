const express = require('express');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { readJSON, writeJSON } = require('./utils/db');
const { encryptPassword } = require('./utils/crypto');
const { startPingService, onStatusChange } = require('./services/pingService');
const { setupWebSocket } = require('./services/sshService');

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
    next();
});

// --- Routes ---
app.use(authRoutes);
app.use(switchRoutes);
app.use(edgeRoutes);
app.use(userRoutes);
app.use(auditRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        env: config.NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// --- DB Initialization ---
async function initDB() {
    // Data klasörünü oluştur
    if (!fs.existsSync(config.DATA_DIR)) {
        fs.mkdirSync(config.DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(config.DB_SWITCHES)) fs.writeFileSync(config.DB_SWITCHES, JSON.stringify([]));
    if (!fs.existsSync(config.DB_HISTORY)) fs.writeFileSync(config.DB_HISTORY, JSON.stringify([]));
    if (!fs.existsSync(config.DB_EDGES)) fs.writeFileSync(config.DB_EDGES, JSON.stringify([]));

    if (!fs.existsSync(config.DB_USERS)) {
        const hashedPw = await bcrypt.hash('admin123', config.BCRYPT_ROUNDS);
        fs.writeFileSync(config.DB_USERS, JSON.stringify([
            { id: 1, username: 'admin', password: hashedPw, role: 'Administrator' }
        ]));
        console.log('[INIT] Varsayılan admin oluşturuldu (parola: admin123)');
    }

    // Migration: plain-text user parolaları
    const users = readJSON(config.DB_USERS);
    let migrated = false;
    for (const user of users) {
        if (user.password && !user.password.startsWith('$2')) {
            console.log(`[MIGRATION] Kullanıcı "${user.username}" parolası hash'leniyor...`);
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
            console.log(`[MIGRATION] Cihaz "${sw.name}" SSH parolası şifreleniyor...`);
            sw.sshPassword = encryptPassword(sw.sshPassword);
            sshMigrated = true;
        }
    }
    if (sshMigrated) writeJSON(config.DB_SWITCHES, switches);
}

// --- Durum değişikliği bildirimleri (konsol) ---
onStatusChange((change) => {
    const emoji = change.newStatus === 'UP' ? '🟢' : '🔴';
    console.log(`${emoji} [STATUS] ${change.deviceName} (${change.deviceIp}): ${change.previousStatus} → ${change.newStatus}`);
});

// --- Server Başlat ---
const server = http.createServer(app);
setupWebSocket(server);

initDB().then(() => {
    startPingService();
    server.listen(config.PORT, () => {
        console.log(`[SERVER] Port ${config.PORT} üzerinde çalışıyor (${config.NODE_ENV})`);
        console.log(`[SERVER] CORS origin: ${config.CORS_ORIGIN}`);
    });
}).catch(err => {
    console.error('[INIT] Başlatma hatası:', err);
    process.exit(1);
});
