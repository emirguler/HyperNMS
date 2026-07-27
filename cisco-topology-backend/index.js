const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const ssh2 = require('ssh2').Client;
const ping = require('ping');
const snmp = require('net-snmp');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// .env dosyasını yükle
require('dotenv').config();

const app = express();

// --- CORS: Sadece frontend origin'e izin ver ---
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// --- GÜVENLİK: Secret key artık .env'den geliyor ---
const SECRET_KEY = process.env.JWT_SECRET || (() => {
    console.warn('[UYARI] JWT_SECRET .env dosyasında tanımlı değil! Rastgele oluşturuluyor...');
    return crypto.randomBytes(64).toString('hex');
})();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
    console.error('[HATA] ENCRYPTION_KEY .env dosyasında tanımlı değil!');
    process.exit(1);
}

const TRAFFIC_CACHE = {};
const SMOOTHING_FACTOR = 0.3;

// --- SSH PAROLA ŞİFRELEME (AES-256-GCM) ---
function encryptPassword(plainText) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptPassword(encryptedText) {
    if (!encryptedText) return '';
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) return encryptedText; // Eski format (plain text) ise olduğu gibi döndür
        const [ivHex, authTagHex, encrypted] = parts;
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        // Şifre çözülemiyorsa plain text olabilir (migration)
        return encryptedText;
    }
}

// --- DOSYALAR ---
const DB_SWITCHES = './switches.json';
const DB_USERS = './users.json';
const DB_HISTORY = './ping_history.json';
const DB_EDGES = './edges.json';

// --- RACE-CONDITION SAFE FILE I/O ---
const FILE_LOCKS = {};

function acquireLock(file) {
    return new Promise((resolve) => {
        if (!FILE_LOCKS[file]) {
            FILE_LOCKS[file] = { locked: false, queue: [] };
        }
        const lock = FILE_LOCKS[file];
        if (!lock.locked) {
            lock.locked = true;
            resolve();
        } else {
            lock.queue.push(resolve);
        }
    });
}

function releaseLock(file) {
    const lock = FILE_LOCKS[file];
    if (lock && lock.queue.length > 0) {
        const next = lock.queue.shift();
        next();
    } else if (lock) {
        lock.locked = false;
    }
}

function readJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`[DB] ${file} okunamadı:`, e.message);
        return [];
    }
}

async function safeWriteJSON(file, data) {
    await acquireLock(file);
    try {
        const tmpFile = file + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
        fs.renameSync(tmpFile, file); // Atomic rename
    } finally {
        releaseLock(file);
    }
}

// Senkron yazma (eski uyumluluk + basit durumlar)
function writeJSON(file, data) {
    const tmpFile = file + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, file);
}

// --- BAŞLANGIÇ: Varsayılan dosyaları oluştur ---
async function initDB() {
    if (!fs.existsSync(DB_SWITCHES)) fs.writeFileSync(DB_SWITCHES, JSON.stringify([]));
    if (!fs.existsSync(DB_HISTORY)) fs.writeFileSync(DB_HISTORY, JSON.stringify([]));
    if (!fs.existsSync(DB_EDGES)) fs.writeFileSync(DB_EDGES, JSON.stringify([]));

    // Varsayılan admin kullanıcı (bcrypt hash ile)
    if (!fs.existsSync(DB_USERS)) {
        const hashedPw = await bcrypt.hash('admin123', 12);
        fs.writeFileSync(DB_USERS, JSON.stringify([{id:1, username:'admin', password: hashedPw, role:'Administrator'}]));
        console.log('[INIT] Varsayılan admin oluşturuldu (parola: admin123)');
    }

    // --- MİGRASYON: Mevcut plain-text parolaları hash'le ---
    await migrateUserPasswords();
    await migrateSshPasswords();
}

