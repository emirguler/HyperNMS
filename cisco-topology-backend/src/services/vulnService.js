const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('../utils/memoryStore');
const { addNotification } = require('./notificationService');

// Zafiyet yonetimi (Cisco PSIRT openVuln + CISA KEV) — OFFLINE feed modeli.
//
// Sunucu internete cikamiyor. Bu yuzden:
//   1) /vuln/inventory  → agdaki FARKLI (osType, surum) ciftlerini disari verir
//   2) tools/vuln-feed  → internetli bir makinede Cisco API'sini sorar, feed uretir
//   3) /vuln/feed       → feed buraya yuklenir; eslestirme SUNUCUDA, cihaz kaydiyla yapilir
//
// Eslestirme anahtari: "<osType>|<query>" — parseVersion() hem envanter cikarirken hem
// feed'i cihazlara baglarken AYNI fonksiyondur; iki taraf ayrismaz.

const FEED_FILE = path.join(config.DATA_DIR, 'vuln_feed.json');
const STATE_FILE = path.join(config.DATA_DIR, 'vuln_state.json');
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational'];
// Cisco IOS/IOS-XE kosan cihaz tipleri. Anten/cloud/pc/server kapsam disi.
const CISCO_TYPES = new Set(['switch', 'router', 'firewall']);

let feed = null;             // yuklu feed (tools/vuln-feed ciktisi) ya da null
let state = { acks: {} };    // acks: { advisoryId: { by, at, note } }

function readJson(file, fallback) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error(`[VULN] ${path.basename(file)} okunamadi:`, e.message); }
    return fallback;
}
function writeJson(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
}
function load() {
    feed = readJson(FEED_FILE, null);
    state = readJson(STATE_FILE, { acks: {} });
    if (!state || typeof state !== 'object') state = { acks: {} };
    if (!state.acks) state.acks = {};
    if (feed) console.log(`[VULN] Feed yuklendi: ${Object.keys(feed.advisories || {}).length} duyuru, ${Object.keys(feed.versions || {}).length} surum (feed ${feed.generatedAt || '?'})`);
}
load();

/**
 * Cihaz kaydindaki surum dizgesinden (entPhysicalSoftwareRev / sysDescr turevi)
 * openVuln'un bekledigi (osType, version) ciftini cikar.
 *   "15.2(4)E7"                 → ios,   "15.2(4)E7"
 *   "12.2(55)SE12"              → ios,   "12.2(55)SE12"
 *   "17.06.04(CAT9K_IOSXE)"     → iosxe, "17.6.4"   (Cisco API sifirsiz ister; altQueries'te dolgulu hali de var)
 *   "16.12.04" / "17.3.4b"      → iosxe, "16.12.4" / "17.3.4b"
 *   "03.06.05E"                 → iosxe, "3.6.5E"   (eski Cat3650/3850 XE 3.x)
 *   Allied "5.5.1-2.3" vb.      → other (kapsam disi)
 */
function parseVersion(raw) {
    const s = String(raw || '').trim();
    if (!s) return { osType: 'none', query: '', display: '', altQueries: [] };
    const xeTag = /IOS[- ]?XE/i.test(s);

    // Klasik IOS: 15.2(4)E7 / 12.2(55)SE12 / 15.0(2)SE11
    let m = s.match(/(\d{1,2}\.\d{1,2}\(\d+[A-Za-z]?\)[0-9A-Za-z]*)/);
    if (m && !xeTag) return { osType: 'ios', query: m[1], display: m[1], altQueries: [] };

    // IOS-XE: 3 parcali (16.x+ ya da 3.x), sonda 1-2 harf olabilir (17.3.4b, 3.6.5E)
    m = s.match(/(?:^|[^\d.])(\d{1,2})\.(\d{1,2})\.(\d{1,2})([A-Za-z]{0,2})(?![\d.])/);
    if (m) {
        const major = parseInt(m[1], 10);
        const suffix = m[4] || '';
        const bare = `${major}.${parseInt(m[2], 10)}.${parseInt(m[3], 10)}${suffix}`;
        const padded = `${m[1]}.${m[2]}.${m[3]}${suffix}`;
        if (major >= 16 || xeTag) return { osType: 'iosxe', query: bare, display: bare, altQueries: padded !== bare ? [padded] : [] };
        if (major === 3) {
            const q = bare.toUpperCase(), alt = padded.toUpperCase();
            return { osType: 'iosxe', query: q, display: q, altQueries: alt !== q ? [alt] : [] };
        }
    }
    return { osType: 'other', query: s.slice(0, 40), display: s.slice(0, 40), altQueries: [] };
}
const keyOf = (p) => `${p.osType}|${p.query}`;

