const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { authenticateWs } = require('../middleware/auth');

const NOTIF_FILE = path.join(config.DATA_DIR, 'notifications.json');
const RETENTION_MS = 24 * 60 * 60 * 1000; // 1 gün — daha eskiler silinir
const MAX_NOTIFICATIONS = 2000;           // güvenlik tavanı (flap fırtınasına karşı)

let notifications = [];
let notificationWss = null;
let writeTimer = null;
let idSeq = 0;

// Benzersiz id. Date.now() TEK BAŞINA yetmiyor: flap fırtınasında aynı
// milisaniyede onlarca bildirim üretilince id'ler çakışıyor, frontend'de
// React key'leri tekrar edip DOM şişiyordu (silinmeyen bayat satırlar).
// Sayaç eki id'yi aynı ms içinde de benzersiz yapar.
function nextId() {
    idSeq = (idSeq + 1) % 1e9;
    return `${Date.now()}-${idSeq}`;
}

// timestamp'i (ISO) ms'ye çevir — bozuksa 0 → prune'da elenir
function tsMs(n) {
    const t = new Date(n && n.timestamp).getTime();
    return Number.isFinite(t) ? t : 0;
}

// 24 saatten eski kayıtları at
function prune(list) {
    const cutoff = Date.now() - RETENTION_MS;
    return list.filter(n => tsMs(n) >= cutoff);
}

function loadNotifications() {
    try {
        if (fs.existsSync(NOTIF_FILE)) {
            const data = JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8'));
            const raw = Array.isArray(data) ? data.length : 0;
            notifications = Array.isArray(data) ? prune(data) : [];
            console.log(`[NOTIF] Diskten yüklendi: ${notifications.length}/${raw} bildirim (24s içi tutuldu) — ${NOTIF_FILE}`);
        } else {
            console.log(`[NOTIF] Kayıt dosyası yok, boş başlanıyor — ${NOTIF_FILE}`);
        }
    } catch (e) {
        console.error('[NOTIF] okunamadı:', e.message);
        notifications = [];
    }
}

function writeFile(sync = false) {
    const tmp = NOTIF_FILE + '.tmp';
    const json = JSON.stringify(notifications);
    try {
        if (sync) {
            fs.writeFileSync(tmp, json);
            fs.renameSync(tmp, NOTIF_FILE);
        } else {
            fs.writeFile(tmp, json, (err) => {
                if (err) return console.error('[NOTIF] yazılamadı:', err.message);
                fs.rename(tmp, NOTIF_FILE, (e2) => { if (e2) console.error('[NOTIF] rename:', e2.message); });
            });
        }
    } catch (e) {
        console.error('[NOTIF] yazılamadı:', e.message);
    }
}

// Debounce'lu async yazım (art arda bildirimleri tek yazıma toplar)
function scheduleWrite() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => { writeTimer = null; writeFile(false); }, 2000);
}

function setupNotificationWs(server) {
    loadNotifications(); // diskteki 1 günlük geçmişi yükle

    // Saatte bir eskimişleri temizle (yeni bildirim gelmese de)
    setInterval(() => {
        const before = notifications.length;
        notifications = prune(notifications);
        if (notifications.length !== before) scheduleWrite();
    }, 60 * 60 * 1000);

    notificationWss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

    server.on('upgrade', (req, socket, head) => {
        if (req.url.startsWith('/ws/notifications')) {
            notificationWss.handleUpgrade(req, socket, head, (ws) => {
                notificationWss.emit('connection', ws, req);
            });
        }
    });

    notificationWss.on('connection', (ws, req) => {
        const user = authenticateWs(req);
        if (!user) {
            ws.close(4001, 'Authentication required');
            return;
        }
        ws.userId = user.id;
        ws.userRole = user.role;
        // Bağlanınca 1 günlük geçmişi gönder (eskimişleri eleyerek)
        ws.send(JSON.stringify({ type: 'history', data: prune(notifications).slice(-100) }));
    });

    return notificationWss;
}

function addNotification(notification) {
    const entry = {
        id: nextId(),
        timestamp: new Date().toISOString(),
        read: false,
        ...notification
    };

    notifications.push(entry);
    notifications = prune(notifications);
    if (notifications.length > MAX_NOTIFICATIONS) {
        notifications = notifications.slice(-MAX_NOTIFICATIONS);
    }
    scheduleWrite();

    if (notificationWss) {
        const msg = JSON.stringify({ type: 'notification', data: entry });
        notificationWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(msg);
        });
    }

    return entry;
}

function getNotifications(limit = 50) {
    return prune(notifications).slice(-limit).reverse();
}

// Kapanışta senkron yaz (debounce timer'ı fırlamadan süreç bitmesin)
function flushNotifications() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    writeFile(true);
}

module.exports = { setupNotificationWs, addNotification, getNotifications, flushNotifications };
