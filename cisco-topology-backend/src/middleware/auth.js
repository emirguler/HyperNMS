const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config');

// JWT kimlik doğrulama
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Token gerekli' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token formatı hatalı' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Oturum süresi doldu, tekrar giriş yapın' });
            }
            return res.status(403).json({ error: 'Geçersiz token' });
        }
        req.user = user;
        next();
    });
};

// Admin yetkisi kontrolü
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'Administrator') {
        return res.status(403).json({ error: 'Bu işlem için Administrator yetkisi gerekli' });
    }
    next();
};

// WebSocket JWT doğrulaması
function authenticateWs(req) {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) return null;
    try {
        return jwt.verify(token, SECRET_KEY);
    } catch {
        return null;
    }
}

module.exports = { authenticate, requireAdmin, authenticateWs };
