// Cisco PSIRT openVuln API + CISA KEV istemcisi — SUNUCU tarafi (cevrimici senkron).
// tools/vuln-feed/vuln-feed.mjs ile ayni feed semasini (schema 1) uretir; boylece
// buildOverview iki kaynagi da ayni sekilde tuketir.
//
// Erisim gereksinimi (egress): id.cisco.com (token), apix.cisco.com (API),
// www.cisa.gov (KEV, istege bagli). testConnection() hangi host'un takildigini
// tek tek raporlar — kapali agda en sik sorun DNS/egress kuralidir.

const TOKEN_URL = 'https://id.cisco.com/oauth2/default/v1/token';
const API = 'https://apix.cisco.com/security/advisories/v2';
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const HOSTS = ['id.cisco.com', 'apix.cisco.com', 'www.cisa.gov'];
const DELAY_MS = 250;      // ~4 istek/sn (Cisco limiti 5/sn)
const SUMMARY_MAX = 600;
const TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// fetch + zaman asimi; ag hatasini okunur mesaja cevir (ENOTFOUND → "DNS/egress")
async function http(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
        const cause = e && e.cause ? e.cause : e;
        const code = (cause && cause.code) || (e.name === 'AbortError' ? 'TIMEOUT' : '');
        const host = (() => { try { return new URL(url).host; } catch { return url; } })();
        const hint = code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'DNS çözülemedi — egress/DNS kuralı?'
            : code === 'ECONNREFUSED' || code === 'ECONNRESET' ? 'bağlantı reddedildi — güvenlik duvarı?'
            : code === 'TIMEOUT' ? 'zaman aşımı — güvenlik duvarı paketi düşürüyor olabilir'
            : (cause && cause.message) || e.message;
        const err = new Error(`${host}: ${hint}`);
        err.host = host; err.code = code;
        throw err;
    } finally { clearTimeout(t); }
}

async function getToken({ clientId, clientSecret }) {
    const res = await http(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
        const msg = body.error_description || body.errorSummary || body.error || `HTTP ${res.status}`;
        throw new Error(`id.cisco.com token alınamadı: ${msg}`);
    }
    return body.access_token;
}

