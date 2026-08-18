const fs = require('fs');
const path = require('path');
const config = require('../config');
const { readJSON, safeWriteJSON } = require('../utils/db');

/* ============================================================================
   SSH OTURUM KAYDI (session recording)

   GUVENLIK - EN ONEMLI KURAL:
   Yalnizca CIHAZDAN GELEN akis kaydedilir (stream -> istemci). Kullanicinin
   tuslari (istemci -> stream) ASLA kaydedilmez. Sebep: "enable" sifresini
   yazarken cihaz onu echo ETMEZ, ama tus vuruslari WS uzerinden ham gecer.
   Tuslari kaydetmek sifreyi duz metin olarak diske yazardi. Cihaz normal
   yazimi zaten echo ettigi icin transcript yine eksiksiz okunur - sadece
   sifreler icinde gorunmez.
   Tek istisna: Operator rolunun whitelist komutlari (sabit liste, sir icermez)
   ayrica isaretlenerek kaydedilir.

   DEPOLAMA:
   memoryStore KULLANILMAZ - o yapi her seyi RAM'de tutup debounce ile tum
   dosyayi bastan yazar (ping history'de 237ms'lik donmalara yol acmisti).
   Bunun yerine mevcut data/history ve data/rollup deseni izlenir:
     data/sessions/index.json    -> tablo + filtreler icin kucuk kayitlar
     data/sessions/<id>.jsonl    -> transcript, append-only
   jsonl satirlari: {"t":<ms offset>,"d":"parca"}  veya  {"t":..,"c":"komut"}
   't' offseti neredeyse bedava ve ileride asciinema gibi OYNATMA imkani verir.
   ========================================================================== */

const SESSIONS_DIR = path.join(config.DATA_DIR, 'sessions');
const INDEX_FILE = path.join(SESSIONS_DIR, 'index.json');

const MAX_SESSION_BYTES = 2 * 1024 * 1024;  // oturum basina ust sinir (2 MB)
const RETENTION_DAYS = 90;                  // bu yastan eski transcript'ler silinir
const FLUSH_MS = 2000;                      // tampon bosaltma araligi
const FLUSH_BYTES = 64 * 1024;              // ...veya bu kadar birikince
const MAX_INDEX_ENTRIES = 20000;
const MAX_SEARCH_FILES = 400;               // transcript icinde arama tarama siniri

// Su an acik olan oturumlar: id -> recorder (canli rozet + admin'in sonlandirmasi)
const live = new Map();

function ensureDir() {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, '[]');
}

function readIndex() {
    ensureDir();
    const list = readJSON(INDEX_FILE);
    return Array.isArray(list) ? list : [];
}

// index.json'a tek noktadan yaz. safeWriteJSON dosya bazli kilit tuttugu icin
// es zamanli oturum baslangic/bitisleri birbirinin yazdigini ezmez.
async function upsert(record) {
    const list = readIndex();
    const i = list.findIndex(r => r.id === record.id);
    if (i >= 0) list[i] = { ...list[i], ...record };
    else list.push(record);
    const trimmed = list.length > MAX_INDEX_ENTRIES ? list.slice(-MAX_INDEX_ENTRIES) : list;
    await safeWriteJSON(INDEX_FILE, trimmed);
}

const transcriptPath = (id) => path.join(SESSIONS_DIR, `${id}.jsonl`);

// Dosya adi olarak guvenli, sirali ve okunabilir id: 20260817-143205-<device>-<user>-<rnd>
function makeId(deviceId, username) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const safe = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'x';
    return `${stamp}-${safe(deviceId)}-${safe(username)}-${Math.random().toString(36).slice(2, 6)}`;
}

class SessionRecorder {
    /**
     * @param {Object} meta  device/user anlik kopyasi (asagidaki startSession'a bak)
     * @param {Function} onKill  admin oturumu sonlandirinca cagrilir
     */
    constructor(meta, onKill) {
        this.id = makeId(meta.deviceId, meta.username);
        this.startMs = Date.now();
        this.buf = [];
        this.bufBytes = 0;
        this.bytes = 0;
        this.commandCount = 0;
        this.truncated = false;
        this.ended = false;
        this.onKill = onKill;
        this.record = {
            id: this.id,
            ...meta,
            startedAt: new Date(this.startMs).toISOString(),
            endedAt: null,
            durationMs: null,
            endReason: null,
            bytes: 0,
            commandCount: 0,
            truncated: false,
        };
        ensureDir();
        this.timer = setInterval(() => this.flush(), FLUSH_MS);
        if (this.timer.unref) this.timer.unref();
        live.set(this.id, this);
        // Baslangicta da index'e yaz: surec cokerse oturum kaybolmasin
        upsert(this.record).catch(e => console.error('[SESSION] index yazilamadi:', e.message));
    }

