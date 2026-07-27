const ping = require('ping');
const store = require('../utils/memoryStore');
const config = require('../config');

// Aynı anda en fazla kaç cihaz ping'lensin (OS ping süreç yığılmasını önler)
const PING_CONCURRENCY = 20;

let pingTimer = null;
let stopped = false;
let running = false;
const lastPingAt = {}; // cihaz id → son ping zamanı (healthIntervalSec için)
const failCount = {};  // cihaz id → ardışık başarısız ping sayısı (flap damping)
const statusChangeListeners = [];

function onStatusChange(callback) {
    statusChangeListeners.push(callback);
    return () => {
        const idx = statusChangeListeners.indexOf(callback);
        if (idx > -1) statusChangeListeners.splice(idx, 1);
    };
}

// Sınırlı eşzamanlılıkla iş havuzu
async function runPool(items, worker, concurrency) {
    let idx = 0;
    const n = Math.min(concurrency, items.length);
    const runners = Array.from({ length: n }, async () => {
        while (idx < items.length) {
            const item = items[idx++];
            await worker(item);
        }
    });
    await Promise.all(runners);
}

async function pingCycle() {
    const now = Date.now();
    // Sadece "zamanı gelen" cihazları ping'le (per-cihaz healthIntervalSec'e saygı)
    const due = store.getSwitches().filter(s => {
        if (s.type === 'cloud') return false;
        const interval = s.healthIntervalSec ? s.healthIntervalSec * 1000 : config.PING_INTERVAL;
        return (now - (lastPingAt[s.id] || 0)) >= interval - 500; // 500ms tolerans
    });
    if (due.length === 0) return;

    const pingResults = {};
    const statusChanges = [];
    const isWin = process.platform === 'win32';

    await runPool(due, async (s) => {
        lastPingAt[s.id] = Date.now();

        // 1) Ölçüm — probe hatası da başarısız deneme sayılır
        let alive = false;
        let latency = -1;
        try {
            const res = await ping.promise.probe(s.ip, { timeout: 2, extra: isWin ? ['-n', '1'] : ['-c', '1'] });
            alive = !!res.alive;
            if (alive) latency = res.time === 'unknown' ? -1 : Math.round(res.time);
        } catch (e) {
            alive = false;
        }

        // 2) Karar — klasik NMS: tek kayıp paket DOWN yapmaz.
        // DOWN için ardışık PING_FAIL_THRESHOLD başarısızlık gerekir (soft-fail penceresinde
        // cihaz mevcut durumunu korur); ilk başarılı ping'de anında UP'a döner.
        let status;
        if (alive) {
            failCount[s.id] = 0;
            status = 'UP';
        } else {
            failCount[s.id] = (failCount[s.id] || 0) + 1;
            status = failCount[s.id] >= config.PING_FAIL_THRESHOLD
                ? 'DOWN'
                : (s.status || 'DOWN'); // eşik altında: durumu değiştirme
        }

        pingResults[s.id] = { status, latency };

        // 3) Bildirim yalnızca GERÇEK geçişte (soft-fail sırasında değil)
        if (s.status !== status) {
            statusChanges.push({
                deviceId: s.id, deviceName: s.name, deviceIp: s.ip,
                topologyPage: s.topologyPage || 'main', // bildirimde sayfa adı için
                previousStatus: s.status, newStatus: status,
                timestamp: new Date().toISOString()
            });
        }
        // Geçmişe ham ölçüm yazılır (-1 = kayıp) → paket kaybı grafikte görünür
        const ts = Date.now();
        store.appendHistory(s.id, { switchId: s.id, timestamp: ts, value: latency });
        store.appendRollup(s.id, ts, latency); // uzun aralik (1W/1M) icin 5dk ozet
    }, PING_CONCURRENCY);

    store.updatePingResults(pingResults);

    for (const change of statusChanges) {
        for (const listener of statusChangeListeners) {
            try { listener(change); } catch (e) { /* ignore */ }
        }
    }
}

function startPingService() {
    if (pingTimer || running) return;
    stopped = false;

    // Kendini-zamanlayan döngü: bir tur TAMAMEN bitmeden sonraki başlamaz
    // (setInterval'in yavaş turda üst üste binme/yığılma sorununu önler).
    const loop = async () => {
        if (stopped) return;
        running = true;
        try { await pingCycle(); }
        catch (e) { console.error('[PING] Döngü hatası:', e.message); }
        running = false;
        if (!stopped) pingTimer = setTimeout(loop, config.PING_INTERVAL);
    };
    loop();

    console.log(`[PING] Servis başlatıldı (taban ${config.PING_INTERVAL}ms, eşzamanlılık ${PING_CONCURRENCY})`);
}

function stopPingService() {
    stopped = true;
    if (pingTimer) { clearTimeout(pingTimer); pingTimer = null; }
}

module.exports = { startPingService, stopPingService, onStatusChange };
