const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');
const { getStatus, applyLicense } = require('../services/licenseService');

const router = express.Router();

// Lisans durumu — her oturum (guard/banner icin). Kurulum kimligi de doner (admin
// bunu ureticiye yollar; hassas degil, rastgele UUID).
router.get('/license', authenticate, (req, res) => {
    res.json(getStatus());
});

// Yeni lisans anahtari uygula — yalniz admin.
router.put('/license', authenticate, requireAdmin, async (req, res) => {
    const key = req.body && req.body.key;
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'Lisans anahtarı gerekli.' });
    const r = applyLicense(key);
    if (!r.ok) return res.status(400).json({ error: r.error });
    await logAction(req.user, 'LICENSE_APPLY', r.status.customer || '-', { edition: r.status.edition, expiresAt: r.status.expiresAt });
    res.json(r.status);
});

module.exports = router;