async function migrateUserPasswords() {
    const users = readJSON(DB_USERS);
    let migrated = false;
    for (const user of users) {
        // bcrypt hash'leri $2a$ veya $2b$ ile başlar
        if (user.password && !user.password.startsWith('$2')) {
            console.log(`[MIGRATION] Kullanıcı "${user.username}" parolası hash'leniyor...`);
            user.password = await bcrypt.hash(user.password, 12);
            migrated = true;
        }
    }
    if (migrated) writeJSON(DB_USERS, users);
}

function migrateSshPasswords() {
    const switches = readJSON(DB_SWITCHES);
    let migrated = false;
    for (const sw of switches) {
        if (sw.sshPassword && !sw.sshPassword.includes(':')) {
            // Plain text — şifrele
            console.log(`[MIGRATION] Cihaz "${sw.name}" SSH parolası şifreleniyor...`);
            sw.sshPassword = encryptPassword(sw.sshPassword);
            migrated = true;
        }
    }
    if (migrated) writeJSON(DB_SWITCHES, switches);
}

// 64-bit Buffer verisini BigInt'e çeviren yardımcı fonksiyon
function bufferToBigInt(buffer) {
    if (!Buffer.isBuffer(buffer)) return BigInt(buffer);
    let value = BigInt(0);
    for (const byte of buffer) {
        value = (value << BigInt(8)) + BigInt(byte);
    }
    return value;
}

// --- YENİ: MARKA TANIMA VE OID SEÇME FONKSİYONU ---
function getVendorConfig(sysDescr) {
    const desc = sysDescr.toLowerCase();
    
    // Varsayılan (Bilinmeyen cihaz)
    let config = {
        vendor: 'Generic',
        cpuOid: null, // Standart bir CPU OID yoktur
    };

    if (desc.includes('cisco')) {
        config.vendor = 'Cisco';
        // Cisco 5dk ortalama CPU
        config.cpuOid = '1.3.6.1.4.1.9.2.1.58.0'; 
    } 
    else if (desc.includes('huawei')) {
        config.vendor = 'Huawei';
        // Huawei CPU Usage
        config.cpuOid = '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.1'; 
    }
    else if (desc.includes('procurve') || desc.includes('hp') || desc.includes('aruba')) {
        config.vendor = 'HP/Aruba';
        // HP ProCurve CPU
        config.cpuOid = '1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0';
    }
    else if (desc.includes('juniper')) {
        config.vendor = 'Juniper';
        // Juniper Routing Engine CPU
        config.cpuOid = '1.3.6.1.4.1.2636.3.1.13.1.8.9.1.0.0'; 
    }
    else if (desc.includes('fortinet')) {
        config.vendor = 'Fortinet';
        // FortiGate CPU
        config.cpuOid = '1.3.6.1.4.1.12356.101.4.1.3.0';
    }
    else if (desc.includes('linux')) {
        config.vendor = 'Linux Server';
        // Linux Load Average (1 min) - .100.1.2.1 (Load) farklıdır, genelde UCD-SNMP kullanılır
        config.cpuOid = '1.3.6.1.4.1.2021.10.1.3.1'; 
    }

    return config;
}

// Uptime Formatlayıcı
function formatUptime(ticks) {
    if (!ticks) return '';
    let seconds = Math.floor(ticks / 100);
    const days = Math.floor(seconds / (3600 * 24));
    seconds -= days * 3600 * 24;
    const hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;
    const minutes = Math.floor(seconds / 60);
    
    let result = [];
    if (days > 0) result.push(`${days} Days`);
    if (hours > 0) result.push(`${hours} Hours`);
    if (minutes > 0) result.push(`${minutes} Mins`);
    
    return result.join(', ') || 'Just Started';
}

// --- AUTH ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(DB_USERS);
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }

    // bcrypt hash karşılaştırma
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }

    // JWT token'a expire süresi ekle (8 saat)
    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        SECRET_KEY,
        { expiresIn: '8h' }
    );
    res.json({ token, role: user.role });
});

