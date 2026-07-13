const express = require('express');
const crypto = require('crypto');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch } = require('../utils/validation');
const { encryptPassword } = require('../utils/crypto');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Full config backup — includes encrypted credentials
router.get('/backup', authenticate, requireAdmin, async (req, res) => {
    const switches = store.getSwitches();
    const edges = store.getEdges();
    const users = store.getUsers().map(({ password, ...u }) => u);

    const backup = {
        version: '2.0',
        timestamp: new Date().toISOString(),
        checksum: '', // will be filled below
        data: { switches, edges, users, topoTabs: store.getTopoTabs() }
    };

    // Add integrity checksum
    const dataStr = JSON.stringify(backup.data);
    backup.checksum = crypto.createHash('sha256').update(dataStr).digest('hex');

    await logAction(req.user, 'BACKUP_DOWNLOAD', 'Full configuration backup');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=netpulse-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(backup);
});

// Restore from backup
router.post('/restore', authenticate, requireAdmin, async (req, res) => {
    const backup = req.body;

    // Validate backup structure
    if (!backup || !backup.version || !backup.data) {
        return res.status(400).json({ error: 'Invalid backup file format' });
    }

    // Verify checksum
    if (backup.checksum) {
        const dataStr = JSON.stringify(backup.data);
        const expected = crypto.createHash('sha256').update(dataStr).digest('hex');
        if (backup.checksum !== expected) {
            return res.status(400).json({ error: 'Backup file corrupted — checksum mismatch' });
        }
    }

    const { switches, edges, users } = backup.data;
    const results = { devices: 0, edges: 0, users: 0, skipped: 0 };

    // Restore devices — match by ID or IP, update existing or add new
    if (Array.isArray(switches)) {
        // Deduplicate backup data first (old backups may contain dupes)
        const seenInBackup = new Set();
        const uniqueSwitches = switches.filter(sw => {
            const key = sw.id || sw.ip;
            if (seenInBackup.has(key)) return false;
            seenInBackup.add(key);
            if (sw.ip) seenInBackup.add(sw.ip);
            return true;
        });

        const existing = store.getSwitches();
        for (const sw of uniqueSwitches) {
            if (!sw.name || !sw.ip) { results.skipped++; continue; }
            const match = existing.find(e => String(e.id) === String(sw.id) || e.ip === sw.ip);
            if (match) {
                Object.assign(match, {
                    ...sw,
                    id: match.id,
                    status: match.status,
                    latency: match.latency,
                    lastLatency: match.lastLatency,
                });
                results.skipped++;
            } else {
                const newSw = {
                    ...sw,
                    id: sw.id || Date.now().toString() + crypto.randomBytes(4).toString('hex'),
                    status: 'DOWN',
                    latency: 0,
                };
                if (store.addSwitch(newSw)) {
                    results.devices++;
                } else {
                    results.skipped++;
                }
            }
        }
        store._markDirty('switches');
    }

    // Restore edges (skip duplicates)
    if (Array.isArray(edges)) {
        const existingEdges = store.getEdges();
        for (const edge of edges) {
            if (!edge.source || !edge.target) continue;
            if (existingEdges.find(e => e.id === edge.id)) continue;
            store.addEdge({ ...edge, id: edge.id || `e-${edge.source}-${edge.target}-${Date.now()}` });
            results.edges++;
        }
    }

    // Restore users (skip existing usernames, skip admin)
    if (Array.isArray(users)) {
        const existingUsers = store.getUsers();
        for (const user of users) {
            if (!user.username || user.username === 'admin') continue;
            if (existingUsers.find(u => u.username === user.username)) { results.skipped++; continue; }
            // Users from backup don't have passwords — they'll need to be reset
            const bcrypt = require('bcryptjs');
            const tempPass = crypto.randomBytes(8).toString('hex');
            store.addUser({
                ...user,
                id: Date.now() + Math.random(),
                password: bcrypt.hashSync(tempPass, 12),
                mustChangePassword: true,
            });
            results.users++;
        }
    }

    // Restore topology tabs
    if (backup.data.topoTabs && Array.isArray(backup.data.topoTabs)) {
        const existingTabs = store.getTopoTabs();
        for (const tab of backup.data.topoTabs) {
            if (tab.id === 'main') continue;
            if (existingTabs.find(t => t.id === tab.id)) continue;
            store.addTopoTab(tab);
        }
    }

    store.flushSync();
    await logAction(req.user, 'BACKUP_RESTORE', `Restored: ${results.devices} devices, ${results.edges} edges, ${results.users} users, ${results.skipped} skipped`);
    res.json({ success: true, results });
});

