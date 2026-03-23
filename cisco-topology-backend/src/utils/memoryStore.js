const fs = require('fs');
const path = require('path');
const config = require('../config');

// In-memory veri deposu — dosya I/O'yu minimize eder
// Başlangıçta dosyadan yükler, değişiklikleri debounce ile async yazar

class MemoryStore {
    constructor() {
        this.data = {
            switches: [],
            users: [],
            edges: [],
            history: []
        };
        this.dirty = new Set(); // Hangi koleksiyonlar değişti
        this.writeTimer = null;
        this.WRITE_DEBOUNCE = 2000; // 2 saniye debounce
    }

    init() {
        // Data klasörünü oluştur
        if (!fs.existsSync(config.DATA_DIR)) {
            fs.mkdirSync(config.DATA_DIR, { recursive: true });
        }

        // History klasörü (cihaz başına)
        const historyDir = path.join(config.DATA_DIR, 'history');
        if (!fs.existsSync(historyDir)) {
            fs.mkdirSync(historyDir, { recursive: true });
        }

        // Dosyalardan yükle
        this.data.switches = this._readFile(config.DB_SWITCHES);
        this.data.users = this._readFile(config.DB_USERS);
        this.data.edges = this._readFile(config.DB_EDGES);

        // Eski tek-dosya history'yi migrate et
        if (fs.existsSync(config.DB_HISTORY)) {
            const oldHistory = this._readFile(config.DB_HISTORY);
            if (oldHistory.length > 0) {
                // Cihaz başına ayır
                const grouped = {};
                oldHistory.forEach(h => {
                    if (!grouped[h.switchId]) grouped[h.switchId] = [];
                    grouped[h.switchId].push(h);
                });
                for (const [switchId, records] of Object.entries(grouped)) {
                    const file = path.join(historyDir, `${switchId}.json`);
                    if (!fs.existsSync(file)) {
                        fs.writeFileSync(file, JSON.stringify(records.slice(-5000)));
                    }
                }
                // Eski dosyayı sil
                try { fs.unlinkSync(config.DB_HISTORY); } catch {}
                console.log(`[STORE] Ping history ${Object.keys(grouped).length} cihaza migrate edildi`);
            }
        }

        console.log(`[STORE] Bellekte: ${this.data.switches.length} cihaz, ${this.data.users.length} kullanıcı, ${this.data.edges.length} bağlantı`);
    }

    _readFile(file) {
        try {
            if (!fs.existsSync(file)) return [];
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            console.error(`[STORE] ${file} okunamadı:`, e.message);
            return [];
        }
    }

    // --- Switches ---
    getSwitches() { return this.data.switches; }

    getSwitch(id) { return this.data.switches.find(s => s.id === id); }

    addSwitch(sw) {
        this.data.switches.push(sw);
        this._markDirty('switches');
    }

    updateSwitch(id, updates) {
        const idx = this.data.switches.findIndex(s => s.id === id);
        if (idx === -1) return null;
        this.data.switches[idx] = { ...this.data.switches[idx], ...updates };
        this._markDirty('switches');
        return this.data.switches[idx];
    }

    deleteSwitch(id) {
        const len = this.data.switches.length;
        this.data.switches = this.data.switches.filter(s => s.id !== id);
        if (this.data.switches.length !== len) {
            this._markDirty('switches');
            return true;
        }
        return false;
    }

    // Ping sonuçları — sadece status/latency güncelle (sık çağrılır, debounce ile yazılır)
    updatePingResults(results) {
        let changed = false;
        for (const [id, result] of Object.entries(results)) {
            const sw = this.data.switches.find(s => s.id === id);
            if (sw) {
                if (sw.status !== result.status || Math.abs((sw.latency || 0) - result.latency) > 3) {
                    changed = true;
                }
                sw.status = result.status;
                sw.latency = result.latency;
                sw.lastLatency = result.latency;
            }
        }
        if (changed) this._markDirty('switches');
    }

    // --- Users ---
    getUsers() { return this.data.users; }

    getUser(id) { return this.data.users.find(u => String(u.id) === String(id)); }

    getUserByUsername(username) { return this.data.users.find(u => u.username === username); }

    addUser(user) {
        this.data.users.push(user);
        this._markDirty('users');
    }

    updateUser(id, updates) {
        const idx = this.data.users.findIndex(u => String(u.id) === String(id));
        if (idx === -1) return null;
        // Whitelist allowed user fields to prevent prototype pollution
        const allowed = ['password', 'role', 'mustChangePassword'];
        for (const key of allowed) {
            if (updates[key] !== undefined) this.data.users[idx][key] = updates[key];
        }
        this._markDirty('users');
        return this.data.users[idx];
    }

    deleteUser(id) {
        const len = this.data.users.length;
        this.data.users = this.data.users.filter(u => String(u.id) !== String(id));
        if (this.data.users.length !== len) {
            this._markDirty('users');
            return true;
        }
        return false;
    }

    // --- Edges ---
    getEdges() { return this.data.edges; }

    addEdge(edge) {
        if (!this.data.edges.find(e => e.id === edge.id)) {
            this.data.edges.push(edge);
            this._markDirty('edges');
        }
    }

    deleteEdge(id) {
        const len = this.data.edges.length;
        this.data.edges = this.data.edges.filter(e => e.id !== id);
        if (this.data.edges.length !== len) {
            this._markDirty('edges');
            return true;
        }
        return false;
    }

    // --- Ping History (cihaz başına dosya) ---
    getHistory(switchId, since) {
        const file = path.join(config.DATA_DIR, 'history', `${switchId}.json`);
        const records = this._readFile(file);
        if (since) return records.filter(h => h.timestamp > since);
        return records;
    }

    appendHistory(switchId, record) {
        const file = path.join(config.DATA_DIR, 'history', `${switchId}.json`);
        let records = this._readFile(file);
        records.push(record);
        // Cihaz başına max 5000 kayıt
        if (records.length > 5000) records = records.slice(-5000);
        // Async yaz (non-blocking)
        fs.writeFile(file, JSON.stringify(records), () => {});
    }

    // --- Dirty tracking & debounced write ---
    _markDirty(collection) {
        this.dirty.add(collection);
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => this._flush(), this.WRITE_DEBOUNCE);
    }

    _flush() {
        for (const collection of this.dirty) {
            const fileMap = {
                switches: config.DB_SWITCHES,
                users: config.DB_USERS,
                edges: config.DB_EDGES
            };
            const file = fileMap[collection];
            if (file) {
                try {
                    const tmpFile = file + '.tmp';
                    fs.writeFileSync(tmpFile, JSON.stringify(this.data[collection], null, 2));
                    fs.renameSync(tmpFile, file);
                } catch (e) {
                    console.error(`[STORE] ${collection} yazılamadı:`, e.message);
                }
            }
        }
        this.dirty.clear();
    }

    // Uygulama kapanırken flush
    flushSync() {
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this._flush();
    }
}

const store = new MemoryStore();

module.exports = store;
