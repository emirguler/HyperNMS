const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');
const vuln = require('../services/vulnService');
const vulnSync = require('../services/vulnSyncService');

const router = express.Router();

// Cevrimici senkron durumu (kimlik var mi, son senkron, calisiyor mu)
router.get('/vuln/sync-status', authenticate, (req, res) => {
    res.json(vulnSync.getStatus());
});

// Simdi senkronla: sunucu Cisco openVuln + KEV'i sorgular, feed'i uretir ve yukler.
// Kac dakika surebilir (surum basina ~1sn); istek tamamlanana kadar bekler.
router.post('/vuln/sync', authenticate, requireAdmin, async (req, res) => {
    try {
        const r = await vulnSync.runSync(req.user, { withKev: !(req.body && req.body.noKev) });
        await logAction(req.user, 'VULN_SYNC', `${r.stats.advisories} advisories, ${r.stats.versions} versions, ${r.stats.newRelevant} new relevant`);
        res.json({ ok: true, lastSync: r, feed: vuln.feedMeta() });
    } catch (e) {
        await logAction(req.user, 'VULN_SYNC_FAILED', e.message);
        res.status(500).json({ error: e.message || 'Sync failed' });
    }
});

// Feed durumu (hafif) — sayfa basligi/rozet icin
router.get('/vuln/status', authenticate, (req, res) => {
    res.json(vuln.feedMeta());
});

// Tum sayfa verisi (ozet, surume gore, cihazlar, duyurular)
router.get('/vuln/overview', authenticate, (req, res) => {
    try { res.json(vuln.buildOverview()); }
    catch (e) { res.status(500).json({ error: 'Could not build overview: ' + e.message }); }
});

// Envanter disari aktar: tools/vuln-feed'in girdisi. Yalnizca admin (ag envanteri).
router.get('/vuln/inventory', authenticate, requireAdmin, async (req, res) => {
    const inv = vuln.buildInventory();
    await logAction(req.user, 'VULN_INVENTORY_EXPORT', `${inv.versions.length} version(s)`);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=netpulse-vuln-inventory-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(inv);
});

// Feed ice aktar (tools/vuln-feed ciktisi). Yalnizca admin.
router.post('/vuln/feed', authenticate, requireAdmin, async (req, res) => {
    try {
        const r = vuln.importFeed(req.body, req.user);
        await logAction(req.user, 'VULN_FEED_IMPORT', `${r.advisories} advisories, ${r.versions} versions, ${r.newRelevant} new relevant`);
        res.json({ ok: true, ...r, feed: vuln.feedMeta() });
    } catch (e) {
        res.status(400).json({ error: e.message || 'Invalid feed' });
    }
});

router.delete('/vuln/feed', authenticate, requireAdmin, async (req, res) => {
    vuln.clearFeed();
    await logAction(req.user, 'VULN_FEED_CLEAR', 'feed removed');
    res.json({ ok: true });
});

// Duyuruyu "kabul edildi / mitigasyon uygulandi" olarak isaretle (sayimlardan duser).
router.put('/vuln/ack/:id', authenticate, requireAdmin, async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^cisco-sa-[A-Za-z0-9_-]{2,80}$/.test(id)) return res.status(400).json({ error: 'Invalid advisory id' });
    vuln.setAck(id, req.user, req.body && req.body.note);
    await logAction(req.user, 'VULN_ACK', id, { note: String((req.body && req.body.note) || '').slice(0, 300) });
    res.json({ ok: true });
});

router.delete('/vuln/ack/:id', authenticate, requireAdmin, async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^cisco-sa-[A-Za-z0-9_-]{2,80}$/.test(id)) return res.status(400).json({ error: 'Invalid advisory id' });
    vuln.clearAck(id);
    await logAction(req.user, 'VULN_UNACK', id);
    res.json({ ok: true });
});

module.exports = router;
