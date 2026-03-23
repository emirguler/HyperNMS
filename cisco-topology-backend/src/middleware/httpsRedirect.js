const fs = require('fs');
const https = require('https');
const path = require('path');

function setupHttps(server, app, port) {
    const certPath = process.env.SSL_CERT || path.resolve(__dirname, '../../certs/cert.pem');
    const keyPath = process.env.SSL_KEY || path.resolve(__dirname, '../../certs/key.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        const httpsServer = https.createServer({
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
        }, app);

        console.log(`[HTTPS] SSL sertifikaları bulundu, HTTPS aktif`);
        return { server: httpsServer, protocol: 'https' };
    }

    console.log('[HTTPS] SSL sertifikaları bulunamadı, HTTP modunda çalışılıyor');
    console.log('[HTTPS] Self-signed sertifika oluşturmak için: npm run generate-certs');
    return { server, protocol: 'http' };
}

module.exports = { setupHttps };
