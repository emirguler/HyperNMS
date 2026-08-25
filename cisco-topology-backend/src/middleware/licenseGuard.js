const { isBlocked } = require('../services/licenseService');

// Lisans blokeliyken (suresi dolmus / yanlis kurulum) YAZMA isteklerini reddet.
// Okuma (GET) aciktir → Dashboard calismaya devam eder. /auth (giris) ve /license
// (yeni lisans girme) her zaman acik. Frontend sayfa-kilidinin backend savunmasidir.
function licenseGuard(req, res, next) {
    const m = req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    const p = req.path || '';
    if (p.startsWith('/auth') || p.startsWith('/license')) return next();
    if (isBlocked()) {
        return res.status(403).json({ error: 'license_expired', message: 'Lisans süresi doldu — lütfen yenileyin.' });
    }
    next();
}

module.exports = licenseGuard;
