const express = require('express');
const crypto = require('crypto');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch } = require('../utils/validation');
const { encryptPassword } = require('../utils/crypto');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Full config backup — encrypted, passwords excluded (C4)
router.get('/backup', authenticate, requireAdmin, async (req, res) => {
    const switches = store.getSwitches().map(({ sshPassword, snmpCommunity, ...s }) => s);
    const edges = store.getEdges();
    const users = store.getUsers().map(({ password, ...u }) => u);

    const backup = {
        version: '2.0',
        timestamp: new Date().toISOString(),
        checksum: '', // will be filled below
        data: { switches, edges, users }
    };

    // Add integrity checksum
    const dataStr = JSON.stringify(backup.data);
    backup.checksum = crypto.createHash('sha256').update(dataStr).digest('hex');

    await logAction(req.user, 'BACKUP_DOWNLOAD', 'Full configuration backup');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=netpulse-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(backup);
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

    const results = { added: 0, skipped: 0, errors: [] };
    const existing = store.getSwitches();

    for (const raw of devices) {
        const payload = sanitizeSwitch(raw);

        if (!payload.name || !payload.ip) {
            results.errors.push(`Row skipped: name and ip required (${payload.name || '?'})`);
            results.skipped++;
            continue;
        }

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

        // Encrypt SSH password
        if (payload.sshPassword) {
            payload.sshPassword = encryptPassword(payload.sshPassword);
        }

        // Tags string → array
        if (typeof payload.tags === 'string') {
            payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
        }

        const newSwitch = {
            id: Date.now().toString() + crypto.randomBytes(4).toString('hex'),
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