// --- MIDDLEWARE: Kimlik Doğrulama ---
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Token gerekli' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Oturum süresi doldu, tekrar giriş yapın' });
            }
            return res.status(403).json({ error: 'Geçersiz token' });
        }
        req.user = user;
        next();
    });
};

// --- MIDDLEWARE: Rol Bazlı Yetkilendirme ---
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'Administrator') {
        return res.status(403).json({ error: 'Bu işlem için Administrator yetkisi gerekli' });
    }
    next();
};

// --- CRUD & ROUTES ---
app.get('/topology', authenticate, (req, res) => {
    const switches = readJSON(DB_SWITCHES);
    const edges = readJSON(DB_EDGES);
    // Hassas bilgileri frontend'e gönderme
    const safeSwitches = switches.map(({ sshPassword, sshUsername, snmpCommunity, ...s }) => s);
    res.json({ switches: safeSwitches, edges });
});

app.post('/edges', authenticate, requireAdmin, (req, res) => {
    const edges = readJSON(DB_EDGES);
    const newEdge = req.body;
    if (!edges.find(e => e.id === newEdge.id)) {
        edges.push(newEdge);
        writeJSON(DB_EDGES, edges);
    }
    res.json({ success: true });
});

app.delete('/edges/:id', authenticate, requireAdmin, (req, res) => {
    let edges = readJSON(DB_EDGES);
    const initialLength = edges.length;
    edges = edges.filter(e => e.id !== req.params.id);
    if (edges.length !== initialLength) {
        writeJSON(DB_EDGES, edges);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Bağlantı bulunamadı' });
    }
});

app.post('/switches', authenticate, requireAdmin, (req, res) => {
    const switches = readJSON(DB_SWITCHES);
    const payload = { ...req.body };
    // SSH parolasını şifrele
    if (payload.sshPassword) {
        payload.sshPassword = encryptPassword(payload.sshPassword);
    }
    const newSwitch = { id: Date.now().toString(), status: 'DOWN', latency: 0, position: {x:0, y:0}, ...payload };
    switches.push(newSwitch);
    writeJSON(DB_SWITCHES, switches);
    res.json({ ...newSwitch, sshPassword: undefined }); // Parolayı response'a ekleme
});

