require('dotenv').config();
const crypto = require('crypto');
const path = require('path');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
    console.error('[ERROR] ENCRYPTION_KEY not defined in .env!');
    process.exit(1);
}

const SECRET_KEY = process.env.JWT_SECRET || (() => {
    console.warn('[WARN] JWT_SECRET not defined in .env! Generating random key...');
    return crypto.randomBytes(64).toString('hex');
})();

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = parseInt(process.env.PORT) || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Veritabanı dosya yolları
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_SWITCHES = path.join(DATA_DIR, 'switches.json');
const DB_USERS = path.join(DATA_DIR, 'users.json');
const DB_HISTORY = path.join(DATA_DIR, 'ping_history.json');
const DB_EDGES = path.join(DATA_DIR, 'edges.json');
const DB_AUDIT = path.join(DATA_DIR, 'audit_log.json');
const DB_TOPO_TABS = path.join(DATA_DIR, 'topology_tabs.json');
const DB_SETTINGS = path.join(DATA_DIR, 'settings.json');

module.exports = {
    ENCRYPTION_KEY,
    SECRET_KEY,
    NODE_ENV,
    PORT,
    CORS_ORIGIN,
    DATA_DIR,
    DB_SWITCHES,
    DB_USERS,
    DB_HISTORY,
    DB_EDGES,
    DB_AUDIT,
    DB_TOPO_TABS,
    DB_SETTINGS,
    PING_INTERVAL: 5000,
    // Klasik NMS flap damping: cihaz DOWN sayılmadan önce kaç ARDIŞIK ping kaybı gerekir.
    // Tek paket kaybı (özellikle kablosuz/anten linklerde normaldir) yanlış alarm üretmesin.
    // Kurtulma tek başarılı ping ile anında olur.
    PING_FAIL_THRESHOLD: 3,
    MAX_HISTORY: 50000,
    SMOOTHING_FACTOR: 0.3,
    JWT_EXPIRY: '8h',
    BCRYPT_ROUNDS: 12,
    // Günlük config yedeği: her gün bu saatte (0-23, sunucu yerel saati) çalışır; cihaz başına son 7 tutulur
    CONFIG_BACKUP_HOUR: (() => { const h = parseInt(process.env.CONFIG_BACKUP_HOUR); return (h >= 0 && h <= 23) ? h : 3; })(),
};
