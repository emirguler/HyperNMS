const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const store = require('../utils/memoryStore');
const { SECRET_KEY, JWT_EXPIRY, BCRYPT_ROUNDS } = require('../config');
const rateLimiter = require('../middleware/rateLimiter');
const { authenticate, setTokenCookie, clearTokenCookie } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Password strength validator
function validatePasswordStrength(password) {
    if (!password || password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
    return null;
}

const loginLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10, message: 'Too many login attempts, please try again in 5 minutes' });

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Generic error message to prevent user enumeration (M5)
    const INVALID_MSG = 'Invalid username or password';

    const user = store.getUserByUsername(username);
    if (!user) {
        // Constant-time delay to prevent timing attacks
        await bcrypt.hash('dummy', 4);
        return res.status(401).json({ error: INVALID_MSG });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        await logAction({ username }, 'LOGIN_FAILED', username, { ip: req.ip });
        return res.status(401).json({ error: INVALID_MSG });
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        SECRET_KEY,
        { expiresIn: JWT_EXPIRY }
    );

    // Set httpOnly cookie (C2)
    setTokenCookie(res, token);

    await logAction(user, 'LOGIN', username, { ip: req.ip });
    res.json({
        role: user.role,
        username: user.username,
        mustChangePassword: user.mustChangePassword || false,
        allowedCommands: user.allowedCommands || []
    });
});

// Logout — clear cookie
router.post('/logout', (req, res) => {
    clearTokenCookie(res);
    res.json({ success: true });
});

// Session check — verify current cookie/token is valid
router.get('/me', authenticate, (req, res) => {
    const user = store.getUser(req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword || false,
        allowedCommands: user.allowedCommands || []
    });
});

// Password change (H5: strong password policy)
router.post('/change-password', authenticate, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    // Strong password validation
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
        return res.status(400).json({ error: strengthError });
    }

    const user = store.getUser(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Current password check (except forced change)
    if (!user.mustChangePassword) {
        if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Don't allow reusing the same password
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) return res.status(400).json({ error: 'New password must be different from current password' });

    store.updateUser(req.user.id, {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false
    });

    await logAction(req.user, 'PASSWORD_CHANGE', req.user.username);
    res.json({ success: true });
});

module.exports = router;
