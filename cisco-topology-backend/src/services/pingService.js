const ping = require('ping');
const store = require('../utils/memoryStore');
const config = require('../config');

let pingInterval = null;
const statusChangeListeners = [];

function onStatusChange(callback) {
    statusChangeListeners.push(callback);
    return () => {
        const idx = statusChangeListeners.indexOf(callback);
        if (idx > -1) statusChangeListeners.splice(idx, 1);
    };
}

function startPingService() {
    if (pingInterval) return;

    pingInterval = setInterval(async () => {
        const switches = store.getSwitches();
        const pingResults = {};
        const statusChanges = [];

        // Paralel ping at
        await Promise.all(switches.map(async (s) => {
            if (s.type === 'cloud') return;
            try {
                const isWin = process.platform === 'win32';
                const res = await ping.promise.probe(s.ip, { timeout: 2, extra: isWin ? ['-n', '1'] : ['-c', '1'] });
                const status = res.alive ? 'UP' : 'DOWN';
                const latency = res.time === 'unknown' ? -1 : Math.round(res.time);

                pingResults[s.id] = { status, latency };

                // Status değişikliği tespiti
                if (s.status !== status) {
                    statusChanges.push({
                        deviceId: s.id, deviceName: s.name, deviceIp: s.ip,
                        previousStatus: s.status, newStatus: status,
                        timestamp: new Date().toISOString()
                    });
                }

                // Ping history — cihaz başına ayrı dosya
                store.appendHistory(s.id, { switchId: s.id, timestamp: Date.now(), value: latency });
            } catch (e) {
                pingResults[s.id] = { status: 'DOWN', latency: -1 };
            }
        }));

        // Bellekteki switch verilerini güncelle (dosyaya debounce ile yazılır)
        store.updatePingResults(pingResults);

        // Durum değişikliği bildirimi
        for (const change of statusChanges) {
            for (const listener of statusChangeListeners) {
                try { listener(change); } catch (e) { /* ignore */ }
            }
        }
    }, config.PING_INTERVAL);

    console.log(`[PING] Servis başlatıldı (${config.PING_INTERVAL}ms aralıklarla)`);
}

function stopPingService() {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

module.exports = { startPingService, stopPingService, onStatusChange };
