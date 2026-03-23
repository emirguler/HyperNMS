const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch } = require('../utils/validation');
const { encryptPassword } = require('../utils/crypto');
const { getDeviceDetails } = require('../services/snmpService');
const { logAction } = require('../services/auditLog');

const router = express.Router();

router.get('/topology', authenticate, (req, res) => {
    const switches = store.getSwitches();
    const edges = store.getEdges();
    const safeSwitches = switches.map(({ sshPassword, sshUsername, snmpCommunity, ...s }) => s);
    res.json({ switches: safeSwitches, edges });
});

router.post('/switches', authenticate, requireAdmin, async (req, res) => {
    const payload = sanitizeSwitch(req.body);
    const errors = validateSwitch(payload);
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });

    if (store.getSwitches().find(s => s.ip === payload.ip)) {
        return res.status(400).json({ error: 'Bu IP adresi zaten kayıtlı' });
    }

    if (payload.sshPassword) payload.sshPassword = encryptPassword(payload.sshPassword);

    const newSwitch = { id: Date.now().toString(), status: 'DOWN', latency: 0, position: { x: 0, y: 0 }, tags: [], ...payload };
    store.addSwitch(newSwitch);

    await logAction(req.user, 'DEVICE_CREATE', newSwitch.name, { ip: newSwitch.ip, type: newSwitch.type });
    res.json({ ...newSwitch, sshPassword: undefined });
});

router.put('/switches/:id', authenticate, requireAdmin, async (req, res) => {
    const payload = sanitizeSwitch(req.body);
    const isPositionOnly = Object.keys(payload).length === 1 && payload.position;

    if (!isPositionOnly && payload.ip) {
        const errors = validateSwitch({ ...payload, name: payload.name || 'tmp' }).filter(e => !e.includes('Cihaz adı'));
        if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });
    }

    if (payload.sshPassword) {
        payload.sshPassword = encryptPassword(payload.sshPassword);
    } else {
        delete payload.sshPassword;
    }

    const updated = store.updateSwitch(req.params.id, payload);
    if (!updated) return res.status(404).json({ error: 'Cihaz bulunamadı' });

    if (!isPositionOnly) await logAction(req.user, 'DEVICE_UPDATE', updated.name, { ip: updated.ip });
    res.json({ ...updated, sshPassword: undefined });
});

router.delete('/switches/:id', authenticate, requireAdmin, async (req, res) => {
    const target = store.getSwitch(req.params.id);
    if (!target) return res.status(404).json({ error: 'Cihaz bulunamadı' });

    store.deleteSwitch(req.params.id);
    // İlgili edge'leri de sil
    store.getEdges().filter(e => e.source === req.params.id || e.target === req.params.id)
        .forEach(e => store.deleteEdge(e.id));

    await logAction(req.user, 'DEVICE_DELETE', target.name, { ip: target.ip });
    res.json({ success: true });
});

router.get('/switches/:id/details', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).send();
    const details = await getDeviceDetails(device);
    res.json(details);
});

router.get('/switches/:id/ping-history', authenticate, (req, res) => {
    const duration = parseInt(req.query.duration) || 3600000;
    const since = Date.now() - duration;
    const history = store.getHistory(req.params.id, since);
    res.json(history);
});

router.get('/switches/export/csv', authenticate, (req, res) => {
    const switches = store.getSwitches();
    const headers = ['Name', 'IP', 'Type', 'Status', 'Latency', 'Model', 'Tags'];
    const rows = switches.map(s => [
        s.name, s.ip, s.type || 'switch', s.status, s.latency, s.model || '', (s.tags || []).join(';')
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=devices.csv');
    res.send(csv);
});

module.exports = router;
