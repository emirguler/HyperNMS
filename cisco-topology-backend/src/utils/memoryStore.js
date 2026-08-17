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
            history: [],
            topoTabs: [{ id: 'main', name: 'Main Topology' }],
            settings: {}   // uygulama ayarlari (AD/LDAP config vb.)
        };
        this.dirty = new Set(); // Hangi koleksiyonlar değişti
        this.writeTimer = null;
        this.WRITE_DEBOUNCE = 2000; // 2 saniye debounce

        // Ping geçmişi — cihaz başına bellekte tampon (lazy-load), toplu yazılır.
        // Eski yöntem her ping'te (5sn) her cihazın dosyasını baştan okuyup yazıyordu;
        // bu, cihaz sayısıyla doğru orantılı disk I/O demekti. Artık bellekten okunur,
        // diske periyodik/toplu (batched) yazılır.
        this.history = {};            // switchId -> kayıt dizisi (disk önbelleği)
        this.historyDirty = new Set();// Diske yazılması gereken switchId'ler
        this.historyTimer = null;
        this.HISTORY_DEBOUNCE = 10000; // 10sn pencere — birden çok ping döngüsünü tek yazıma toplar
        this.MAX_HISTORY_PER_DEVICE = 5000;

        // Ping ozet (rollup) - uzun aralik (1W/1M) icin sabit 5dk kovalar (cihaz basina).
        // Ham 5sn seri yalnizca ~7 saat tutabildiginden hafta/ay gorunumleri buradan beslenir.
        this.rollup = {};              // switchId -> kova dizisi {t, avg, min, max, up, down}
        this.rollupDirty = new Set();
        this.rollupTimer = null;
        this.ROLLUP_DEBOUNCE = 30000;   // 30sn - rollup daha seyrek yazilir
        this.ROLLUP_BUCKET_MS = 300000; // 5 dakikalik kova
        this.MAX_ROLLUP_PER_DEVICE = 9000; // ~31 gun (5dk kova) - 1M gorunumunu kapsar
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

        // Rollup klasoru (cihaz basina 5dk ozet seri)
        const rollupDir = path.join(config.DATA_DIR, 'rollup');
        if (!fs.existsSync(rollupDir)) {
            fs.mkdirSync(rollupDir, { recursive: true });
        }

        // Dosyalardan yükle
        this.data.switches = this._readFile(config.DB_SWITCHES);
        this.data.users = this._readFile(config.DB_USERS);
        this.data.edges = this._readFile(config.DB_EDGES);

        // Rol goc: eski 'User' rolu -> 'Operator' (Restricted-Config). Yeni 'Viewer' rolu
        // (User / View Only) hicbir sekilde etkilenmez; 'User' artik gecerli bir rol degil,
        // bu yuzden donusum tekrarlanabilir (her acilista guvenle calisir).
        const migrated = this.data.users.filter(u => u && u.role === 'User');
        if (migrated.length > 0) {
            migrated.forEach(u => { u.role = 'Operator'; });
            this._markDirty('users');
            console.log(`[STORE] ${migrated.length} kullanicinin rolu 'User' -> 'Operator' olarak guncellendi`);
        }

        // Topology tabs
        const savedTabs = this._readFile(config.DB_TOPO_TABS);
        if (savedTabs.length > 0) this.data.topoTabs = savedTabs;
        else this.data.topoTabs = [{ id: 'main', name: 'Main Topology' }];

        // Ayarlar (obje) — AD config vb.
        try {
            if (fs.existsSync(config.DB_SETTINGS)) {
                const s = JSON.parse(fs.readFileSync(config.DB_SETTINGS, 'utf8'));
                if (s && typeof s === 'object' && !Array.isArray(s)) this.data.settings = s;
            }
        } catch (e) { console.error('[STORE] settings okunamadi:', e.message); }

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
        if (this.data.switches.find(s => s.id === sw.id || s.ip === sw.ip)) return null;
        this.data.switches.push(sw);
        this._markDirty('switches');
        return sw;
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
            // Geçmiş bellek tamponunu da temizle (disk dosyası korunur)
            delete this.history[id];
            this.historyDirty.delete(id);
            delete this.rollup[id];
            this.rollupDirty.delete(id);
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
                // Sadece status değişimi diske yazımı tetikler; latency canlı veri,
                // bellekte tutulur + history'ye gider — her titremede switches.json yazma.
                if (sw.status !== result.status) changed = true;
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

    // --- Settings (AD/LDAP config vb.) ---
    getSettings() { return this.data.settings || {}; }
    updateSettings(patch) {
        this.data.settings = { ...(this.data.settings || {}), ...patch };
        this._markDirty('settings');
        return this.data.settings;
    }

    addUser(user) {
        this.data.users.push(user);
        this._markDirty('users');
    }

    updateUser(id, updates) {
        const idx = this.data.users.findIndex(u => String(u.id) === String(id));
        if (idx === -1) return null;
        // Whitelist allowed user fields to prevent prototype pollution.
        // DIKKAT: bu listede olmayan bir alan SESSIZCE dusurulur. 'username' ve
        // 'authType' eksikti - PUT /users/:id ikisini de hesaplayip gonderiyordu,
        // yani kullanici adi degistirme ve yerel<->AD gecisi kaydedilmiyordu.
        const allowed = ['username', 'password', 'role', 'authType', 'mustChangePassword', 'allowedCommands', 'fullSsh'];
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

    updateEdge(id, updates) {
        const edge = this.data.edges.find(e => e.id === id);
        if (edge) {
            Object.assign(edge, updates);
            this._markDirty('edges');
            return true;
        }
        return false;
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

    // --- Topology Tabs ---
    getTopoTabs() { return this.data.topoTabs; }

    addTopoTab(tab) {
        this.data.topoTabs.push(tab);
        this._markDirty('topoTabs');
        return tab;
    }

    // Sekme sırasını istemciden gelen id dizisine göre yeniden düzenle.
    // Dayanıklı: tanınmayan id'ler yok sayılır, dizide olmayan sekmeler (istemci listesi
    // bayatsa, ör. başka biri sekme eklediyse) sona eklenir → sekme kaybolmaz.
    reorderTopoTabs(ids) {
        if (!Array.isArray(ids) || ids.length === 0) return false;
        const byId = new Map(this.data.topoTabs.map(t => [t.id, t]));
        const next = [];
        for (const id of ids) {
            const tab = byId.get(id);
            if (tab) { next.push(tab); byId.delete(id); }
        }
        for (const tab of byId.values()) next.push(tab); // artakalanlar
        this.data.topoTabs = next;
        this._markDirty('topoTabs');
        return true;
    }

    renameTopoTab(id, name) {
        const tab = this.data.topoTabs.find(t => t.id === id);
        if (tab) {
            tab.name = name;
            this._markDirty('topoTabs');
            return true;
        }
        return false;
    }

    removeTopoTab(id) {
        if (id === 'main') return false;
        const len = this.data.topoTabs.length;
        this.data.topoTabs = this.data.topoTabs.filter(t => t.id !== id);
        if (this.data.topoTabs.length !== len) {
            // Move devices from deleted tab back to main
            this.data.switches.forEach(sw => {
                if (sw.topologyPage === id) sw.topologyPage = 'main';
            });
            this._markDirty('topoTabs');
            this._markDirty('switches');
            return true;
        }
        return false;
    }

    // --- Ping History (cihaz başına dosya, bellekte tamponlu) ---
    // Bir cihazın geçmişini diskten belleğe yükler (yalnızca ilk erişimde).
    _loadHistory(switchId) {
        if (this.history[switchId]) return this.history[switchId];
        const file = path.join(config.DATA_DIR, 'history', `${switchId}.json`);
        this.history[switchId] = this._readFile(file);
        return this.history[switchId];
    }

    getHistory(switchId, since) {
        if (!/^[a-zA-Z0-9_-]+$/.test(switchId)) return [];
        const records = this._loadHistory(switchId);
        if (since) return records.filter(h => h.timestamp > since);
        return records;
    }

    appendHistory(switchId, record) {
        if (!/^[a-zA-Z0-9_-]+$/.test(switchId)) return;
        const records = this._loadHistory(switchId);
        records.push(record);
        // Cihaz başına max kayıt — başından kırp (in-place)
        if (records.length > this.MAX_HISTORY_PER_DEVICE) {
            records.splice(0, records.length - this.MAX_HISTORY_PER_DEVICE);
        }
        this._markHistoryDirty(switchId);
    }

    // Geçmişi diske yazılmak üzere işaretle. Debounce timer'ı her çağrıda
    // SIFIRLANMAZ — böylece sürekli append akışında dahi en geç DEBOUNCE içinde flush olur.
    _markHistoryDirty(switchId) {
        this.historyDirty.add(switchId);
        if (!this.historyTimer) {
            this.historyTimer = setTimeout(() => {
                this.historyTimer = null;
                this._flushHistory();
            }, this.HISTORY_DEBOUNCE);
        }
    }

    // Dirty cihaz dosyalarını yaz. Çalışırken (sync=false) cihazları küçük gruplar (CHUNK)
    // halinde AYRI tick'lerde işler → tüm cihazların JSON.stringify CPU'su tek turda birikip
    // event loop'u (dolayısıyla SSH terminal relay'ini) yüzlerce ms dondurmasın; gruplar
    // arasında setImmediate ile relay nefes alır. Kapanışta (sync=true) hepsi hemen yazılır.
    _flushFiles(ids, dir, cache, sync, label) {
        const writeOne = (id) => {
            const arr = cache[id];
            if (!arr) return;
            const file = path.join(dir, `${id}.json`);
            const tmpFile = file + '.tmp';
            try {
                const json = JSON.stringify(arr); // senkron snapshot
                if (sync) {
                    fs.writeFileSync(tmpFile, json);
                    fs.renameSync(tmpFile, file);
                } else {
                    fs.writeFile(tmpFile, json, (err) => {
                        if (err) return console.error(`[STORE] ${label} ${id} yazılamadı:`, err.message);
                        fs.rename(tmpFile, file, (e2) => { if (e2) console.error(`[STORE] ${label} rename ${id}:`, e2.message); });
                    });
                }
            } catch (e) {
                console.error(`[STORE] ${label} ${id} yazılamadı:`, e.message);
            }
        };
        if (sync) { for (const id of ids) writeOne(id); return; }
        let i = 0;
        const CHUNK = 3; // ~150 cihazda tick başına donma ~11ms (bir kare altı); ölçümle seçildi
        const step = () => {
            const end = Math.min(i + CHUNK, ids.length);
            for (; i < end; i++) writeOne(ids[i]);
            if (i < ids.length) setImmediate(step);
        };
        step();
    }

    _flushHistory(sync = false) {
        if (this.historyDirty.size === 0) return;
        const ids = [...this.historyDirty];
        this.historyDirty.clear();
        this._flushFiles(ids, path.join(config.DATA_DIR, 'history'), this.history, sync, 'history');
    }

    // --- Ping Rollup (5dk ozet, cihaz basina dosya) ---
    _loadRollup(switchId) {
        if (this.rollup[switchId]) return this.rollup[switchId];
        const file = path.join(config.DATA_DIR, 'rollup', `${switchId}.json`);
        this.rollup[switchId] = this._readFile(file);
        return this.rollup[switchId];
    }

    getRollup(switchId, since) {
        if (!/^[a-zA-Z0-9_-]+$/.test(switchId)) return [];
        const buckets = this._loadRollup(switchId);
        if (since) return buckets.filter(b => b.t >= since);
        return buckets;
    }

    // Ham ping ornegini 5dk kovaya isle. value: latency ms, -1 = kayip/DOWN.
    // Ping'ler zaman sirasiyla geldiginden yalnizca son kovaya bakmak yeterli
    // (bucketT geriye giderse -> nadir saat kaymasi, son kovaya toplanir; dizi monoton kalir).
    appendRollup(switchId, timestamp, value) {
        if (!/^[a-zA-Z0-9_-]+$/.test(switchId)) return;
        const buckets = this._loadRollup(switchId);
        const bucketT = Math.floor(timestamp / this.ROLLUP_BUCKET_MS) * this.ROLLUP_BUCKET_MS;
        let b = buckets.length ? buckets[buckets.length - 1] : null;
        if (!b || bucketT > b.t) {
            b = { t: bucketT, avg: null, min: null, max: null, up: 0, down: 0 };
            buckets.push(b);
            if (buckets.length > this.MAX_ROLLUP_PER_DEVICE) {
                buckets.splice(0, buckets.length - this.MAX_ROLLUP_PER_DEVICE);
            }
        }
        if (value === -1) {
            b.down++;
        } else {
            b.avg = b.up === 0 ? value : (b.avg * b.up + value) / (b.up + 1);
            b.min = b.min === null ? value : Math.min(b.min, value);
            b.max = b.max === null ? value : Math.max(b.max, value);
            b.up++;
        }
        this._markRollupDirty(switchId);
    }

    _markRollupDirty(switchId) {
        this.rollupDirty.add(switchId);
        if (!this.rollupTimer) {
            this.rollupTimer = setTimeout(() => {
                this.rollupTimer = null;
                this._flushRollup();
            }, this.ROLLUP_DEBOUNCE);
        }
    }

    _flushRollup(sync = false) {
        if (this.rollupDirty.size === 0) return;
        const ids = [...this.rollupDirty];
        this.rollupDirty.clear();
        this._flushFiles(ids, path.join(config.DATA_DIR, 'rollup'), this.rollup, sync, 'rollup');
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
                edges: config.DB_EDGES,
                topoTabs: config.DB_TOPO_TABS,
                settings: config.DB_SETTINGS
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
        if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; }
        if (this.rollupTimer) { clearTimeout(this.rollupTimer); this.rollupTimer = null; }
        this._flush();
        this._flushHistory(true); // kapanışta senkron (süreç bitmeden yazılsın)
        this._flushRollup(true);
    }
}

const store = new MemoryStore();

module.exports = store;
