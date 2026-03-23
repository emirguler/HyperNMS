const express = require('express');
const { readJSON, writeJSON } = require('../utils/db');
const { DB_SWITCHES, DB_EDGES, DB_HISTORY } = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch } = require('../utils/validation');
const { encryptPassword } = require('../utils/crypto');
const { getDeviceDetails } = require('../services/snmpService');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Tüm cihazlar + bağlantılar (topology)
router.get('/topology', authenticate, (req, res) => {
    const switches = readJSON(DB_SWITCHES);
    const edges = readJSON(DB_EDGES);
    const safeSwitches = switches.map(({ sshPassword, sshUsername, snmpCommunity, ...s }) => s);
    res.json({ switches: safeSwitches, edges });
});

// Cihaz ekle
router.post('/switches', authenticate, requireAdmin, async (req, res) => {
    const payload = sanitizeSwitch(req.body);
    const errors = validateSwitch(payload);
    if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(', ') });
    }

    const switches = readJSON(DB_SWITCHES);

    // Aynı IP kontrolü
    if (switches.find(s => s.ip === payload.ip)) {
        return res.status(400).json({ error: 'Bu IP adresi zaten kayıtlı' });
    }

    if (payload.sshPassword) {
        payload.sshPassword = encryptPassword(payload.sshPassword);
    }

    const newSwitch = {
        id: Date.now().toString(),
        status: 'DOWN',
        latency: 0,
        position: { x: 0, y: 0 },
        tags: [],
        ...payload
    };

    switches.push(newSwitch);
    writeJSON(DB_SWITCHES, switches);

    await logAction(req.user, 'DEVICE_CREATE', newSwitch.name, { ip: newSwitch.ip, type: newSwitch.type });
    res.json({ ...newSwitch, sshPassword: undefined });
});

// Cihaz güncelle
router.put('/switches/:id', authenticate, requireAdmin, async (req, res) => {
    const payload = sanitizeSwitch(req.body);

    // Position güncellemesi için validasyon atla
    const isPositionOnly = Object.keys(payload).length === 1 && payload.position;
    if (!isPositionOnly) {
        // Eğer sadece position değilse, name ve ip zorunlu değil (partial update)
        if (payload.ip) {
            const errors = validateSwitch({ ...payload, name: payload.name || 'tmp' });
            const filtered = errors.filter(e => !e.includes('Cihaz adı'));
            if (filtered.length > 0) {
                return res.status(400).json({ error: filtered.join(', ') });
            }
        }
    }

    let switches = readJSON(DB_SWITCHES);
    const index = switches.findIndex(s => s.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }

    if (payload.sshPassword) {
        payload.sshPassword = encryptPassword(payload.sshPassword);
    } else {
        delete payload.sshPassword;
    }

    switches[index] = { ...switches[index], ...payload };
    writeJSON(DB_SWITCHES, switches);

    if (!isPositionOnly) {
        await logAction(req.user, 'DEVICE_UPDATE', switches[index].name, { ip: switches[index].ip });
    }

    res.json({ ...switches[index], sshPassword: undefined });
});

// Cihaz sil
router.delete('/switches/:id', authenticate, requireAdmin, async (req, res) => {
    let switches = readJSON(DB_SWITCHES);
    const target = switches.find(s => s.id === req.params.id);
    if (!target) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }

    switches = switches.filter(s => s.id !== req.params.id);
    let edges = readJSON(DB_EDGES);
    edges = edges.filter(e => e.source !== req.params.id && e.target !== req.params.id);
    writeJSON(DB_EDGES, edges);
    writeJSON(DB_SWITCHES, switches);

    await logAction(req.user, 'DEVICE_DELETE', target.name, { ip: target.ip });
    res.json({ success: true });
});

// SNMP detayları
router.get('/switches/:id/details', authenticate, async (req, res) => {
    const switches = readJSON(DB_SWITCHES);
    const device = switches.find(s => s.id === req.params.id);
    if (!device) return res.status(404).send();

    const details = await getDeviceDetails(device);
    res.json(details);
});

// Ping history
router.get('/switches/:id/ping-history', authenticate, (req, res) => {
    const history = readJSON(DB_HISTORY);
    const duration = parseInt(req.query.duration) || 3600000;
    const since = Date.now() - duration;
    const filtered = history.filter(h => h.switchId === req.params.id && h.timestamp > since);
    res.json(filtered);
});

// Dışa aktarma (CSV)
router.get('/switches/export/csv', authenticate, (req, res) => {
    const switches = readJSON(DB_SWITCHES);
    const headers = ['Name', 'IP', 'Type', 'Status', 'Latency', 'Model', 'Tags'];
    const rows = switches.map(s => [
        s.name, s.ip, s.type || 'switch', s.status, s.latency,
        s.model || '', (s.tags || []).join(';')
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=devices.csv');
    res.send(csv);
});

module.exports = router;