// Kapsamdaki cihazlar: Cisco olmasi beklenen tipler. (Vendor kayitta kalici degil;
// surum bicimi ios/iosxe olarak cozuluyorsa Cisco kabul edilir.)
function cisco(devices) { return devices.filter(d => CISCO_TYPES.has(d.type || 'switch')); }

/** Envanter: feed uretici aracin sorgulayacagi tekil (osType, surum) listesi. */
function buildInventory() {
    const general = (store.getSettings() || {}).general || {};
    const groups = {};
    const skipped = { noVersion: 0, otherOs: 0, nonCisco: 0 };
    for (const d of store.getSwitches()) {
        if (!CISCO_TYPES.has(d.type || 'switch')) { skipped.nonCisco++; continue; }
        const p = parseVersion(d.version);
        if (p.osType === 'none') { skipped.noVersion++; continue; }
        if (p.osType === 'other') { skipped.otherOs++; continue; }
        const k = keyOf(p);
        const g = groups[k] || (groups[k] = { key: k, osType: p.osType, query: p.query, display: p.display, altQueries: p.altQueries, devices: 0, models: new Set(), rawSamples: new Set() });
        g.devices++;
        if (d.model || d.snmpModel) g.models.add(d.model || d.snmpModel);
        if (g.rawSamples.size < 3) g.rawSamples.add(String(d.version));
    }
    return {
        schema: 1,
        generatedAt: new Date().toISOString(),
        system: general.systemName || 'NetPulse',
        versions: Object.values(groups)
            .map(g => ({ ...g, models: [...g.models].sort(), rawSamples: [...g.rawSamples] }))
            .sort((a, b) => b.devices - a.devices),
        skipped,
    };
}

function validateFeed(obj) {
    if (!obj || typeof obj !== 'object') return 'Feed is not an object';
    if (obj.schema !== 1) return 'Unsupported feed schema (expected 1)';
    if (!obj.versions || typeof obj.versions !== 'object') return 'Feed has no "versions"';
    if (!obj.advisories || typeof obj.advisories !== 'object') return 'Feed has no "advisories"';
    for (const [id, a] of Object.entries(obj.advisories)) {
        if (!a || typeof a !== 'object' || !a.id) return `Advisory ${id} is malformed`;
    }
    return null;
}

/**
 * Feed'i yukle + kaydet. Onceki feed'e gore YENI olan ve bu agda en az bir cihazi
 * etkileyen Critical/High/KEV duyurular icin bildirim uretir (en fazla 10 + ozet).
 */
function importFeed(obj, user) {
    const err = validateFeed(obj);
    if (err) throw new Error(err);
    const prevIds = new Set(Object.keys((feed && feed.advisories) || {}));
    feed = { ...obj, importedAt: new Date().toISOString(), importedBy: (user && user.username) || 'admin' };
    writeJson(FEED_FILE, feed);

    // Bildirim: yeni ve etkileyen duyurular
    const ov = buildOverview();
    const kev = feed.kev && feed.kev.cves ? feed.kev.cves : {};
    const fresh = ov.advisories
        .filter(a => !prevIds.has(a.id) && a.deviceCount > 0 && !a.acked)
        .filter(a => a.sir === 'Critical' || a.sir === 'High' || a.cves.some(c => kev[c]))
        .sort((a, b) => (b.cvss || 0) - (a.cvss || 0));
    const shown = fresh.slice(0, 10);
    for (const a of shown) {
        addNotification({
            type: 'alert',
            severity: (a.sir === 'Critical' || a.kev) ? 'critical' : 'warning',
            title: `Security advisory: ${a.sir}${a.kev ? ' · exploited' : ''} — ${a.deviceCount} device(s)`,
            message: `${a.id}: ${a.title}`,
        });
    }
    if (fresh.length > shown.length) {
        addNotification({ type: 'info', severity: 'warning', title: `${fresh.length - shown.length} more new security advisories`, message: 'See Vulnerabilities page' });
    }
    return { advisories: Object.keys(feed.advisories).length, versions: Object.keys(feed.versions).length, newRelevant: fresh.length };
}

