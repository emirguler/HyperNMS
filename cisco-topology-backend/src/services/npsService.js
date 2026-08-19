// NPS (Linux FreeRADIUS) yonetim servisi.
//
// Bir Linux NPS/FreeRADIUS sunucusuna SSH ile baglanip:
//   * /etc/freeradius/3.0/users dosyasini okur ve kayitlari parse eder,
//   * tek bir kaydin GSM (Calling-Station-ID) / Framed-IP-Address / Framed-Route
//     alanlarini duzenleyip dosyayi ATOMIK ve izin-koruyarak geri yazar,
//   * "service freeradius restart" komutunu calistirir.
//
// GUVENLIK:
//   * SSH sifresi ayarlarda AES-256-GCM ile sifreli tutulur (crypto.js); istemciye
//     asla donmez, yalnizca baglanirken cozulur.
//   * Yazilan degerler (gsm/ip/route) SFTP ile dosyaya gider — kabuk YOK, yani
//     komut enjeksiyonu mumkun degil. Ayrica siki regex ile dogrulanir; tirnak/
//     yeni satir gibi dosya yapisini kiracak karakterler reddedilir.
//   * Sonlandirma komutundaki dosya yollari SABIT; kullanici girdisi kabuga girmez.

const { Client } = require('ssh2');
const store = require('../utils/memoryStore');
const { decryptPassword } = require('../utils/crypto');
const { isValidHost, isBlockedIP } = require('../utils/validation');

const USERS_FILE = '/etc/freeradius/3.0/users';
const TMP_FILE = USERS_FILE + '.netpulse.tmp';
const BAK_FILE = USERS_FILE + '.netpulse.bak';
const RESTART_CMD = 'service freeradius restart';

// --- HTTP durum kodu tasiyan hata ---
function httpErr(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

function classifyErr(err) {
    if (err && err.level === 'client-authentication') return 'authentication failed (check username/password)';
    const code = err && err.code;
    if (code === 'ECONNREFUSED') return 'connection refused (is SSH running?)';
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENOTFOUND') return 'host unreachable';
    if (code === 'ETIMEDOUT') return 'connection timed out';
    return (err && err.message) || 'connection error';
}

// --- Ayarlar ---
function rawConfig() {
    return store.getSettings().nps || {};
}
function connConfig() {
    const c = rawConfig();
    return {
        host: c.host || '',
        port: Number(c.port) > 0 ? Number(c.port) : 22,
        username: c.username || '',
        password: c.password ? decryptPassword(c.password) : '',
    };
}

// --- Baglanti ---
// cfg verilmezse kayitli ayar kullanilir (Test uc'u form degerleriyle cagirir).
function connect(cfg) {
    cfg = cfg || connConfig();
    return new Promise((resolve, reject) => {
        if (!cfg.host || !cfg.username || !cfg.password) {
            return reject(httpErr(400, 'NPS SSH is not configured. Set it in Settings → NPS.'));
        }
        if (!isValidHost(cfg.host) || isBlockedIP(cfg.host)) {
            return reject(httpErr(400, 'NPS host is invalid or a reserved address'));
        }
        const conn = new Client();
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { conn.end(); } catch (e) { /* ignore */ }
            reject(httpErr(504, 'NPS connection timed out'));
        }, 15000);
        conn.on('ready', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(conn);
        });
        conn.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(httpErr(502, 'NPS SSH failed: ' + classifyErr(err)));
        });
        // Bazi sshd yapilandirmalari (PAM) yalnizca keyboard-interactive sunar.
        conn.on('keyboard-interactive', (name, instr, lang, prompts, cb) => cb(prompts.map(() => cfg.password)));
        try {
            conn.connect({
                host: cfg.host, port: cfg.port,
                username: cfg.username, password: cfg.password,
                readyTimeout: 12000, tryKeyboard: true,
            });
        } catch (e) {
            clearTimeout(timer);
            if (!settled) { settled = true; reject(httpErr(502, 'NPS SSH failed: ' + e.message)); }
        }
    });
}

// Tek komut calistir → { stdout, stderr, code }
function exec(conn, cmd, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let stdout = '', stderr = '', done = false;
            const t = setTimeout(() => {
                if (done) return;
                done = true;
                try { stream.close(); } catch (e) { /* ignore */ }
                resolve({ stdout, stderr, code: null, timedOut: true });
            }, timeoutMs);
            stream.on('close', (code) => {
                if (done) return;
                done = true;
                clearTimeout(t);
                resolve({ stdout, stderr, code });
            });
            stream.on('data', (d) => {
                stdout += d.toString();
                if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(-2 * 1024 * 1024);
            });
            stream.stderr.on('data', (d) => { stderr += d.toString(); });
        });
    });
}

