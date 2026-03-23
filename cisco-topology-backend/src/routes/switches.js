const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch } = require('../utils/validation');
const { encryptPassword, decryptPassword } = require('../utils/crypto');
const { getDeviceDetails } = require('../services/snmpService');
const { logAction } = require('../services/auditLog');
const { snmpCache } = require('../utils/cache');
const ssh2 = require('ssh2').Client;

const router = express.Router();

router.get('/topology', authenticate, (req, res) => {
    const switches = store.getSwitches();
    const edges = store.getEdges();
    const isAdmin = req.user.role === 'Administrator';
    const safeSwitches = switches.map(({ sshPassword, ...s }) => {
        if (!isAdmin) { delete s.sshUsername; delete s.snmpCommunity; }
        return s;
    });
    res.json({ switches: safeSwitches, edges });
});

router.post('/switches', authenticate, requireAdmin, async (req, res) => {
    const payload = sanitizeSwitch(req.body);
    const errors = validateSwitch(payload);
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });

    if (store.getSwitches().find(s => s.ip === payload.ip)) {
        return res.status(400).json({ error: 'This IP address is already registered' });
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
        const errors = validateSwitch({ ...payload, name: payload.name || 'tmp' }).filter(e => !e.includes('Device name'));
        if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });
    }

    if (payload.sshPassword) {
        payload.sshPassword = encryptPassword(payload.sshPassword);
    } else {
        delete payload.sshPassword;
    }

    const updated = store.updateSwitch(req.params.id, payload);
    if (!updated) return res.status(404).json({ error: 'Device not found' });

    if (!isPositionOnly) await logAction(req.user, 'DEVICE_UPDATE', updated.name, { ip: updated.ip });
    res.json({ ...updated, sshPassword: undefined });
});

router.delete('/switches/:id', authenticate, requireAdmin, async (req, res) => {
    const target = store.getSwitch(req.params.id);
    if (!target) return res.status(404).json({ error: 'Device not found' });

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
    // Admin can see SNMP community, SSH username, and password status
    if (req.user.role === 'Administrator') {
        details.snmpCommunity = device.snmpCommunity || '';
        details.sshUsername = device.sshUsername || '';
        details.sshPasswordSet = !!(device.sshPassword && device.sshPassword.length > 0);
        details.model = device.model || '';
    }
    res.json(details);
});

router.get('/switches/:id/ping-history', authenticate, (req, res) => {
    const duration = parseInt(req.query.duration) || 3600000;
    const since = Date.now() - duration;
    const history = store.getHistory(req.params.id, since);
    res.json(history);
});

// SSH komutu çalıştır (show run vb.)
router.post('/switches/:id/exec', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (!device.sshUsername || !device.sshPassword) return res.status(400).json({ error: 'SSH credentials missing' });

    const command = req.body.command;
    if (!command || typeof command !== 'string' || command.length > 500) {
        return res.status(400).json({ error: 'Valid command required (max 500 chars)' });
    }

    // Security: strict whitelist — only read-only commands allowed
    const cmd = command.trim().toLowerCase();
    const ALLOWED_PREFIXES = [
        'show ', 'display ', 'ping ', 'traceroute ',
        'dir', 'more '
    ];
    if (!ALLOWED_PREFIXES.some(p => cmd.startsWith(p) || cmd === p.trim())) {
        return res.status(403).json({ error: 'Only read-only commands (show, display, ping, traceroute) are allowed' });
    }

    // Block pipe/redirect that could exfiltrate data
    const BLOCKED_PIPES = ['redirect', 'tee', 'append', '>', 'tftp:', 'ftp:', 'scp:', 'http:'];
    if (BLOCKED_PIPES.some(b => cmd.includes(b))) {
        return res.status(403).json({ error: 'Output redirection is not allowed' });
    }

    const cacheKey = `exec:${device.id}:${command}`;
    const cached = snmpCache.get(cacheKey);
    if (cached) return res.json({ output: cached });

    try {
        const output = await new Promise((resolve, reject) => {
            const conn = new ssh2();
            let result = '';
            let dataTimeout = null;
            const hardTimeout = setTimeout(() => { conn.end(); resolve(result); }, 20000);

            conn.on('ready', () => {
                // Cisco IOS shell modunda çalıştır (exec desteklemiyor)
                conn.shell((err, stream) => {
                    if (err) { clearTimeout(hardTimeout); conn.end(); return reject(err); }

                    stream.on('data', (data) => {
                        result += data.toString();
                        // Her veri geldiğinde timer'ı sıfırla — 2 saniye veri gelmezse bitir
                        if (dataTimeout) clearTimeout(dataTimeout);
                        dataTimeout = setTimeout(() => {
                            clearTimeout(hardTimeout);
                            stream.end();
                            conn.end();
                            resolve(result);
                        }, 2000);
                    });

                    stream.on('close', () => {
                        clearTimeout(hardTimeout);
                        if (dataTimeout) clearTimeout(dataTimeout);
                        conn.end();
                        resolve(result);
                    });

                    // terminal length 0 ile paging'i kapat, sonra komutu çalıştır
                    stream.write('terminal length 0\n');
                    setTimeout(() => stream.write(command + '\n'), 500);
                });
            }).on('error', (err) => {
                clearTimeout(hardTimeout);
                reject(err);
            }).connect({
                host: device.ip, port: 22,
                username: device.sshUsername,
                password: decryptPassword(device.sshPassword),
                algorithms: {
                    kex: ["ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha1"],
                    cipher: ["aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-cbc"],
                    serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384"]
                }
            });
        });

        // Çıktıyı temizle — ANSI escape kodlarını ve prompt'ları kaldır
        const cleanOutput = output
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape
            .replace(/\r/g, '')                      // carriage return
            .split('\n')
            .filter(line => !line.includes('terminal length 0')) // komut echo'sunu kaldır
            .join('\n')
            .trim();

        snmpCache.set(cacheKey, cleanOutput, 120000); // 2 dakika cache
        await logAction(req.user, 'SSH_EXEC', device.name, { command });
        res.json({ output: cleanOutput });
    } catch (err) {
        res.status(500).json({ error: 'SSH error:' + err.message });
    }
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