function clearFeed() {
    feed = null;
    try { if (fs.existsSync(FEED_FILE)) fs.unlinkSync(FEED_FILE); } catch (e) { /* ignore */ }
}

function setAck(advisoryId, user, note) {
    state.acks[advisoryId] = { by: (user && user.username) || 'admin', at: new Date().toISOString(), note: String(note || '').slice(0, 300) };
    writeJson(STATE_FILE, state);
}
function clearAck(advisoryId) {
    delete state.acks[advisoryId];
    writeJson(STATE_FILE, state);
}

const sevRank = (s) => { const i = SEVERITIES.indexOf(s); return i === -1 ? SEVERITIES.length : i; };
const emptyCounts = () => ({ Critical: 0, High: 0, Medium: 0, Low: 0, Informational: 0 });

function feedMeta() {
    if (!feed) return { loaded: false };
    const gen = Date.parse(feed.generatedAt || '') || null;
    return {
        loaded: true,
        generatedAt: feed.generatedAt || null,
        importedAt: feed.importedAt || null,
        importedBy: feed.importedBy || null,
        staleDays: gen ? Math.floor((Date.now() - gen) / 86400000) : null,
        advisoryCount: Object.keys(feed.advisories || {}).length,
        versionCount: Object.keys(feed.versions || {}).length,
        kevCount: feed.kev ? (feed.kev.count || Object.keys(feed.kev.cves || {}).length) : null,
        tool: feed.tool || null,
    };
}

/**
 * Tum sayfa verisi: ozet + surume gore + cihazlar + ilgili duyurular.
 * Ack'lenmis duyurular sayimlardan DUSULUR ama listede "acked" ile gelir (UI toggle).
 */
