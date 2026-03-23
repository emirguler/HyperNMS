const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch } = require('../utils/validation');
const { encryptPassword } = require('../utils/crypto');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Full config backup — tüm cihazlar, edge'ler, kullanıcılar (parolalar hariç)
router.get('/backup', authenticate, requireAdmin, (req, res) => {
    const switches = store.getSwitches().map(({ sshPassword, ...s }) => s);
    const edges = store.getEdges();
    const users = store.getUsers().map(({ password, ...u }) => u);

    const backup = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        data: { switches, edges, users }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=netpulse-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(backup);
});

// Bulk import — Excel'den parse edilmiş JSON array
router.post('/switches/bulk', authenticate, requireAdmin, async (req, res) => {
    const devices = req.body.devices;
    if (!Array.isArray(devices) || devices.length === 0) {
        return res.status(400).json({ error: 'devices array gerekli' });
    }

    const results = { added: 0, skipped: 0, errors: [] };
    const existing = store.getSwitches();

    for (const raw of devices) {
        const payload = sanitizeSwitch(raw);

        // Minimum gerekli alanlar
        if (!payload.name || !payload.ip) {
            results.errors.push(`Satır atlandı: name ve ip gerekli (${payload.name || '?'})`);
            results.skipped++;
            continue;
        }

        // Duplicate IP kontrolü
        if (existing.find(s => s.ip === payload.ip)) {
            results.errors.push(`${payload.ip} zaten kayıtlı, atlandı`);
            results.skipped++;
            continue;
        }

        // SSH password şifrele
        if (payload.sshPassword) {
            payload.sshPassword = encryptPassword(payload.sshPassword);
        }

        // Tags string ise array'e çevir
        if (typeof payload.tags === 'string') {
            payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
        }

        const newSwitch = {
            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            status: 'DOWN', latency: 0,
            position: { x: Math.random() * 800, y: Math.random() * 600 },
            tags: [],
            type: 'switch',
            ...payload
        };

        store.addSwitch(newSwitch);
        existing.push(newSwitch);
        results.added++;
    }

    await logAction(req.user, 'BULK_IMPORT', `${results.added} devices added`);
    res.json(results);
});

module.exports = router;
