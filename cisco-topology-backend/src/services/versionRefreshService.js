const store = require('../utils/memoryStore');
const { probeInventory } = require('./snmpService');
const { isBlockedIP } = require('../utils/validation');

// Cihaz envanterini (yazılım sürümü + seri numarası + SNMP modeli) periyodik okur ve
// cihaz kaydına yazar. Sürüm: Devices listesinin sıralaması. Seri/model: Devices
// aramasının seri no ile çalışması ve detay kartı — cihaz detayı hiç açılmasa da dolar.
// Bu alanlar nadiren değiştiği için aralık geniş tutulur; yük ping/backup ile aynı havuz desenidir.
const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 saat
const CONCURRENCY = 8;                    // aynı anda en fazla SNMP oturumu
const FIRST_RUN_DELAY = 90 * 1000;        // ilk ping turu status'ü belirlesin diye 90sn bekle

let timer = null;
let running = false;
let stopped = false;

async function runPool(items, worker, concurrency) {
    let idx = 0;
    const n = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: n }, async () => {
        while (idx < items.length) { const item = items[idx++]; await worker(item); }
    }));
}

async function refreshVersions() {
    if (running) return { total: 0, updated: 0 };
    running = true;
    try {
        // Yalnızca UP + SNMP community'si olan gerçek cihazlar (DOWN/cloud atlanır)
        const devices = store.getSwitches().filter(s =>
            s.snmpCommunity && s.type !== 'cloud' && s.status === 'UP' && !isBlockedIP(s.ip));
        if (devices.length === 0) return { total: 0, updated: 0 };

        let updated = 0;
        await runPool(devices, async (d) => {
            const inv = await probeInventory(d);
            const patch = {};
            if (inv.version && inv.version !== d.version) patch.version = inv.version;
            if (inv.serial && inv.serial !== d.serial) patch.serial = inv.serial;
            // SNMP modeli AYRI alanda tutulur: elle girilen `model` her zaman öncelikli,
            // arka plan onu asla ezmez (cihaz detayı da aynı sırayı uygular).
            if (inv.model && inv.model !== d.snmpModel) patch.snmpModel = inv.model;
            // Boş dönen alan yazılmaz → SNMP sonradan düşse de son bilinen değer kalır.
            if (Object.keys(patch).length) {
                store.updateSwitch(d.id, patch);
                updated++;
            }
        }, CONCURRENCY);

        if (updated) console.log(`[VERSION] ${updated}/${devices.length} cihaz envanteri güncellendi (sürüm/seri/model)`);
        return { total: devices.length, updated };
    } catch (e) {
        console.error('[VERSION] Yenileme hatası:', e.message);
        return { total: 0, updated: 0 };
    } finally {
        running = false;
    }
}

function startVersionRefresh() {
    if (timer) return;
    stopped = false;
    // Kendini-zamanlayan döngü (yavaş turda üst üste binmeyi önler)
    const loop = () => {
        timer = setTimeout(async () => {
            if (stopped) return;
            await refreshVersions();
            if (!stopped) loop();
        }, REFRESH_INTERVAL);
    };
    setTimeout(() => {
        if (stopped) return;
        refreshVersions().catch(() => {});
        loop();
    }, FIRST_RUN_DELAY);
    console.log(`[VERSION] Sürüm yenileme zamanlayıcısı başladı (${REFRESH_INTERVAL / 60000} dk'da bir)`);
}

function stopVersionRefresh() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
}

module.exports = { startVersionRefresh, stopVersionRefresh, refreshVersions };
