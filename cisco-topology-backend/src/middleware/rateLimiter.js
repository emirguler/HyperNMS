// Basit in-memory rate limiter (redis gerektirmez)
const attempts = new Map();

function rateLimiter({ windowMs = 60000, max = 10, message = 'Çok fazla istek, lütfen bekleyin' } = {}) {
    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();

        if (!attempts.has(key)) {
            attempts.set(key, []);
        }

        const timestamps = attempts.get(key).filter(t => now - t < windowMs);
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
    for (const [key, timestamps] of attempts.entries()) {
        const valid = timestamps.filter(t => now - t < 300000);
        if (valid.length === 0) {
            attempts.delete(key);
        } else {
            attempts.set(key, valid);
        }
    }
}, 300000);

module.exports = rateLimiter;
