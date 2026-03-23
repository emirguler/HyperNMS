const ping = require('ping');
const { readJSON, writeJSON, safeWriteJSON } = require('../utils/db');
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
        // Ping sonuçlarını topla (dosyaya dokunmadan)
        const switches = readJSON(config.DB_SWITCHES);
        const pingResults = {};

        await Promise.all(switches.map(async (s) => {
            if (s.type === 'cloud') return;
            try {
                const isWin = process.platform === 'win32';
                const res = await ping.promise.probe(s.ip, { timeout: 2, extra: isWin ? ['-n', '1'] : ['-c', '1'] });
                pingResults[s.id] = {
                    status: res.alive ? 'UP' : 'DOWN',
                    latency: res.time === 'unknown' ? -1 : Math.round(res.time)
                };
            } catch (e) {
                pingResults[s.id] = { status: 'DOWN', latency: -1 };
            }
        }));

        // Dosyayı TEKRAR oku (arada PUT olmuş olabilir) ve sadece status/latency güncelle
        const freshSwitches = readJSON(config.DB_SWITCHES);
        const history = readJSON(config.DB_HISTORY);
        let updated = false;
        const statusChanges = [];

        for (const s of freshSwitches) {
            const result = pingResults[s.id];
            if (!result) continue;

            const prevStatus = s.status;
            s.status = result.status;
            s.latency = result.latency;

            history.push({ switchId: s.id, timestamp: Date.now(), value: s.latency });

            if (prevStatus !== s.status) {
                updated = true;
                statusChanges.push({
                    deviceId: s.id,
                    deviceName: s.name,
                    deviceIp: s.ip,
                    previousStatus: prevStatus,
                    newStatus: s.status,
                    timestamp: new Date().toISOString()
                });
            } else if (Math.abs(s.latency - (s.lastLatency || 0)) > 5) {
                updated = true;
            }
            s.lastLatency = s.latency;
        }

        if (updated) writeJSON(config.DB_SWITCHES, freshSwitches);

        if (history.length > config.MAX_HISTORY) {
            await safeWriteJSON(config.DB_HISTORY, history.slice(-config.MAX_HISTORY));
        } else {
            await safeWriteJSON(config.DB_HISTORY, history);
        }

        for (const change of statusChanges) {
            for (const listener of statusChangeListeners) {
                try { listener(change); } catch (e) { /* ignore */ }
            }
        }
    }, config.PING_INTERVAL);

    console.log(`[PING] Servis başlatıldı (${config.PING_INTERVAL}ms aralıklarla)`);
}

function stopPingService() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

module.exports = { startPingService, stopPingService, onStatusChange };
