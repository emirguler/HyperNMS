// Basit in-memory cache (TTL destekli)
class Cache {
    constructor(defaultTTL = 60000) {
        this.store = new Map();
        this.defaultTTL = defaultTTL;

        // Expired entry'leri temizle (her 30 saniyede)
        setInterval(() => this.cleanup(), 30000);
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    set(key, value, ttl) {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + (ttl || this.defaultTTL)
        });
    }

    delete(key) {
        this.store.delete(key);
    }

    has(key) {
        return this.get(key) !== null;
    }

    clear() {
        this.store.clear();
    }

    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (now > entry.expiresAt) this.store.delete(key);
        }
    }

    get size() {
        return this.store.size;
    }
}

// SNMP cache — 60 saniye TTL
const snmpCache = new Cache(60000);

// Genel amaçlı cache — 30 saniye TTL
const generalCache = new Cache(30000);

module.exports = { Cache, snmpCache, generalCache };
