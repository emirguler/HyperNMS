const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('../utils/memoryStore');
const { runShowCommand } = require('./sshService');
const { isBlockedIP } = require('../utils/validation');

// Günlük "show running-config" yedeği. Cihaz başına son MAX_BACKUPS kaydı
// data/config-backups/<deviceId>.json içinde [{ timestamp, config }] olarak tutulur.
const BACKUP_DIR = path.join(config.DATA_DIR, 'config-backups');
const MAX_BACKUPS = 7;              // cihaz başına saklanan yedek sayısı
const BACKUP_CONCURRENCY = 8;       // aynı anda en fazla SSH oturumu (211 cihazda yığılmayı önler)
const STALE_MS = 20 * 3600 * 1000;  // startup catch-up: son yedek 20 saatten eskiyse (ya da yoksa) al

let backupTimer = null;
let running = false;

function ensureDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupFile(deviceId) { return path.join(BACKUP_DIR, `${deviceId}.json`); }

function readBackups(deviceId) {
    if (!/^[a-zA-Z0-9_-]+$/.test(deviceId)) return [];
    try {
        const f = backupFile(deviceId);
        if (!fs.existsSync(f)) return [];
        const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function writeBackups(deviceId, arr) {
    try {
        ensureDir();
        const f = backupFile(deviceId);
        const tmp = f + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(arr));
        fs.renameSync(tmp, f);
    } catch (e) { console.error(`[BACKUP] ${deviceId} yazilamadi:`, e.message); }
}

// Ham "show running-config" çıktısını temizle: baştaki komut yankısı ve sondaki prompt atılır,
// config gövdesi (ilk marker'dan son "end" satırına kadar) bırakılır.
function cleanConfig(raw) {
    const lines = String(raw || '').replace(/\r/g, '').split('\n');
    let endIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() === 'end') { endIdx = i; break; } }
    const body = endIdx >= 0 ? lines.slice(0, endIdx + 1) : lines;
    let startIdx = 0;
    for (let i = 0; i < body.length; i++) {
        if (/^(Building configuration|Current configuration|version |!|hostname )/.test(body[i].trim())) { startIdx = i; break; }
    }
    return body.slice(startIdx).join('\n').trim();
}

// Sınırlı eşzamanlılıkla iş havuzu (pingService'teki desenle aynı)
async function runPool(items, worker, concurrency) {
    let idx = 0;
    const n = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: n }, async () => {
        while (idx < items.length) { const item = items[idx++]; await worker(item); }
    }));
}

// Tek cihazı yedekle. true = başarılı kayıt.
async function backupDevice(device) {
    if (!device || !device.sshUsername || !device.sshPassword || isBlockedIP(device.ip)) return false;
    let raw;
    try { raw = await runShowCommand(device, 'show running-config'); }
    catch (e) { console.error(`[BACKUP] ${device.name} (${device.ip}) SSH hata: ${e.message}`); return false; }
    const conf = cleanConfig(raw);
    if (!conf || conf.length < 40) { console.warn(`[BACKUP] ${device.name}: bos/gecersiz config, atlandi`); return false; }
    const arr = readBackups(device.id);
    arr.push({ timestamp: Date.now(), config: conf });
    arr.sort((a, b) => a.timestamp - b.timestamp);
    while (arr.length > MAX_BACKUPS) arr.shift(); // yalnızca son MAX_BACKUPS tutulur
    writeBackups(device.id, arr);
    return true;
}

async function runBackups({ onlyStale = false } = {}) {
    if (running) { console.warn('[BACKUP] zaten calisiyor, atlandi'); return { total: 0, ok: 0 }; }
    running = true;
    try {
        const now = Date.now();
        // Yalnızca SSH bilgisi olan ve UP cihazlar (DOWN cihaza SSH boşuna 15sn timeout olur)
        let devices = store.getSwitches().filter(s =>
            s.sshUsername && s.sshPassword && s.type !== 'cloud' && s.status === 'UP' && !isBlockedIP(s.ip));
        if (onlyStale) {
            devices = devices.filter(s => {
                const arr = readBackups(s.id);
                const latest = arr.length ? arr[arr.length - 1].timestamp : 0;
                return (now - latest) > STALE_MS;
            });
        }
        if (devices.length === 0) return { total: 0, ok: 0 };
        console.log(`[BACKUP] ${devices.length} cihaz icin basliyor${onlyStale ? ' (yalnizca eskiler)' : ''}...`);
        let ok = 0;
        await runPool(devices, async (d) => { if (await backupDevice(d)) ok++; }, BACKUP_CONCURRENCY);
        console.log(`[BACKUP] Bitti: ${ok}/${devices.length} basarili`);
        return { total: devices.length, ok };
    } finally { running = false; }
}

// Metadata listesi (yeni -> eski); config gövdesi olmadan
function listBackups(deviceId) {
    return readBackups(deviceId)
        .map(b => ({ timestamp: b.timestamp, size: (b.config || '').length, lines: (b.config || '').split('\n').length }))
        .sort((a, b) => b.timestamp - a.timestamp);
}

function getBackup(deviceId, timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return null;
    return readBackups(deviceId).find(b => b.timestamp === ts) || null;
}

function msUntilHour(hour) {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
}

function startBackupScheduler() {
    const hour = config.CONFIG_BACKUP_HOUR;
    const scheduleNext = () => {
        const delay = msUntilHour(hour);
        backupTimer = setTimeout(async () => {
            try { await runBackups({ onlyStale: false }); } catch (e) { console.error('[BACKUP] gunluk hata:', e.message); }
            scheduleNext();
        }, delay);
    };
    scheduleNext();
    // Startup catch-up: yeni kurulum / uzun kapalılık sonrası boş kartları doldur.
    // onlyStale sık restart'ta (son yedek < 20sa) tekrar yedeklemez -> SSH spam olmaz.
    setTimeout(() => { runBackups({ onlyStale: true }).catch(() => {}); }, 60000);
    console.log(`[BACKUP] Zamanlayici basladi (her gun ${String(hour).padStart(2, '0')}:00, son ${MAX_BACKUPS} tutulur)`);
}

function stopBackupScheduler() { if (backupTimer) { clearTimeout(backupTimer); backupTimer = null; } }

module.exports = {
    startBackupScheduler, stopBackupScheduler, runBackups, backupDevice,
    listBackups, getBackup, MAX_BACKUPS,
};
