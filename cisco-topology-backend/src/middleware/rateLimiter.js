// Basit in-memory rate limiter (redis gerektirmez)

// ÖNEMLİ: Her limiter KENDİ sayacına sahip olmalı. Tek bir paylaşılan Map kullanılırsa
// (eski hâli) farklı limiter'lar birbirinin isteklerini sayar: 4sn'lik /topology poll'ü
// 5 dakikada ~75 kayıt biriktirip, 20/5dk limitli keşif limiter'ını anında 429'a düşürüyordu.
const buckets = new Set(); // temizlik için tüm sayaçların kaydı

function rateLimiter({ windowMs = 60000, max = 10, message = 'Too many requests, please wait' } = {}) {
    const attempts = new Map(); // bu limiter'a özel sayaç
    buckets.add(attempts);

    return (req, res, next) => {
        // Kimliği doğrulanmış istekleri kullanıcıya (token) göre anahtarla — Docker/proxy
        // arkasında tüm istemciler aynı IP'den görünüp tek kovayı paylaşmasın.
        // Doğrulanmamış istekler (login vb.) IP bazında kalır (brute-force koruması sürer).
        const key = req.cookies?.token || req.ip || req.connection.remoteAddress;
        const now = Date.now();

        const timestamps = (attempts.get(key) || []).filter(t => now - t < windowMs);
        timestamps.push(now);
        attempts.set(key, timestamps);

        if (timestamps.length > max) {
            return res.status(429).json({ error: message });
        }

        // Rate limit headers
        res.set('X-RateLimit-Limit', String(max));
        res.set('X-RateLimit-Remaining', String(Math.max(0, max - timestamps.length)));

        next();
    };
}

// Bellek temizliği (her 5 dakikada bir eski kayıtları sil)
setInterval(() => {
    const now = Date.now();
    for (const attempts of buckets) {
        for (const [key, timestamps] of attempts.entries()) {
            const valid = timestamps.filter(t => now - t < 300000);
            if (valid.length === 0) attempts.delete(key);
            else attempts.set(key, valid);
        }
    }
}, 300000);

module.exports = rateLimiter;