function buildOverview() {
    const devices = store.getSwitches();
    const kevMap = (feed && feed.kev && feed.kev.cves) || {};
    const acks = state.acks || {};
    const advMap = (feed && feed.advisories) || {};
    const verMap = (feed && feed.versions) || {};

    const byVersion = {};
    const devRows = [];
    const advDevices = {}; // advisoryId → Set(deviceId)
    const summary = { counts: emptyCounts(), kev: 0, affectedDevices: 0, cleanDevices: 0, unknownDevices: 0, notCovered: 0, noVersion: 0, totalCisco: 0, acked: Object.keys(acks).length };

    for (const d of devices) {
        const type = d.type || 'switch';
        const base = { id: d.id, name: d.name, ip: d.ip, model: d.model || d.snmpModel || '', type, version: d.version || '', topologyPage: d.topologyPage || 'main', status: d.status };
        if (!CISCO_TYPES.has(type)) { summary.notCovered++; continue; }
        summary.totalCisco++;
        const p = parseVersion(d.version);
        if (p.osType === 'none') { summary.noVersion++; devRows.push({ ...base, scan: 'no-version', counts: emptyCounts(), advisories: [], worstCvss: null, kev: 0 }); continue; }
        if (p.osType === 'other') { summary.notCovered++; devRows.push({ ...base, scan: 'not-covered', counts: emptyCounts(), advisories: [], worstCvss: null, kev: 0 }); continue; }
        const key = keyOf(p);
        const v = verMap[key];
        const g = byVersion[key] || (byVersion[key] = { key, osType: p.osType, display: p.display, devices: [], advisories: [], counts: emptyCounts(), kev: 0, worstCvss: null, fixedIn: new Set(), scan: v ? (v.status === 'ok' || v.status === 'no_data' ? 'ok' : 'unknown') : 'unknown' });
        g.devices.push({ id: d.id, name: d.name, ip: d.ip, model: base.model });

        if (!v || (v.status !== 'ok' && v.status !== 'no_data')) {
            summary.unknownDevices++;
            devRows.push({ ...base, key, scan: 'unknown', counts: emptyCounts(), advisories: [], worstCvss: null, kev: 0 });
            continue;
        }
        const ids = Array.isArray(v.advisories) ? v.advisories.filter(id => advMap[id]) : [];
        const active = ids.filter(id => !acks[id]);
        const counts = emptyCounts();
        let worst = null, kevN = 0;
        for (const id of active) {
            const a = advMap[id];
            if (counts[a.sir] != null) counts[a.sir]++;
            if (a.cvss != null && (worst == null || a.cvss > worst)) worst = a.cvss;
            if ((a.cves || []).some(c => kevMap[c])) kevN++;
            (advDevices[id] || (advDevices[id] = new Set())).add(d.id);
            const ff = a.firstFixed && a.firstFixed[key];
            if (Array.isArray(ff)) ff.forEach(x => g.fixedIn.add(x));
        }
        for (const id of ids.filter(id => acks[id])) (advDevices[id] || (advDevices[id] = new Set())).add(d.id);
        if (active.length) summary.affectedDevices++; else summary.cleanDevices++;
        devRows.push({ ...base, key, scan: active.length ? 'affected' : 'clean', counts, advisories: ids, worstCvss: worst, kev: kevN });
        // surum grubu: cihaz basina degil, surum basina bir kez
        if (!g._done) {
            g._done = true;
            g.advisories = ids;
            g.counts = counts; g.kev = kevN; g.worstCvss = worst;
        }
    }

    // Ozet sayimlari: SURUM basina degil, DUYURU basina (ayni duyuru 3 surumu etkiliyorsa 1 sayilir)
    const relevantIds = new Set(Object.keys(advDevices));
    for (const id of relevantIds) {
        const a = advMap[id]; if (!a || acks[id]) continue;
        if (summary.counts[a.sir] != null) summary.counts[a.sir]++;
        if ((a.cves || []).some(c => kevMap[c])) summary.kev++;
    }

    const advisories = [...relevantIds].map(id => {
        const a = advMap[id];
        const devIds = [...(advDevices[id] || [])];
        return {
            id, title: a.title || '', sir: a.sir || 'Informational', cvss: a.cvss ?? null,
            cves: a.cves || [], kev: (a.cves || []).some(c => kevMap[c]),
            kevInfo: (a.cves || []).filter(c => kevMap[c]).map(c => ({ cve: c, ...kevMap[c] })),
            firstPublished: a.firstPublished || null, lastUpdated: a.lastUpdated || null,
            url: a.url || '', summary: a.summary || '', products: a.products || [], bugIds: a.bugIds || [],
            firstFixed: a.firstFixed || {},
            deviceCount: devIds.length, deviceIds: devIds,
            acked: !!acks[id], ack: acks[id] || null,
        };
    }).sort((x, y) => (x.acked - y.acked) || (sevRank(x.sir) - sevRank(y.sir)) || ((y.cvss || 0) - (x.cvss || 0)) || (y.deviceCount - x.deviceCount));

    const byVersionList = Object.values(byVersion).map(g => {
        const { _done, ...rest } = g;
        return { ...rest, deviceCount: g.devices.length, fixedIn: [...g.fixedIn].sort().slice(0, 6) };
    }).sort((a, b) => (sevRank(worstSir(a.counts)) - sevRank(worstSir(b.counts))) || (b.deviceCount - a.deviceCount));

    return { feed: feedMeta(), summary, byVersion: byVersionList, devices: devRows, advisories };
}
function worstSir(counts) { for (const s of SEVERITIES) if (counts[s] > 0) return s; return 'None'; }

module.exports = { parseVersion, keyOf, buildInventory, importFeed, clearFeed, setAck, clearAck, buildOverview, feedMeta, SEVERITIES };