app.put('/switches/:id', authenticate, requireAdmin, (req, res) => {
    let switches = readJSON(DB_SWITCHES);
    const index = switches.findIndex(s => s.id === req.params.id);
    if (index !== -1) {
        const payload = { ...req.body };
        // SSH parolası geldiyse şifrele, gelmediyse eskisini koru
        if (payload.sshPassword) {
            payload.sshPassword = encryptPassword(payload.sshPassword);
        } else {
            delete payload.sshPassword; // Boş gelirse eskiyi koru
        }
        switches[index] = { ...switches[index], ...payload };
        writeJSON(DB_SWITCHES, switches);
        res.json({ ...switches[index], sshPassword: undefined });
    } else {
        res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
});

app.delete('/switches/:id', authenticate, requireAdmin, (req, res) => {
    let switches = readJSON(DB_SWITCHES);
    const initialLength = switches.length;
    switches = switches.filter(s => s.id !== req.params.id);
    let edges = readJSON(DB_EDGES);
    edges = edges.filter(e => e.source !== req.params.id && e.target !== req.params.id);
    writeJSON(DB_EDGES, edges);

    if (switches.length !== initialLength) {
        writeJSON(DB_SWITCHES, switches);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
});

// --- PING SERVICE ---
setInterval(() => {
    const switches = readJSON(DB_SWITCHES);
    const history = readJSON(DB_HISTORY);
    let updated = false;

    Promise.all(switches.map(async (s) => {
        if(s.type === 'cloud') return; 
        try {
            const isWin = process.platform === 'win32';
            const res = await ping.promise.probe(s.ip, { timeout: 2, extra: isWin ? ['-n', '1'] : ['-c', '1'] });
            const prevStatus = s.status;
            s.status = res.alive ? 'UP' : 'DOWN';
            s.latency = res.time === 'unknown' ? -1 : Math.round(res.time);

            history.push({ switchId: s.id, timestamp: Date.now(), value: s.latency });
            
            if (prevStatus !== s.status || Math.abs(s.latency - (s.lastLatency||0)) > 5) {
                updated = true;
                s.lastLatency = s.latency;
            }
        } catch (e) {
            s.status = 'DOWN';
            updated = true;
        }
    })).then(() => {
        if (updated) writeJSON(DB_SWITCHES, switches);
        if (history.length > 10000) writeJSON(DB_HISTORY, history.slice(-10000));
        else writeJSON(DB_HISTORY, history);
    });
}, 5000);

app.get('/switches/:id/ping-history', authenticate, (req, res) => {
    // Legacy sunucuda rollup yok -> her aralik icin ham veriyi birlesik sekle donusturup ver
    // (frontend { mode, points:[{t,avg,min,max,up,down}] } bekler; duz dizi bos grafik olur).
    const RANGE_MS = { '1H': 3600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000 };
    const history = readJSON(DB_HISTORY);
    const rangeMs = RANGE_MS[String(req.query.range || '')] || parseInt(req.query.duration) || 3600000;
    const since = Date.now() - rangeMs;
    const points = history
        .filter(h => h.switchId === req.params.id && h.timestamp > since)
        .map(h => {
            const isDown = h.value === -1;
            const v = isDown ? null : h.value;
            return { t: h.timestamp, avg: v, min: v, max: v, up: isDown ? 0 : 1, down: isDown ? 1 : 0 };
        });
    res.json({ mode: 'raw', bucketMs: 0, rangeMs, points });
});


// --- SNMP DETAYLARI (MULTI-VENDOR DESTEKLİ) ---
app.get('/switches/:id/details', authenticate, async (req, res) => {
    const switches = readJSON(DB_SWITCHES);
    const device = switches.find(s => s.id === req.params.id);
    if (!device) return res.status(404).send();

    // Hassas alanları çıkar
    const { sshPassword, sshUsername, snmpCommunity, ...safeDevice } = device;
    let responseData = {
        ...safeDevice, interfaces: [], snmpHostname: null, uptime: null, cpu: 0, ram: 0, detectedVendor: 'Unknown'
    };

    if (device.status !== 'UP' || !device.snmpCommunity) {
        return res.json(responseData);
    }

    try {
        const session = snmp.createSession(device.ip, device.snmpCommunity, {
            port: device.snmpPort || 161,
            version: snmp.Version2c,
            timeout: 5000, 
            retries: 1
        });

        const getScalar = (oids) => new Promise((resolve) => {
            session.get(oids, (err, varbinds) => {
                if (err) resolve(null); else resolve(varbinds);
            });
        });

        const getSubtree = (oid) => new Promise((resolve) => {
            const results = [];
            session.subtree(oid, 20, (varbinds) => {
                for (const vb of varbinds) results.push(vb);
            }, (err) => resolve(results));
        });

        // 1. ADIM: Temel Bilgileri Al (Hostname, Uptime ve SYSTEM DESCRIPTION)
        // sysDescr OID: 1.3.6.1.2.1.1.1.0 (Bunu kullanarak markayı bulacağız)
        const baseOids = [
            '1.3.6.1.2.1.1.5.0', // Hostname
            '1.3.6.1.2.1.1.3.0', // Uptime
            '1.3.6.1.2.1.1.1.0'  // System Description (Marka imzası buradadır)
        ];

        const baseData = await getScalar(baseOids);
        
        let vendorConfig = { cpuOid: null }; // Başlangıç ayarı

        if (baseData) {
            if (!snmp.isVarbindError(baseData[0])) responseData.snmpHostname = baseData[0].value.toString();
            if (!snmp.isVarbindError(baseData[1])) responseData.uptime = formatUptime(baseData[1].value);
            
            // Markayı Tespit Et
            if (!snmp.isVarbindError(baseData[2])) {
                const sysDescr = baseData[2].value.toString();
                vendorConfig = getVendorConfig(sysDescr); // Hangi marka olduğunu bul
                responseData.detectedVendor = vendorConfig.vendor; // Frontend'e gönderelim
                console.log(`[SNMP] ${device.ip} tespit edilen marka: ${vendorConfig.vendor}`);
            }
        }

        // 2. ADIM: Dinamik CPU Çekimi (Eğer marka bulunduysa)
        if (vendorConfig.cpuOid) {
            const cpuData = await getScalar([vendorConfig.cpuOid]);
            if (cpuData && !snmp.isVarbindError(cpuData[0])) {
                responseData.cpu = cpuData[0].value;
            }
        }

        // 3. ADIM: Trafik Verileri (STANDARTTIR - Marka Fark Etmez)
        // (Burası aynı kalıyor, çünkü RFC standardıdır)
        
        // Status Tablosu
        const oldTableData = await getSubtree('1.3.6.1.2.1.2.2.1.8');
        const statusMap = {};
        oldTableData.forEach(vb => {
            const index = vb.oid.split('.').pop();
            statusMap[index] = vb.value === 1 ? 'up' : 'down';
        });

        // 64-bit Trafik Tablosu (ifXTable)
        const newTableData = await getSubtree('1.3.6.1.2.1.31.1.1.1');
        const interfacesMap = {};

        // --- YENİLENMİŞ VLAN ÇEKME BLOĞU (ACCESS + TRUNK + DEBUG) ---
        let vlanMap = {};

        const parseSnmpInt = (val) => {
            if (Buffer.isBuffer(val)) return val.length > 0 ? val.readUIntBE(0, val.length) : 0;
            return parseInt(val);
        };

        // Sadece Cisco ise VLAN sorgula
        if (responseData.detectedVendor === 'Cisco') {
            console.log(`[VLAN] ${device.ip} için VLAN (Static + Dynamic) sorgulanıyor...`);
            try {
                // 1. ADIM: Trunk Port Native VLAN (En Öncelikli)
                // OID: 1.3.6.1.4.1.9.9.46.1.6.1.1.5
                const trunkVlanData = await getSubtree('1.3.6.1.4.1.9.9.46.1.6.1.1.5');
                trunkVlanData.forEach(vb => {
                    const index = vb.oid.split('.').pop();
                    const val = parseSnmpInt(vb.value);
                    if (val > 0) vlanMap[index] = val.toString() + ' (T)';
                });

                // 2. ADIM: Operasyonel PVID (802.1x / Dinamik Atama Buradan Gelir)
                // OID: 1.3.6.1.2.1.17.7.1.4.5.1.1 (dot1qPvid - Standart MIB)
                const pvidData = await getSubtree('1.3.6.1.2.1.17.7.1.4.5.1.1');
                pvidData.forEach(vb => {
                    const index = vb.oid.split('.').pop();
                    const val = parseSnmpInt(vb.value);
                    
                    // Eğer Trunk değilse ve geçerli bir değer varsa bunu kullan
                    // Burası RADIUS'tan gelen VLAN ID'yi içerir.
                    if (!vlanMap[index] && val > 0) {
                        vlanMap[index] = val.toString(); 
                    }
                });

                // 3. ADIM: Cisco Statik Access VLAN (Yedek)
                // OID: 1.3.6.1.4.1.9.9.68.1.2.2.1.2
                // Eğer üsttekilerden veri gelmediyse buna bak.
                const accessVlanData = await getSubtree('1.3.6.1.4.1.9.9.68.1.2.2.1.2');
                accessVlanData.forEach(vb => {
                    const index = vb.oid.split('.').pop();
                    const val = parseSnmpInt(vb.value);
                    
                    // Hala bir VLAN bilgisi bulamadıysak bunu kullan
                    if (!vlanMap[index] && val > 0) {
                        vlanMap[index] = val.toString();
                    }
                });

            } catch (err) {
                console.log("[VLAN] Hata:", err.message);
            }
        }
        else {
            console.log(`[VLAN] Cihaz Cisco değil (${responseData.detectedVendor}), VLAN sorgusu atlandı.`);
        }

        newTableData.forEach(vb => {
            if (snmp.isVarbindError(vb)) return;
            const oidParts = vb.oid.split('.');
            const index = oidParts.pop(); 
            const column = oidParts.pop();

            if (!interfacesMap[index]) {
                interfacesMap[index] = { 
                    index: index, 
                    name: '', 
                    status: statusMap[index] || 'down', 
                    // VLAN map'te varsa yaz, yoksa '-' koy
                    vlan: vlanMap[index] || '-', 
                    speedMbps: 0, 
                    rawIn: BigInt(0), 
                    rawOut: BigInt(0) 
                };
            }
            
            if (column === '1') interfacesMap[index].name = vb.value.toString(); 
            // ... (Diğer sütun atamaları aynı kalacak) ...
            else if (column === '15') interfacesMap[index].speedMbps = vb.value; 
            else if (column === '6') interfacesMap[index].rawIn = bufferToBigInt(vb.value);
            else if (column === '10') interfacesMap[index].rawOut = bufferToBigInt(vb.value);
        });

        session.close();

        // 4. Hesaplama (Yumuşatma Dahil)
        const now = Date.now();
        const deviceCache = TRAFFIC_CACHE[device.id] || {};
        const SMOOTHING_FACTOR = 0.3;

        responseData.interfaces = Object.values(interfacesMap)
            .filter(i => {
                const nameLower = i.name.toLowerCase();
                // Filtreleme: VLAN sanal portları, Null interface ve Loopback'leri gizle
                return !nameLower.includes('vlan') && !nameLower.includes('null') && !nameLower.includes('loopback');
            })
            .map(i => {
                let currentBpsIn = 0;
                let currentBpsOut = 0;
                const prev = deviceCache[i.index];

                // Hız Hesaplama (Anlık)
                if (prev) {
                    const timeDiff = (now - prev.timestamp) / 1000;
                    if (timeDiff > 0) {
                        if (i.rawIn >= prev.rawIn) currentBpsIn = Number((i.rawIn - prev.rawIn) * BigInt(8)) / timeDiff;
                        if (i.rawOut >= prev.rawOut) currentBpsOut = Number((i.rawOut - prev.rawOut) * BigInt(8)) / timeDiff;
                    }
                }

                // Yumuşatma (Smoothing)
                let smoothedIn = currentBpsIn;
                let smoothedOut = currentBpsOut;

                if (prev && prev.lastSmoothedIn !== undefined) {
                    smoothedIn = (currentBpsIn * SMOOTHING_FACTOR) + (prev.lastSmoothedIn * (1 - SMOOTHING_FACTOR));
                    smoothedOut = (currentBpsOut * SMOOTHING_FACTOR) + (prev.lastSmoothedOut * (1 - SMOOTHING_FACTOR));
                }

                // Cache Güncelle
                deviceCache[i.index] = { 
                    timestamp: now, rawIn: i.rawIn, rawOut: i.rawOut,
                    lastSmoothedIn: smoothedIn, lastSmoothedOut: smoothedOut 
                };

                // --- BURASI DÜZELTİLDİ ---
                // Frontend'e gidecek son obje. 'vlan' alanını buraya ekliyoruz.
                return {
                    index: i.index, 
                    name: i.name, 
                    status: i.status,
                    
                    vlan: i.vlan, // <--- İŞTE BU SATIR EKSİKTİ!
                    
                    speed: i.speedMbps * 1000000, 
                    trafficIn: smoothedIn, 
                    trafficOut: smoothedOut
                };
            });

        responseData.interfaces.sort((a,b) => parseInt(a.index) - parseInt(b.index));
        TRAFFIC_CACHE[device.id] = deviceCache;
        
        // --- GERÇEK RAM KULLANIMI (SNMP hrStorage MIB) ---
        try {
            const ramSession = snmp.createSession(device.ip, device.snmpCommunity, {
                port: device.snmpPort || 161,
                version: snmp.Version2c,
                timeout: 3000,
                retries: 1
            });

            const hrStorageData = await new Promise((resolve) => {
                const results = [];
                ramSession.subtree('1.3.6.1.2.1.25.2.3.1', 20, (varbinds) => {
                    for (const vb of varbinds) results.push(vb);
                }, () => resolve(results));
            });

            // hrStorage tablosunu parse et
            const storageEntries = {};
            hrStorageData.forEach(vb => {
                const oidParts = vb.oid.split('.');
                const index = oidParts.pop();
                const column = oidParts.pop();
                if (!storageEntries[index]) storageEntries[index] = {};
                storageEntries[index][column] = vb.value;
            });

            // RAM tipini bul (hrStorageRam = 1.3.6.1.2.1.25.2.1.2)
            let totalRam = 0, usedRam = 0;
            for (const entry of Object.values(storageEntries)) {
                const typeOid = entry['2'] ? entry['2'].toString() : '';
                if (typeOid.includes('1.3.6.1.2.1.25.2.1.2')) {
                    const blockSize = parseInt(entry['4']) || 1;
                    const totalBlocks = parseInt(entry['5']) || 0;
                    const usedBlocks = parseInt(entry['6']) || 0;
                    totalRam += totalBlocks * blockSize;
                    usedRam += usedBlocks * blockSize;
                }
            }

            if (totalRam > 0) {
                responseData.ram = Math.round((usedRam / totalRam) * 100);
            } else if (responseData.detectedVendor === 'Cisco') {
                // Fallback: Cisco cihazlar için ciscoMemoryPool (ayrı session kullan)
                const ciscoMemSession = snmp.createSession(device.ip, device.snmpCommunity, {
                    port: device.snmpPort || 161, version: snmp.Version2c, timeout: 3000, retries: 1
                });
                const memOids = [
                    '1.3.6.1.4.1.9.9.48.1.1.1.5.1', // ciscoMemoryPoolUsed
                    '1.3.6.1.4.1.9.9.48.1.1.1.6.1'  // ciscoMemoryPoolFree
                ];
                const memData = await new Promise((resolve) => {
                    ciscoMemSession.get(memOids, (err, varbinds) => {
                        if (err) resolve(null); else resolve(varbinds);
                    });
                });
                if (memData && !snmp.isVarbindError(memData[0]) && !snmp.isVarbindError(memData[1])) {
                    const used = parseInt(memData[0].value);
                    const free = parseInt(memData[1].value);
                    if (used + free > 0) {
                        responseData.ram = Math.round((used / (used + free)) * 100);
                    }
                }
                ciscoMemSession.close();
            }
            ramSession.close();
        } catch (ramErr) {
            console.log(`[SNMP] RAM verisi alınamadı (${device.ip}):`, ramErr.message);
            responseData.ram = 0;
        }

        res.json(responseData);

    } 
    
    catch (e) {
        console.error("[SNMP] Kritik Hata:", e);
        res.json(responseData);
    }
});

// --- USERS ---
app.get('/users', authenticate, (req, res) => {
    const users = readJSON(DB_USERS);
    // Parola hash'lerini asla frontend'e gönderme
    const safeUsers = users.map(({ password, ...u }) => u);
    res.json(safeUsers);
});

app.post('/users', authenticate, requireAdmin, async (req, res) => {
    const users = readJSON(DB_USERS);

    // Aynı username kontrolü
    if (users.find(u => u.username === req.body.username)) {
        return res.status(400).json({ error: 'Bu kullanıcı adı zaten mevcut' });
    }

    if (!req.body.password || req.body.password.length < 6) {
        return res.status(400).json({ error: 'Parola en az 6 karakter olmalıdır' });
    }

    const hashedPw = await bcrypt.hash(req.body.password, 12);
    const newUser = { id: Date.now(), username: req.body.username, password: hashedPw, role: req.body.role || 'User' };
    users.push(newUser);
    writeJSON(DB_USERS, users);
    const { password, ...safeUser } = newUser;
    res.json(safeUser);
});

app.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
    const users = readJSON(DB_USERS);
    const idx = users.findIndex(u => String(u.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Rol güncellemesi
    if (req.body.role) users[idx].role = req.body.role;
    if (req.body.username) users[idx].username = req.body.username;

    // Parola değişikliği (sadece doluysa)
    if (req.body.password && req.body.password.length > 0) {
        if (req.body.password.length < 6) {
            return res.status(400).json({ error: 'Parola en az 6 karakter olmalıdır' });
        }
        users[idx].password = await bcrypt.hash(req.body.password, 12);
    }

    writeJSON(DB_USERS, users);
    const { password, ...safeUser } = users[idx];
    res.json(safeUser);
});

app.delete('/users/:id', authenticate, requireAdmin, (req, res) => {
    let users = readJSON(DB_USERS);
    const target = users.find(u => String(u.id) === String(req.params.id));

    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Son admin hesabını silmeye izin verme
    if (target.role === 'Administrator') {
        const adminCount = users.filter(u => u.role === 'Administrator').length;
        if (adminCount <= 1) {
            return res.status(400).json({ error: 'Son administrator hesabı silinemez' });
        }
    }

    users = users.filter(u => String(u.id) !== String(req.params.id));
    writeJSON(DB_USERS, users);
    res.json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws/terminal' });

// --- WEBSOCKET SSH ---
wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const switchId = urlParams.get('switchId');
    const switches = readJSON(DB_SWITCHES);
    const device = switches.find(s => s.id === switchId);

    if (!device || !device.sshUsername) {
        ws.send(JSON.stringify({ type: 'error', message: 'SSH Credentials not found.' }));
        return;
    }

    const conn = new ssh2();
    conn.on('ready', () => {
        ws.send(JSON.stringify({ type: 'info', message: 'SSH Connection Established.\r\n' }));
        conn.shell((err, stream) => {
            if (err) return ws.send(JSON.stringify({ type: 'error', message: err.message }));
            stream.on('data', (data) => ws.send(JSON.stringify({ type: 'data', data: data.toString() })));
            stream.on('close', () => { conn.end(); ws.close(); });
            ws.on('message', (msg) => {
                const parsed = JSON.parse(msg);
                if (parsed.type === 'data') stream.write(parsed.data);
            });
        });
    }).on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', message: 'Connection Failed: ' + err.message }));
    }).connect({
        host: device.ip,
        port: 22,
        username: device.sshUsername,
        password: decryptPassword(device.sshPassword),
        algorithms: {
            kex: [
                "diffie-hellman-group1-sha1", "diffie-hellman-group14-sha1",
                "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
                "diffie-hellman-group-exchange-sha256", "diffie-hellman-group-exchange-sha1"
            ],
            cipher: [
                "aes128-ctr", "aes192-ctr", "aes256-ctr",
                "aes128-cbc", "3des-cbc", "aes192-cbc", "aes256-cbc"
            ],
            serverHostKey: ["ssh-rsa", "ssh-dss"]
        }
    });
});

// --- SUNUCUYU BAŞLAT ---
initDB().then(() => {
    server.listen(4000, () => {
        console.log('[SERVER] Port 4000 üzerinde çalışıyor');
        console.log('[SERVER] CORS origin:', process.env.CORS_ORIGIN || 'http://localhost:5173');
    });
}).catch(err => {
    console.error('[INIT] Başlatma hatası:', err);
    process.exit(1);
});