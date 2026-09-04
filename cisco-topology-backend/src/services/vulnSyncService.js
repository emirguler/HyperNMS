const store = require('../utils/memoryStore');
const { decryptPassword } = require('../utils/crypto');
const vuln = require('./vulnService');
const cisco = require('./ciscoVulnClient');

// Cevrimici zafiyet senkronu: envanter (sunucu) → Cisco openVuln + KEV → importFeed.
// Ayarlar settings.vuln: { clientId, clientSecret(sifreli), autoSync, syncHour, lastSync }
// Gunluk zamanlayici (syncHour) + istege bagli "Sync now". Eszamanli calismaz.

let running = false;
let timer = null;

function readSettings() {
    const v = (store.getSettings() || {}).vuln || {};
    return {
        clientId: v.clientId || '',
        clientSecret: v.clientSecret || '',   // sifreli
        autoSync: v.autoSync === true,
        syncHour: Number.isInteger(v.syncHour) && v.syncHour >= 0 && v.syncHour <= 23 ? v.syncHour : 4,
        lastSync: v.lastSync || null,
    };
}
function saveLastSync(lastSync) {
    const cur = (store.getSettings() || {}).vuln || {};
    store.updateSettings({ vuln: { ...cur, lastSync } });
}
function creds() {
    const s = readSettings();
    if (!s.clientId || !s.clientSecret) return null;
    try { return { clientId: s.clientId, clientSecret: decryptPassword(s.clientSecret) }; }
    catch (e) { return null; }
}

function getStatus() {
    const s = readSettings();
    return { configured: !!(s.clientId && s.clientSecret), autoSync: s.autoSync, syncHour: s.syncHour, running, lastSync: s.lastSync, hosts: cisco.HOSTS };
}

async function runSync(user, { withKev = true } = {}) {
    if (running) throw new Error('Sync already running');
    const c = creds();
    if (!c) throw new Error('Cisco API credentials not configured (Settings → Vulnerability sync)');
    running = true;
    const startedAt = new Date().toISOString();
    try {
        const inventory = vuln.buildInventory();
        if (!inventory.versions.length) throw new Error('Inventory is empty — no Cisco IOS/IOS-XE versions known yet');
        console.log(`[VULN] Sync başladı: ${inventory.versions.length} sürüm`);
        const feed = await cisco.buildFeed(inventory, c, {
            withKev,
            onProgress: (v, e) => console.log(`[VULN]   ${v.osType} ${v.query} (${v.devices} cihaz) → ${e.status}${e.status === 'ok' ? ' ' + e.advisories.length : ''}${e.error ? ' ' + e.error : ''}`),
        });
        const r = vuln.importFeed(feed, user || { username: 'scheduler' });
        const errors = Object.values(feed.versions).filter(x => x.status === 'error').length;
        const lastSync = {
            at: new Date().toISOString(), startedAt, ok: true, by: (user && user.username) || 'scheduler',
            stats: { versions: inventory.versions.length, advisories: r.advisories, newRelevant: r.newRelevant, versionErrors: errors, kev: !!feed.kev },
            warnings: feed.warnings || [],
        };
        saveLastSync(lastSync);
        console.log(`[VULN] Sync bitti: ${r.advisories} duyuru, ${r.newRelevant} yeni ilgili, ${errors} sürüm hatalı`);
        return lastSync;
    } catch (e) {
        const lastSync = { at: new Date().toISOString(), startedAt, ok: false, by: (user && user.username) || 'scheduler', error: e.message };
        saveLastSync(lastSync);
        console.error('[VULN] Sync hatası:', e.message);
        throw e;
    } finally {
        running = false;
    }
}

function msUntilHour(hour) {
    const now = new Date();
    const next = new Date(now); next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
}

// Kendini yeniden kuran gunluk dongu. Saat ayari degisirse bir sonraki turda dikkate
// alinir (her tetiklemede readSettings). Kimlik yok / autoSync kapali → sessizce gecer.
function startVulnSync() {
    if (timer) return;
    const loop = () => {
        const s = readSettings();
        timer = setTimeout(async () => {
            const now = readSettings();
            if (now.autoSync && creds()) { try { await runSync(null); } catch (e) { /* lastSync'e yazildi */ } }
            loop();
        }, msUntilHour(s.syncHour));
    };
    loop();
    console.log(`[VULN] Zamanlayıcı hazır (günlük ${readSettings().syncHour}:00, autoSync=${readSettings().autoSync})`);
}
// Ayar kaydedilince zamanlayiciyi yeni saate gore yeniden kur
function rescheduleVulnSync() {
    if (timer) { clearTimeout(timer); timer = null; }
    startVulnSync();
}

module.exports = { runSync, getStatus, startVulnSync, rescheduleVulnSync, readSettings };
