const jwt = require('jsonwebtoken');
const { SECRET_KEY, NODE_ENV } = require('../config');

// Cookie options
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    path: '/'
};

// Set JWT as httpOnly cookie
function setTokenCookie(res, token) {
    res.cookie('token', token, COOKIE_OPTIONS);
}

// Clear JWT cookie
function clearTokenCookie(res) {
    res.clearCookie('token', { path: '/' });
}

// JWT authentication — reads from cookie first, then Authorization header as fallback
const authenticate = (req, res, next) => {
    let token = req.cookies?.token;

    // Fallback: Authorization header (for API clients)
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader) token = authHeader.split(' ')[1];
    }

    if (!token) return res.status(401).json({ error: 'Authentication required' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                clearTokenCookie(res);
                return res.status(401).json({ error: 'Session expired, please login again' });
            }
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Admin role check
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'Administrator') {
        return res.status(403).json({ error: 'Administrator privileges required' });
    }
    next();
};

// WebSocket JWT — reads from cookie in upgrade request, then query param fallback
function authenticateWs(req) {
    // Try cookie first
    let token = null;
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
        if (match) token = match[1];
    }

    // Fallback: query param (for clients that can't send cookies on WS)
    if (!token) {
        const url = new URL(req.url, 'http://localhost');
        token = url.searchParams.get('token');
    }

    if (!token) return null;
    try {
        return jwt.verify(token, SECRET_KEY);
    } catch {
        return null;
    }
}

module.exports = { authenticate, requireAdmin, authenticateWs, setTokenCookie, clearTokenCookie, COOKIE_OPTIONS };