// Tek surum icin tum sayfalar. 404 NO_DATA_FOUND = etkileyen duyuru yok (temiz).
async function queryVersion(token, osType, version) {
    const all = [];
    for (let page = 1; page <= 20; page++) {
        await sleep(DELAY_MS);
        const url = `${API}/OSType/${encodeURIComponent(osType)}?version=${encodeURIComponent(version)}&pageSize=100&pageIndex=${page}`;
        const res = await http(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (res.status === 404) {
            const code = String(body.errorCode || '');
            if (/INVALID/i.test(code)) return { status: 'invalid_version', error: body.errorMessage || code };
            return page === 1 ? { status: 'no_data', advisories: [] } : { status: 'ok', advisories: all };
        }
        if (res.status === 429) { await sleep(3000); page--; continue; }
        if (res.status === 401 || res.status === 403) return { status: 'error', error: `apix.cisco.com ${res.status}: kimlik reddedildi (API uygulamasında "PSIRT openVuln API" seçili mi?)` };
        if (!res.ok) return { status: 'error', error: `apix.cisco.com ${res.status} ${body.errorMessage || body.errorCode || ''}`.trim() };
        const list = Array.isArray(body.advisories) ? body.advisories : [];
        all.push(...list);
        if (list.length < 100) break;
    }
    return { status: 'ok', advisories: all };
}

const normSir = (s) => { const x = String(s || '').trim().toLowerCase(); return x === 'critical' ? 'Critical' : x === 'high' ? 'High' : x === 'medium' ? 'Medium' : x === 'low' ? 'Low' : 'Informational'; };
// API bazi alanlari "a, b" dizgesi, bazilarini dizi dondurur
function toArray(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
    return String(v).split(/[,\n]/).map(x => x.trim()).filter(x => x && x !== 'NA');
}
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function normalizeAdvisory(a) {
    const cvss = parseFloat(a.cvssBaseScore);
    return {
        id: a.advisoryId,
        title: String(a.advisoryTitle || '').trim(),
        sir: normSir(a.sir),
        cvss: Number.isFinite(cvss) ? cvss : null,
        cves: toArray(a.cves).filter(c => /^CVE-\d{4}-\d+$/i.test(c)).map(c => c.toUpperCase()),
        bugIds: toArray(a.bugIDs),
        cwe: toArray(a.cwe).join(', '),
        firstPublished: a.firstPublished || null,
        lastUpdated: a.lastUpdated || null,
        url: a.publicationUrl || '',
        products: toArray(a.productNames).slice(0, 40),
        summary: stripHtml(a.summary).slice(0, SUMMARY_MAX),
        firstFixed: {},
    };
}

async function fetchKev(wantedCves) {
    const res = await http(KEV_URL, { headers: { Accept: 'application/json' }, timeout: 60000 });
    if (!res.ok) throw new Error(`www.cisa.gov HTTP ${res.status}`);
    const kev = await res.json();
    const list = Array.isArray(kev.vulnerabilities) ? kev.vulnerabilities : [];
    const cves = {};
    for (const k of list) if (wantedCves.has(k.cveID)) cves[k.cveID] = { dateAdded: k.dateAdded, dueDate: k.dueDate, ransomware: k.knownRansomwareCampaignUse, product: k.product, name: k.vulnerabilityName };
    return { fetchedAt: new Date().toISOString(), count: list.length, catalogVersion: kev.catalogVersion || null, cves };
}

/**
 * Envanterden (vulnService.buildInventory) feed uret. Bir surumun hatasi digerlerini
 * durdurmaz; her surumun status'u feed'e yazilir. KEV alinamazsa feed KEV'siz doner
 * (warnings'te belirtilir).
 */
async function buildFeed(inventory, creds, { withKev = true, onProgress } = {}) {
    const token = await getToken(creds);
    const feed = {
        schema: 1, generatedAt: new Date().toISOString(), tool: 'netpulse-server-sync/1.0',
        inventoryGeneratedAt: inventory.generatedAt || null, versions: {}, advisories: {}, kev: null, warnings: [],
    };
    for (const v of inventory.versions) {
        const entry = { osType: v.osType, query: v.query, display: v.display, status: 'error', advisories: [], error: null, fetchedAt: new Date().toISOString() };
        feed.versions[v.key] = entry;
        const candidates = [v.query, ...(v.altQueries || [])];
        for (let i = 0; i < candidates.length; i++) {
            const q = candidates[i];
            let r;
            try { r = await queryVersion(token, v.osType, q); }
            catch (e) { r = { status: 'error', error: e.message }; }
            if (r.status === 'invalid_version' && i < candidates.length - 1) continue; // sonraki yazimi dene
            entry.status = r.status; entry.error = r.error || null; entry.queried = q;
            if (r.status === 'ok') {
                for (const a of r.advisories) {
                    if (!a.advisoryId) continue;
                    const cur = feed.advisories[a.advisoryId] || (feed.advisories[a.advisoryId] = normalizeAdvisory(a));
                    cur.firstFixed[v.key] = toArray(a.firstFixed);
                    entry.advisories.push(a.advisoryId);
                }
            }
            break;
        }
        if (onProgress) onProgress(v, entry);
    }
    if (withKev) {
        try {
            const wanted = new Set(Object.values(feed.advisories).flatMap(a => a.cves));
            feed.kev = await fetchKev(wanted);
        } catch (e) {
            feed.warnings.push(`KEV alınamadı: ${e.message}`);
        }
    }
    return feed;
}

/** Baglanti testi: her host icin ayri sonuc (UI'da satir satir gosterilir). */
async function testConnection(creds, sampleVersion) {
    const out = [];
    let token = null;
    try { token = await getToken(creds); out.push({ host: 'id.cisco.com', ok: true, message: 'token alındı' }); }
    catch (e) { out.push({ host: 'id.cisco.com', ok: false, message: e.message }); }
    if (token) {
        const s = sampleVersion || { osType: 'ios', query: '15.2(7)E9' };
        try {
            const r = await queryVersion(token, s.osType, s.query);
            out.push({ host: 'apix.cisco.com', ok: r.status !== 'error', message: r.status === 'ok' ? `${r.advisories.length} duyuru (${s.query})` : r.status === 'no_data' ? `temiz (${s.query})` : r.error || r.status });
        } catch (e) { out.push({ host: 'apix.cisco.com', ok: false, message: e.message }); }
    } else {
        out.push({ host: 'apix.cisco.com', ok: false, message: 'token olmadan denenmedi' });
    }
    try {
        let res = await http(KEV_URL, { method: 'HEAD', timeout: 15000 });
        if (res.status === 405 || res.status === 403) res = await http(KEV_URL, { method: 'GET', timeout: 60000 });
        out.push({ host: 'www.cisa.gov', ok: res.ok, message: res.ok ? 'KEV erişilebilir' : `HTTP ${res.status}` });
    } catch (e) { out.push({ host: 'www.cisa.gov', ok: false, message: e.message + ' (KEV isteğe bağlı)' }); }
    return out;
}

module.exports = { buildFeed, testConnection, getToken, queryVersion, HOSTS, TOKEN_URL, API, KEV_URL };