// Bulk import — CSV parsed JSON array
router.post('/switches/bulk', authenticate, requireAdmin, async (req, res) => {
    const devices = req.body.devices;
    if (!Array.isArray(devices) || devices.length === 0) {
        return res.status(400).json({ error: 'devices array required' });
    }

    // Limit bulk import size
    if (devices.length > 500) {
        return res.status(400).json({ error: 'Maximum 500 devices per import' });
    }

    const results = { added: 0, skipped: 0, errors: [], pagesCreated: 0 };
    const existing = store.getSwitches();

    // CSV'deki tip değerini normalize et: büyük/küçük harf, kısaltma ve
    // görünen etiketleri (ör. "Network Switch") kanonik değere eşle.
    const TYPE_ALIASES = {
        'switch': 'switch', 'network switch': 'switch', 'sw': 'switch', 'l2': 'switch', 'l3': 'switch', 'l3 switch': 'switch', 'l2 switch': 'switch',
        'router': 'router', 'rtr': 'router', 'gateway': 'router', 'gw': 'router',
        'firewall': 'firewall', 'fw': 'firewall', 'guvenlik duvari': 'firewall',
        'server': 'server', 'srv': 'server', 'sunucu': 'server', 'linux server': 'server', 'linux': 'server',
        'pc': 'pc', 'workstation': 'pc', 'client': 'pc', 'istemci': 'pc', 'bilgisayar': 'pc',
        'antenna': 'antenna', 'anten': 'antenna', 'ap': 'antenna', 'access point': 'antenna', 'wireless': 'antenna', 'radio': 'antenna', 'link': 'antenna',
        'cloud': 'cloud', 'cloud / internet': 'cloud', 'internet': 'cloud', 'wan': 'cloud', 'bulut': 'cloud',
    };
    const normalizeType = (val) => {
        const key = String(val || '').trim().toLowerCase();
        if (!key) return 'switch';
        return TYPE_ALIASES[key] || key; // tanınmazsa olduğu gibi bırak → validateSwitch yakalar
    };

    // Topoloji sayfaları id ile tutulur; CSV'de kullanıcı sayfa ADINI yazar.
    // Ada göre (veya id'ye göre) eşleştir; yoksa o adda yeni sayfa oluştur.
    const resolveTopologyPage = (value) => {
        const v = (value || '').trim();
        if (!v || v.toLowerCase() === 'main') return 'main';
        const tabs = store.getTopoTabs();
        const match = tabs.find(t => t.id === v || t.name.toLowerCase() === v.toLowerCase());
        if (match) return match.id;
        // Yeni sayfa oluştur (bulk'ta çakışmasın diye rastgele son ek)
        const tab = store.addTopoTab({ id: 'tab-' + Date.now() + crypto.randomBytes(3).toString('hex'), name: v });
        results.pagesCreated++;
        return tab.id;
    };

    for (const raw of devices) {
        // CSV'den tags virgüllü string gelir; sanitizeSwitch dizi beklediğinden
        // dönüşümü sanitize ÖNCESİNDE yap (yoksa tag'ler kaybolur).
        if (raw && typeof raw.tags === 'string') {
            raw.tags = raw.tags.split(',').map(t => t.trim()).filter(Boolean);
        }

        const payload = sanitizeSwitch(raw);

        if (!payload.name || !payload.ip) {
            results.errors.push(`Row skipped: name and ip required (${payload.name || '?'})`);
            results.skipped++;
            continue;
        }

        // Tip değerini kanonik hale getir (Switch / SWITCH / "Network Switch" → switch)
        if (payload.type !== undefined) payload.type = normalizeType(payload.type);

        // Validate
        const errors = validateSwitch(payload);
        if (errors.length > 0) {
            results.errors.push(`${payload.name}: ${errors.join(', ')}`);
            results.skipped++;
            continue;
        }

        // Duplicate IP check
        if (existing.find(s => s.ip === payload.ip)) {
            results.errors.push(`${payload.ip} already exists, skipped`);
            results.skipped++;
            continue;
        }

        // Topoloji sayfası: CSV'deki ad/id → geçerli sayfa id'si (yoksa oluştur)
        payload.topologyPage = resolveTopologyPage(payload.topologyPage);

        // Encrypt SSH password
        if (payload.sshPassword) {
            payload.sshPassword = encryptPassword(payload.sshPassword);
        }

        const newSwitch = {
            id: Date.now().toString() + crypto.randomBytes(4).toString('hex'),
            status: 'DOWN', latency: 0,
            position: { x: Math.random() * 800, y: Math.random() * 600 },
            tags: [],
            type: 'switch',
            ...payload
        };

        if (store.addSwitch(newSwitch)) {
            results.added++;
        } else {
            results.errors.push(`${payload.ip} duplicate detected, skipped`);
            results.skipped++;
        }
    }

    await logAction(req.user, 'BULK_IMPORT', `${results.added} devices added`);
    res.json(results);
});

module.exports = router;