    _push(obj) {
        if (this.ended || this.truncated) return;
        const line = JSON.stringify(obj) + '\n';
        this.bytes += Buffer.byteLength(line);
        if (this.bytes > MAX_SESSION_BYTES) {
            this.truncated = true;
            this.buf.push(JSON.stringify({ t: Date.now() - this.startMs, d: `\r\n*** kayit ${MAX_SESSION_BYTES / 1048576} MB sinirinda kesildi ***\r\n` }) + '\n');
            this.flush();
            return;
        }
        this.buf.push(line);
        this.bufBytes += line.length;
        if (this.bufBytes >= FLUSH_BYTES) this.flush();
    }

    /** Cihazdan gelen cikti. Tek kaydedilen akis budur. */
    write(chunk) {
        if (!chunk) return;
        this._push({ t: Date.now() - this.startMs, d: String(chunk) });
    }

    /** Operator rolunun whitelist komutu (sabit liste - sir icermez). */
    command(cmd) {
        this.commandCount++;
        this._push({ t: Date.now() - this.startMs, c: String(cmd) });
    }

    flush() {
        if (this.buf.length === 0) return;
        const data = this.buf.join('');
        this.buf = [];
        this.bufBytes = 0;
        // appendFile: dosyayi bastan yazmaz, es zamanli oturumlarda fd biriktirmez
        fs.appendFile(transcriptPath(this.id), data, (e) => {
            if (e) console.error('[SESSION] transcript yazilamadi:', e.message);
        });
    }

    end(reason) {
        if (this.ended) return;
        this.ended = true;
        clearInterval(this.timer);
        this.flush();
        live.delete(this.id);
        const endMs = Date.now();
        this.record = {
            ...this.record,
            endedAt: new Date(endMs).toISOString(),
            durationMs: endMs - this.startMs,
            endReason: reason || 'closed',
            bytes: this.bytes,
            commandCount: this.commandCount,
            truncated: this.truncated,
        };
        upsert(this.record).catch(e => console.error('[SESSION] index guncellenemedi:', e.message));
    }
}

/**
 * Oturum kaydini baslatir.
 * meta: { deviceId, deviceName, deviceIp, deviceType, topologyPage, topologyName,
 *         userId, username, role, mode: 'full'|'restricted', clientIp }
 * Cihaz adi/IP/topoloji adi ANLIK KOPYA olarak saklanir: cihaz sonradan yeniden
 * adlandirilir, tasinir veya silinirse eski kayitlar anlamsizlasmasin. deviceId ve
 * topologyPage id'si de tutulur ki "su an su sayfada olanlar" filtresi calissin.
 */
function startSession(meta, onKill) {
    return new SessionRecorder(meta, onKill);
}

/** Canli oturumlari da iceren, filtrelenmis liste. */
function listSessions(filters = {}) {
    let list = readIndex();

    // Canli kayitlar index'te endedAt:null olarak duruyor; guncel sayaclari ekle
    list = list.map(r => {
        const rec = live.get(r.id);
        return rec ? { ...r, bytes: rec.bytes, commandCount: rec.commandCount, isLive: true } : { ...r, isLive: false };
    });

    if (filters.username) list = list.filter(r => r.username === filters.username);
    if (filters.topologyPage) list = list.filter(r => r.topologyPage === filters.topologyPage);
    if (filters.deviceId) list = list.filter(r => String(r.deviceId) === String(filters.deviceId));
    if (filters.mode) list = list.filter(r => r.mode === filters.mode);
    if (filters.live === true) list = list.filter(r => r.isLive);
    if (filters.since) {
        const t = new Date(filters.since).getTime();
        if (!Number.isNaN(t)) list = list.filter(r => new Date(r.startedAt).getTime() >= t);
    }
    if (filters.until) {
        const t = new Date(filters.until).getTime();
        if (!Number.isNaN(t)) list = list.filter(r => new Date(r.startedAt).getTime() <= t);
    }
    // Serbest metin: once meta alanlari
    if (filters.text) {
        const q = String(filters.text).toLowerCase();
        list = list.filter(r =>
            String(r.deviceName || '').toLowerCase().includes(q) ||
            String(r.deviceIp || '').toLowerCase().includes(q) ||
            String(r.username || '').toLowerCase().includes(q) ||
            String(r.topologyName || '').toLowerCase().includes(q)
        );
    }

    list.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    // Transcript ICINDE arama: "VLAN 130'u kim degistirdi?" sorusunu tek adimda
    // cevaplar. Patolojik taramayi onlemek icin en yeni MAX_SEARCH_FILES dosya.
    if (filters.content) {
        const q = String(filters.content).toLowerCase();
        const scanned = list.slice(0, MAX_SEARCH_FILES);
        list = scanned.filter(r => transcriptIncludes(r.id, q));
    }

    return list.slice(0, filters.limit || 300);
}

