const express = require('express');
const http = require('http');
const https = require('https');
const store = require('../utils/memoryStore');
const { authenticate } = require('../middleware/auth');
const { isBlockedIP } = require('../utils/validation');

const router = express.Router();

// Cihazın web arayüzüne backend üzerinden reverse proxy.
// Tarayıcının cihaz ağına doğrudan erişimi olmasa da, uygulamanın kurulu
// olduğu sunucu cihaza erişebildiği sürece arayüz kullanılabilir.
// URL şeması: /webproxy/:id/:scheme[/...cihaz içi yol]

const DROP_REQ_HEADERS = ['host', 'connection', 'upgrade', 'referer', 'origin'];

router.all('/webproxy/:id/:scheme{/*splat}', authenticate, (req, res) => {
    const { id, scheme } = req.params;
    if (scheme !== 'http' && scheme !== 'https') {
        return res.status(400).json({ error: 'Scheme must be http or https' });
    }
    const device = store.getSwitch(id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (isBlockedIP(device.ip)) return res.status(403).json({ error: 'Connection to this IP is not allowed' });

    // apiPrefix dahil proxy kökü — Location/Set-Cookie yeniden yazımında kullanılır
    const proxyBase = `${req.baseUrl}/webproxy/${id}/${scheme}`;

    const m = req.originalUrl.match(/\/webproxy\/[^/]+\/(?:http|https)(\/.*)?$/);
    const targetPath = (m && m[1]) || '/';

    // İstek başlıklarını süz
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (!DROP_REQ_HEADERS.includes(k)) headers[k] = v;
    }
    // Kendi oturum cookie'lerimizi cihaza sızdırma
    if (headers.cookie) {
        const kept = headers.cookie.split(';').map(s => s.trim())
            .filter(c => !c.startsWith('token=') && !c.startsWith('csrfToken='));
        if (kept.length) headers.cookie = kept.join('; ');
        else delete headers.cookie;
    }
    headers.host = device.ip;

    const mod = scheme === 'https' ? https : http;
    const preq = mod.request({
        host: device.ip,
        port: scheme === 'https' ? 443 : 80,
        method: req.method,
        path: targetPath,
        headers,
        rejectUnauthorized: false, // cihazlarda self-signed sertifika yaygın
        timeout: 15000
    }, (pres) => {
        // Global güvenlik başlıklarımız cihaz sayfasını/iframe'i bozmasın
        res.removeHeader('Content-Security-Policy');
        res.removeHeader('X-Frame-Options');

        const out = { ...pres.headers };
        delete out['x-frame-options'];
        delete out['content-security-policy'];
        delete out['strict-transport-security'];
        delete out['transfer-encoding'];
        delete out.connection;

        // Redirect'leri proxy altında tut
        if (out.location) {
            const abs = new RegExp(`^https?://${device.ip.replace(/\./g, '\\.')}(:\\d+)?`);
            if (abs.test(out.location)) out.location = out.location.replace(abs, proxyBase);
            else if (out.location.startsWith('/')) out.location = proxyBase + out.location;
        }

        // Cihaz cookie'lerini proxy yoluna kapsa; Secure/Domain'i temizle
        if (out['set-cookie']) {
            out['set-cookie'] = out['set-cookie'].map(c =>
                c.replace(/;\s*Path=[^;]*/i, `; Path=${proxyBase}`)
                 .replace(/;\s*Domain=[^;]*/i, '')
                 .replace(/;\s*Secure/i, '')
            );
        }

        res.writeHead(pres.statusCode, out);
        pres.pipe(res);
    });

    preq.on('timeout', () => preq.destroy(new Error('Connection timed out')));
    preq.on('error', (err) => {
        if (!res.headersSent) {
            res.status(502).json({ error: `Device unreachable over ${scheme}: ${err.message}` });
        } else {
            try { res.end(); } catch { /* ignore */ }
        }
    });

    // Gövdeyi ilet — JSON gövdeler express.json tarafından tüketilmiş olabilir
    if (req.headers['content-type']?.includes('application/json') && req.body !== undefined) {
        preq.end(JSON.stringify(req.body));
    } else {
        req.pipe(preq);
    }
});

module.exports = router;