function sftpReadFile(conn, filePath) {
    return new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
            if (err) return reject(err);
            sftp.readFile(filePath, (e, buf) => e ? reject(e) : resolve(buf.toString('utf8')));
        });
    });
}

function sftpWriteFile(conn, filePath, content) {
    return new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
            if (err) return reject(err);
            // 0600: gecici dosya; asil izinler mv oncesi --reference ile eski
            // dosyadan kopyalanir (freeradius grubunun okuyabilmesi icin sart).
            sftp.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 }, (e) => e ? reject(e) : resolve());
        });
    });
}

/* ============================================================================
   FreeRADIUS "users" dosyasi parse/duzenleme

   Format (ekran goruntusunden):
     DEFAULT Calling-Station-ID == "905346214614", Auth-Type = Accept
         Framed-IP-Address = 192.168.54.200,
         Framed-Route = "10.37.98.0/24 0.0.0.0 1"

   Bir "kayit blogu" girintisiz (0. kolon) bir baslik satiriyla baslar; sonraki
   girintili/bos satirlar ona aittir. Yalnizca Calling-Station-ID iceren bloklar
   duzenlenebilir kayit sayilir; yorumlar ve diger girisler dokunulmadan gecer.
   ========================================================================== */
function parseUsers(text) {
    const norm = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = norm.split('\n');
    const blocks = [];
    let cur = null;
    // Baslik satiri: bos degil, girintisiz, yorum degil.
    const isHeader = (ln) => ln.length > 0 && !/^[ \t]/.test(ln) && !/^\s*#/.test(ln);
    for (let i = 0; i < lines.length; i++) {
        if (isHeader(lines[i])) {
            if (cur) blocks.push(cur);
            cur = { start: i, end: i };
        } else if (cur) {
            cur.end = i; // girintili/bos satir → mevcut bloga ait
        }
    }
    if (cur) blocks.push(cur);

    const entries = [];
    for (const b of blocks) {
        const raw = lines.slice(b.start, b.end + 1).join('\n');
        const gsmM = raw.match(/Calling-Station-ID\s*==?\s*"([^"]*)"/i);
        if (!gsmM) continue; // bizim kaydimiz degil (yorum/baska giris) → atla
        const ipM = raw.match(/Framed-IP-Address\s*=\s*([0-9.]+)/i);
        const routeM = raw.match(/Framed-Route\s*=\s*"([^"]*)"/i);
        entries.push({
            id: entries.length,       // bu okumadaki kararli sira
            start: b.start, end: b.end,
            gsm: gsmM[1],
            ip: ipM ? ipM[1] : '',
            route: routeM ? routeM[1] : '',
        });
    }
    return { lines, entries };
}

