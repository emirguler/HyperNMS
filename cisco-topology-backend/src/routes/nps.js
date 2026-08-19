const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { encryptPassword, decryptPassword } = require('../utils/crypto');
const { isValidHost, isBlockedIP } = require('../utils/validation');
const { logAction } = require('../services/auditLog');
const store = require('../utils/memoryStore');
const nps = require('../services/npsService');

const router = express.Router();

/* ============================================================================
   NPS (Linux FreeRADIUS) — YALNIZCA ADMIN

   SSH ile NPS sunucusuna baglanip /etc/freeradius/3.0/users kayitlarini goruntule/
   duzenle ve "service freeradius restart" calistir. SSH sifresi sifreli saklanir
   ve istemciye asla donmez.
   ========================================================================== */

// Ayari disariya guvenli (sifre maskeli) dondur
function maskConfig() {
    const c = store.getSettings().nps || {};
    return {
        configured: !!(c.host && c.username && c.password),
        host: c.host || '',
        port: Number(c.port) > 0 ? Number(c.port) : 22,
        username: c.username || '',
        passwordSet: !!c.password,
        usersFile: nps.USERS_FILE,
    };
}

// Mevcut NPS SSH ayarini getir (sifre maskeli)
router.get('/nps/config', authenticate, requireAdmin, (req, res) => {
    res.json(maskConfig());
});

// NPS SSH ayarini kaydet. Sifre sifreli saklanir; bos gonderilirse mevcut korunur.
router.put('/nps/config', authenticate, requireAdmin, async (req, res) => {
    const b = req.body || {};
    const cur = store.getSettings().nps || {};

    const host = String(b.host || '').trim();
    const username = String(b.username || '').trim();
    const port = Number(b.port) > 0 && Number(b.port) <= 65535 ? Number(b.port) : 22;

    if (host && (!isValidHost(host) || isBlockedIP(host))) {
        return res.status(400).json({ error: 'Host must be a valid IP/hostname and not a reserved address' });
    }
    if (username.length > 64) return res.status(400).json({ error: 'Username cannot exceed 64 characters' });

    const npsCfg = {
        host, port, username,
        password: cur.password || '',
    };
    // Yeni sifre verildiyse sifrele; verilmediyse mevcut (sifreli) korunur.
    if (typeof b.password === 'string' && b.password.length > 0) {
        npsCfg.password = encryptPassword(b.password);
    }

    store.updateSettings({ nps: npsCfg });
    await logAction(req.user, 'NPS_CONFIG_UPDATE', host || '(cleared)', { ip: req.ip, host, username });
    res.json(maskConfig());
});

// Baglanti testi — form degerleriyle; sifre bosken kayitli (sifreli) olan cozulur.
router.post('/nps/config/test', authenticate, requireAdmin, async (req, res) => {
    const b = req.body || {};
    const cur = store.getSettings().nps || {};
    const cfg = {
        host: String(b.host || '').trim(),
        port: Number(b.port) > 0 ? Number(b.port) : 22,
        username: String(b.username || '').trim(),
        password: (typeof b.password === 'string' && b.password.length > 0)
            ? b.password
            : (cur.password ? decryptPassword(cur.password) : ''),
    };
    try {
        const r = await nps.testConnection(cfg);
        res.json(r);
    } catch (e) {
        res.status(e.status || 502).json({ ok: false, error: e.message || 'Test failed' });
    }
});

// Kayitlari listele (users dosyasindan cek)
router.get('/nps/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const entries = await nps.readUsers();
        res.json({ entries, usersFile: nps.USERS_FILE });
    } catch (e) {
        res.status(e.status || 502).json({ error: e.message || 'Could not read NPS users' });
    }
});

// Yeni kayit ekle
router.post('/nps/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const entries = await nps.addEntry(req.body || {});
        await logAction(req.user, 'NPS_USER_ADD', String((req.body && req.body.gsm) || ''), {
            ip: req.ip, gsm: req.body && req.body.gsm, framedIp: req.body && req.body.ip,
        });
        res.json({ entries });
    } catch (e) {
        res.status(e.status || 502).json({ error: e.message || 'Could not add the entry' });
    }
});

// Tek kaydi duzenle
router.put('/nps/users/:id', authenticate, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0) return res.status(400).json({ error: 'Invalid entry id' });
    try {
        const entries = await nps.saveEntry(id, req.body || {});
        await logAction(req.user, 'NPS_USER_EDIT', String((req.body && req.body.gsm) || id), {
            ip: req.ip, gsm: req.body && req.body.gsm, framedIp: req.body && req.body.ip,
        });
        res.json({ entries });
    } catch (e) {
        res.status(e.status || 502).json({ error: e.message || 'Could not save the entry' });
    }
});

// Kaydi sil (originalGsm govdede — telefon numarasi URL/loglara yazilmasin diye)
router.delete('/nps/users/:id', authenticate, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0) return res.status(400).json({ error: 'Invalid entry id' });
    try {
        const originalGsm = req.body && req.body.originalGsm;
        const entries = await nps.deleteEntry(id, originalGsm);
        await logAction(req.user, 'NPS_USER_DELETE', String(originalGsm || id), { ip: req.ip, gsm: originalGsm });
        res.json({ entries });
    } catch (e) {
        res.status(e.status || 502).json({ error: e.message || 'Could not delete the entry' });
    }
});

// Lokasyon kaydet (UI-only metadata — SSH YOK, users dosyasina yazilmaz).
// Yalnizca lokasyon degistiginde cagrilir; NPS erisilemez olsa bile calisir.
router.put('/nps/locations', authenticate, requireAdmin, async (req, res) => {
    const b = req.body || {};
    const gsm = String(b.gsm || '').trim();
    if (!/^\d{1,20}$/.test(gsm)) return res.status(400).json({ error: 'Invalid GSM number' });
    const locations = nps.setLocation(gsm, b.location, b.previousGsm);
    await logAction(req.user, 'NPS_LOCATION_SET', gsm, { ip: req.ip });
    res.json({ locations });
});

// service freeradius restart
router.post('/nps/restart', authenticate, requireAdmin, async (req, res) => {
    try {
        const r = await nps.restart();
        await logAction(req.user, 'NPS_SERVICE_RESTART', r.ok ? 'success' : 'failed', { ip: req.ip, code: r.code });
        res.json(r);
    } catch (e) {
        res.status(e.status || 502).json({ ok: false, error: e.message || 'Restart failed' });
    }
});

module.exports = router;
