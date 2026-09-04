#!/usr/bin/env node
/**
 * NetPulse zafiyet feed üretici — INTERNETLİ bir makinede çalışır.
 *
 *   node vuln-feed.mjs --inventory netpulse-vuln-inventory-YYYY-MM-DD.json --out netpulse-vuln-feed.json
 *
 * Girdi : NetPulse → Vulnerabilities → "Export inventory" dosyası
 * Çıktı : NetPulse → Vulnerabilities → "Import feed" ile yüklenecek dosya
 *
 * Kaynaklar
 *   - Cisco PSIRT openVuln API  (apix.cisco.com/security/advisories/v2/OSType/{ios|iosxe}?version=...)
 *   - CISA KEV (known exploited vulnerabilities) JSON — anahtar gerekmez
 *
 * Kimlik: CISCO_CLIENT_ID / CISCO_CLIENT_SECRET ortam değişkenleri YA DA bu klasörde
 * cisco-api.json  → { "clientId": "...", "clientSecret": "..." }   (gitignore'da)
 *
 * Bağımlılık yok; Node 18+ (global fetch).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN_URL = 'https://id.cisco.com/oauth2/default/v1/token';
const API = 'https://apix.cisco.com/security/advisories/v2';
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const DELAY_MS = 250;          // ~4 istek/sn — Cisco limitinin altında
const SUMMARY_MAX = 600;       // feed 1 MB sınırının altında kalsın

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.inventory) {
  console.log(`Kullanım: node vuln-feed.mjs --inventory <envanter.json> [--out <feed.json>] [--no-kev] [--creds <cisco-api.json>]`);
  process.exit(args.help ? 0 : 1);
}

const inventory = JSON.parse(readFileSync(resolve(args.inventory), 'utf8'));
if (inventory.schema !== 1 || !Array.isArray(inventory.versions)) die('Envanter dosyası tanınmadı (schema 1 bekleniyor).');
const outFile = resolve(args.out || `netpulse-vuln-feed-${new Date().toISOString().slice(0, 10)}.json`);

const creds = loadCreds(args.creds);
console.log(`Envanter: ${inventory.versions.length} sürüm (${inventory.system || 'NetPulse'}, ${inventory.generatedAt})`);

const token = await getToken(creds);
console.log('Cisco token alındı.');

const feed = { schema: 1, generatedAt: new Date().toISOString(), tool: 'netpulse-vuln-feed/1.0', inventoryGeneratedAt: inventory.generatedAt || null, versions: {}, advisories: {}, kev: null };

for (const v of inventory.versions) {
  const label = `${v.osType} ${v.query}`.padEnd(22);
  const entry = { osType: v.osType, query: v.query, display: v.display, status: 'error', advisories: [], error: null, fetchedAt: new Date().toISOString() };
  feed.versions[v.key] = entry;
  const candidates = [v.query, ...(v.altQueries || [])];
  for (const q of candidates) {
    const r = await queryVersion(v.osType, q);
    if (r.status === 'invalid_version' && q !== candidates[candidates.length - 1]) continue; // sonraki yazımı dene
    entry.status = r.status; entry.error = r.error || null; entry.queried = q;
    if (r.status === 'ok') {
      for (const a of r.advisories) {
        const id = a.advisoryId;
        if (!id) continue;
        const cur = feed.advisories[id] || (feed.advisories[id] = normalizeAdvisory(a));
        cur.firstFixed[v.key] = toArray(a.firstFixed);
        entry.advisories.push(id);
      }
    }
    break;
  }
  const msg = entry.status === 'ok' ? `${entry.advisories.length} duyuru` : entry.status === 'no_data' ? 'temiz (0)' : `${entry.status}${entry.error ? ': ' + entry.error : ''}`;
  console.log(`  ${label} ${v.devices} cihaz → ${msg}`);
}

if (!args['no-kev']) {
  try {
    const kev = await (await fetch(KEV_URL)).json();
    const list = Array.isArray(kev.vulnerabilities) ? kev.vulnerabilities : [];
    const wanted = new Set(Object.values(feed.advisories).flatMap(a => a.cves));
    const cves = {};
    for (const k of list) if (wanted.has(k.cveID)) cves[k.cveID] = { dateAdded: k.dateAdded, dueDate: k.dueDate, ransomware: k.knownRansomwareCampaignUse, product: k.product, name: k.vulnerabilityName };
    feed.kev = { fetchedAt: new Date().toISOString(), count: list.length, catalogVersion: kev.catalogVersion || null, cves };
    console.log(`CISA KEV: ${list.length} kayıt, bu ağla kesişen ${Object.keys(cves).length}.`);
  } catch (e) {
    console.warn(`CISA KEV alınamadı (${e.message}) — feed KEV bilgisi olmadan üretiliyor.`);
  }
}

const json = JSON.stringify(feed);
writeFileSync(outFile, json);
const kb = Math.round(json.length / 1024);
console.log(`\nFeed yazıldı: ${outFile}  (${Object.keys(feed.advisories).length} duyuru, ${kb} KB)`);
if (kb > 900) console.warn('UYARI: feed ~1 MB sınırına yakın; NetPulse içe aktarma sınırı 1 MB.');
console.log('Sıradaki adım: NetPulse → Vulnerabilities → Import feed');

// ---------------------------------------------------------------------------
async function getToken({ clientId, clientSecret }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) die(`Token alınamadı (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

// Tek sürüm için tüm sayfalar. 404 NO_DATA_FOUND = etkileyen duyuru yok (temiz).
async function queryVersion(osType, version) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    await sleep(DELAY_MS);
    const url = `${API}/OSType/${encodeURIComponent(osType)}?version=${encodeURIComponent(version)}&pageSize=100&pageIndex=${page}`;
    let res;
    try { res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }); }
    catch (e) { return { status: 'error', error: e.message }; }
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) {
      const code = String(body.errorCode || '');
      if (/INVALID/i.test(code)) return { status: 'invalid_version', error: body.errorMessage || code };
      return page === 1 ? { status: 'no_data', advisories: [] } : { status: 'ok', advisories: all };
    }
    if (res.status === 429) { await sleep(3000); page--; continue; }
    if (!res.ok) return { status: 'error', error: `${res.status} ${body.errorMessage || body.errorCode || ''}`.trim() };
    const list = Array.isArray(body.advisories) ? body.advisories : [];
    all.push(...list);
    if (list.length < 100) break;
  }
  return { status: 'ok', advisories: all };
}

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
function normSir(s) { const x = String(s || '').trim().toLowerCase(); return x === 'critical' ? 'Critical' : x === 'high' ? 'High' : x === 'medium' ? 'Medium' : x === 'low' ? 'Low' : 'Informational'; }
// API bazı alanları "a, b" dizgesi, bazılarını dizi döndürüyor
function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v).split(/[,\n]/).map(x => x.trim()).filter(x => x && x !== 'NA');
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function loadCreds(file) {
  if (process.env.CISCO_CLIENT_ID && process.env.CISCO_CLIENT_SECRET) return { clientId: process.env.CISCO_CLIENT_ID, clientSecret: process.env.CISCO_CLIENT_SECRET };
  const f = resolve(file || join(HERE, 'cisco-api.json'));
  if (!existsSync(f)) die(`Cisco API kimliği yok. CISCO_CLIENT_ID/CISCO_CLIENT_SECRET tanımlayın ya da ${f} oluşturun.`);
  const c = JSON.parse(readFileSync(f, 'utf8'));
  if (!c.clientId || !c.clientSecret) die('cisco-api.json içinde clientId ve clientSecret olmalı.');
  return c;
}
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v && !v.startsWith('--')) { o[k] = v; i++; } else o[k] = true; }
  }
  return o;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function die(msg) { console.error('✗ ' + msg); process.exit(1); }