// Bir blogun yalnizca 3 alanini YERINDE degistir; blogun geri kalani (Auth-Type,
// girinti, ekstra oznitelikler, bos satirlar) aynen korunur. Fonksiyon replacer
// kullanilir ki degerlerdeki olasi '$' desenleri ozel anlam kazanmasin.
function applyEdit(lines, entry, v) {
    let block = lines.slice(entry.start, entry.end + 1).join('\n');
    block = block.replace(/(Calling-Station-ID\s*==?\s*")([^"]*)(")/i, (m, a, _old, c) => a + v.gsm + c);
    block = block.replace(/(Framed-IP-Address\s*=\s*)([0-9.]+)/i, (m, a) => a + v.ip);
    if (/(Framed-Route\s*=\s*")([^"]*)(")/i.test(block)) {
        block = block.replace(/(Framed-Route\s*=\s*")([^"]*)(")/i, (m, a, _old, c) => a + v.route + c);
    }
    const newLines = block.split('\n');
    return lines.slice(0, entry.start).concat(newLines, lines.slice(entry.end + 1)).join('\n');
}

function isIPv4(ip) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
    return ip.split('.').every(o => { const n = Number(o); return n >= 0 && n <= 255 && String(n) === o; });
}

// gsm/ip/route dogrula ve kirpilmis (temiz) degerleri dondur. Hatada string mesaj,
// basarida { gsm, ip, route } doner.
function cleanEntry(values) {
    const gsm = String(values.gsm == null ? '' : values.gsm).trim();
    const ip = String(values.ip == null ? '' : values.ip).trim();
    const route = String(values.route == null ? '' : values.route).trim();
    if (!/^\d{1,20}$/.test(gsm)) return 'GSM number must be 1–20 digits';
    if (!isIPv4(ip)) return 'Framed-IP-Address must be a valid IPv4 address';
    const rm = route.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3})$/);
    if (!rm || !isIPv4(rm[1]) || !isIPv4(rm[3]) || Number(rm[2]) > 32) {
        return 'Framed-Route must look like "10.37.98.0/24 0.0.0.0 1"';
    }
    // Savunma katmani: dosya yapisini kiracak karakter kesinlikle gecmesin.
    if (/["\n\r\\]/.test(gsm + ip + route)) return 'Invalid characters';
    return { gsm, ip, route };
}

// --- Yuksek seviye islemler ---

// Kayitlari oku → [{ id, gsm, ip, route }]
async function readUsers() {
    const conn = await connect();
    try {
        const text = await sftpReadFile(conn, USERS_FILE);
        return entriesOut(text);
    } catch (e) {
        if (e && e.status) throw e;
        if (/no such file/i.test(e.message || '')) throw httpErr(502, `File not found on NPS: ${USERS_FILE}`);
        if (/permission denied/i.test(e.message || '')) throw httpErr(502, `Permission denied reading ${USERS_FILE}`);
        throw httpErr(502, 'Could not read NPS users file: ' + (e.message || 'error'));
    } finally {
        try { conn.end(); } catch (e) { /* ignore */ }
    }
}

/* --- Lokasyon: UI-only metadata; SSH / users dosyasiyla ILGISI YOK ---
   GSM numarasina gore ayarlarda tutulur (settings.npsLocations). users dosyasina
   asla yazilmaz; yalnizca listede gostermek/duzenlemek icindir. SSH ayar objesinden
   AYRI bir anahtarda tutulur ki SSH ayari kaydedilince silinmesin. */
function getLocations() {
    return store.getSettings().npsLocations || {};
}
function setLocation(gsm, location, previousGsm) {
    const locs = { ...getLocations() };
    const clean = String(location == null ? '' : location).trim().slice(0, 200);
    if (clean) locs[String(gsm)] = clean; else delete locs[String(gsm)];
    // GSM degistiyse lokasyon yeni GSM'e gecer; eski anahtar silinir.
    if (previousGsm && String(previousGsm) !== String(gsm)) delete locs[String(previousGsm)];
    store.updateSettings({ npsLocations: locs });
    return locs;
}
function removeLocation(gsm) {
    const locs = { ...getLocations() };
    if (locs[String(gsm)] !== undefined) { delete locs[String(gsm)]; store.updateSettings({ npsLocations: locs }); }
}

// Parse ciktisini istemciye uygun sade listeye cevir (lokasyon GSM'e gore eklenir)
function entriesOut(text) {
    const locs = getLocations();
    return parseUsers(text).entries.map(e => ({ id: e.id, gsm: e.gsm, ip: e.ip, route: e.route, location: locs[e.gsm] || '' }));
}

// Yeni metni ATOMIK ve izin-koruyarak yaz. Once gecici dosyaya (SFTP) yazar,
// sonra: (1) mevcut dosyayi yedekle, (2) izin/sahipligi eski dosyadan gecici
// dosyaya kopyala (freeradius grubu okuyabilsin), (3) atomik mv. Yollar SABIT —
// kabuga kullanici girdisi girmez. Hata durumunda httpErr firlatir.
async function finalizeWrite(conn, newText) {
    await sftpWriteFile(conn, TMP_FILE, newText);
    const q = (p) => "'" + p + "'";
    const fin = await exec(conn,
        `cp -a -- ${q(USERS_FILE)} ${q(BAK_FILE)} && ` +
        `chmod --reference=${q(USERS_FILE)} ${q(TMP_FILE)} && ` +
        `chown --reference=${q(USERS_FILE)} ${q(TMP_FILE)} && ` +
        `mv -f -- ${q(TMP_FILE)} ${q(USERS_FILE)}`
    );
    if (fin.code !== 0) {
        try { await exec(conn, `rm -f -- ${q(TMP_FILE)}`); } catch (e) { /* ignore */ }
        const detail = (fin.stderr || fin.stdout || ('exit ' + fin.code)).trim().slice(0, 300);
        throw httpErr(502, 'Could not write the users file: ' + detail);
    }
}

// Ekran goruntusundeki bicimle yeni bir kayit blogu uret (TAB girinti dahil).
function buildBlock(clean) {
    return [
        `DEFAULT Calling-Station-ID == "${clean.gsm}", Auth-Type = Accept`,
        `\tFramed-IP-Address = ${clean.ip},`,
        `\tFramed-Route = "${clean.route}"`,
    ].join('\n');
}

// Tek kaydi duzenle. values: { gsm, ip, route, originalGsm }
// Donen: guncel kayit listesi.
async function saveEntry(id, values) {
    const clean = cleanEntry(values || {});
    if (typeof clean === 'string') throw httpErr(400, clean);

    const conn = await connect();
    try {
        // Yazmadan hemen once TAZE oku — istemcinin listesi bayatsa yanlis satiri ezmeyelim.
        const text = await sftpReadFile(conn, USERS_FILE);
        const { lines, entries } = parseUsers(text);
        const entry = entries[id];
        if (!entry) throw httpErr(409, 'That entry no longer exists — refresh the list');
        // Es-zamanlilik korumasi: index'teki kayit hala ayni GSM'e mi ait?
        if (values.originalGsm && entry.gsm !== String(values.originalGsm)) {
            throw httpErr(409, 'The users file changed since you opened it — refresh and try again');
        }
        const newText = applyEdit(lines, entry, clean);
        await finalizeWrite(conn, newText);
        // Lokasyon (UI-only) bu duzenlemeyle birlikte saklanir; GSM degistiyse tasinir.
        setLocation(clean.gsm, values.location, values.originalGsm);
        return entriesOut(newText);
    } catch (e) {
        if (e && e.status) throw e;
        throw httpErr(502, 'Could not save the entry: ' + (e.message || 'error'));
    } finally {
        try { conn.end(); } catch (e) { /* ignore */ }
    }
}

// Yeni kayit ekle. values: { gsm, ip, route }
async function addEntry(values) {
    const clean = cleanEntry(values || {});
    if (typeof clean === 'string') throw httpErr(400, clean);

    const conn = await connect();
    try {
        const text = await sftpReadFile(conn, USERS_FILE);
        const { lines, entries } = parseUsers(text);
        // Ayni GSM zaten varsa reddet (yanlislikla ikili kayit olusmasin).
        if (entries.some(e => e.gsm === clean.gsm)) {
            throw httpErr(409, `An entry for GSM ${clean.gsm} already exists`);
        }
        const block = buildBlock(clean);
        let newText;
        if (entries.length > 0) {
            // Son kaydin hemen ardina ekle (varsa sondaki Reject/yorumlardan once).
            const insertAt = entries[entries.length - 1].end + 1;
            newText = lines.slice(0, insertAt).concat(block.split('\n'), lines.slice(insertAt)).join('\n');
        } else {
            // Hic kayit yoksa dosya sonuna ekle.
            const base = text.replace(/\s*$/, '');
            newText = (base ? base + '\n' : '') + block + '\n';
        }
        await finalizeWrite(conn, newText);
        // Yeni kaydin lokasyonu (varsa) saklanir.
        setLocation(clean.gsm, values.location);
        return entriesOut(newText);
    } catch (e) {
        if (e && e.status) throw e;
        throw httpErr(502, 'Could not add the entry: ' + (e.message || 'error'));
    } finally {
        try { conn.end(); } catch (e) { /* ignore */ }
    }
}

// Kaydi sil. originalGsm verilirse es-zamanlilik kontrolu yapilir.
async function deleteEntry(id, originalGsm) {
    const conn = await connect();
    try {
        const text = await sftpReadFile(conn, USERS_FILE);
        const { lines, entries } = parseUsers(text);
        const entry = entries[id];
        if (!entry) throw httpErr(409, 'That entry no longer exists — refresh the list');
        if (originalGsm && entry.gsm !== String(originalGsm)) {
            throw httpErr(409, 'The users file changed since you opened it — refresh and try again');
        }
        // Blogun tum satirlarini (icine sindirilmis takip eden bos satirlar dahil) cikar.
        const deletedGsm = entry.gsm;
        const newText = lines.slice(0, entry.start).concat(lines.slice(entry.end + 1)).join('\n');
        await finalizeWrite(conn, newText);
        removeLocation(deletedGsm); // kaydin lokasyon metadatasini da temizle
        return entriesOut(newText);
    } catch (e) {
        if (e && e.status) throw e;
        throw httpErr(502, 'Could not delete the entry: ' + (e.message || 'error'));
    } finally {
        try { conn.end(); } catch (e) { /* ignore */ }
    }
}

// service freeradius restart → { ok, code, output }
async function restart() {
    const conn = await connect();
    try {
        const r = await exec(conn, RESTART_CMD, 30000);
        const output = ((r.stdout || '') + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '')).trim();
        return { ok: r.code === 0, code: r.code, output: output.slice(0, 2000) };
    } finally {
        try { conn.end(); } catch (e) { /* ignore */ }
    }
}

// Baglanti testi (Settings kartindaki "Test"). cfg form degerleridir.
async function testConnection(cfg) {
    const conn = await connect(cfg);
    try {
        const r = await exec(conn, 'echo netpulse-ok', 8000);
        if (/netpulse-ok/.test(r.stdout)) return { ok: true, message: 'Connected successfully' };
        return { ok: false, error: 'Connected but the test command failed' };
    } finally {
        try { conn.end(); } catch (e) { /* ignore */ }
    }
}

module.exports = {
    USERS_FILE, RESTART_CMD,
    readUsers, saveEntry, addEntry, deleteEntry, restart, testConnection,
    getLocations, setLocation, removeLocation,
    // test edilebilirlik icin saf yardimcilar:
    parseUsers, applyEdit, buildBlock, cleanEntry, isIPv4, entriesOut,
};