function transcriptIncludes(id, lowerQuery) {
    try {
        const raw = fs.readFileSync(transcriptPath(id), 'utf8');
        return raw.toLowerCase().includes(lowerQuery);
    } catch (e) {
        return false;
    }
}

/** Transcript kayitlari: [{t, d}] / [{t, c}]. Canli oturumda tamponu da ekler. */
function readTranscript(id) {
    const rec = live.get(id);
    if (rec) rec.flush();
    let lines = [];
    try {
        lines = fs.readFileSync(transcriptPath(id), 'utf8').split('\n').filter(Boolean);
    } catch (e) {
        return { entries: [], missing: true };
    }
    const entries = [];
    for (const l of lines) {
        try { entries.push(JSON.parse(l)); } catch (e) { /* bozuk satiri atla */ }
    }
    return { entries, missing: false };
}

function getSession(id) {
    return readIndex().find(r => r.id === id) || null;
}

/** Admin oturumu sonlandirir. WS + SSH baglantisini kapatan callback cagrilir. */
function killSession(id) {
    const rec = live.get(id);
    if (!rec) return false;
    try { if (typeof rec.onKill === 'function') rec.onKill(); } catch (e) { /* ignore */ }
    rec.end('killed-by-admin');
    return true;
}

/**
 * Tek bir oturum kaydini kalici siler (index + transcript dosyasi).
 * CANLI oturum silinmez — once sonlandirilmalidir (dosyaya hala yaziyor olabilir).
 * @returns {{ok:boolean, live?:boolean}}
 */
async function deleteSession(id) {
    if (live.has(id)) return { ok: false, live: true };
    const list = readIndex();
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) { list.splice(idx, 1); await safeWriteJSON(INDEX_FILE, list); }
    try { fs.unlinkSync(transcriptPath(id)); } catch (e) { /* zaten yok */ }
    return { ok: true };
}

/** Canli OLMAYAN tum oturum kayitlarini siler; canli olanlar korunur. */
async function deleteAllSessions() {
    const list = readIndex();
    const keep = [];
    let removed = 0;
    for (const r of list) {
        if (live.has(r.id)) { keep.push(r); continue; }
        try { fs.unlinkSync(transcriptPath(r.id)); } catch (e) { /* zaten yok */ }
        removed++;
    }
    await safeWriteJSON(INDEX_FILE, keep);
    return { removed };
}

/**
 * Surec cokup yeniden basladiysa index'te endedAt:null kalan kayitlar vardir;
 * bunlar sonsuza dek "canli" gorunmesin.
 */
async function reconcileOnBoot() {
    const list = readIndex();
    let n = 0;
    for (const r of list) {
        if (r.endedAt === null) { r.endedAt = r.startedAt; r.durationMs = 0; r.endReason = 'server-restart'; n++; }
    }
    if (n > 0) {
        await safeWriteJSON(INDEX_FILE, list);
        console.log(`[SESSION] ${n} yarim kalmis oturum kapatildi (sunucu yeniden baslatildi)`);
    }
}

/** RETENTION_DAYS'ten eski transcript'leri ve index kayitlarini siler. */
async function cleanup() {
    ensureDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const list = readIndex();
    const keep = [];
    let removed = 0;
    for (const r of list) {
        if (new Date(r.startedAt).getTime() < cutoff && !live.has(r.id)) {
            try { fs.unlinkSync(transcriptPath(r.id)); } catch (e) { /* zaten yok */ }
            removed++;
        } else {
            keep.push(r);
        }
    }
    // index'te karsiligi olmayan yetim .jsonl dosyalari (or. cokme sonrasi)
    const known = new Set(keep.map(r => r.id));
    try {
        for (const f of fs.readdirSync(SESSIONS_DIR)) {
            if (!f.endsWith('.jsonl')) continue;
            const id = f.slice(0, -6);
            if (known.has(id)) continue;
            const st = fs.statSync(path.join(SESSIONS_DIR, f));
            if (st.mtimeMs < cutoff) { fs.unlinkSync(path.join(SESSIONS_DIR, f)); removed++; }
        }
    } catch (e) { /* ignore */ }

    if (removed > 0) {
        await safeWriteJSON(INDEX_FILE, keep);
        console.log(`[SESSION] ${removed} eski oturum kaydi silindi (>${RETENTION_DAYS} gun)`);
    }
    return removed;
}

module.exports = {
    startSession, listSessions, readTranscript, getSession, killSession,
    deleteSession, deleteAllSessions,
    cleanup, reconcileOnBoot,
    RETENTION_DAYS, MAX_SESSION_BYTES,
};
