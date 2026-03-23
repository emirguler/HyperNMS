const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const store = require('../utils/memoryStore');
const { SECRET_KEY, JWT_EXPIRY, BCRYPT_ROUNDS } = require('../config');
const rateLimiter = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Login — rate limited (5 deneme/dakika)
router.post('/login', rateLimiter({ windowMs: 60000, max: 5, message: 'Çok fazla giriş denemesi, 1 dakika bekleyin' }), async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve parola gereklidir' });
    }

    const user = store.getUserByUsername(username);
    if (!user) {
        return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        await logAction({ username }, 'LOGIN_FAILED', username, { ip: req.ip });
        return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        SECRET_KEY,
        { expiresIn: JWT_EXPIRY }
    );

    await logAction(user, 'LOGIN', username, { ip: req.ip });
    res.json({
        token,
        role: user.role,
        mustChangePassword: user.mustChangePassword || false
    });
});

// Zorunlu parola değiştirme
router.post('/change-password', authenticate, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Yeni parola en az 6 karakter olmalıdır' });
    }

    const user = store.getUser(req.user.id);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Mevcut parola kontrolü (zorunlu değiştirme hariç)
    if (!user.mustChangePassword) {
        if (!currentPassword) return res.status(400).json({ error: 'Mevcut parola gereklidir' });
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Mevcut parola yanlış' });
    }

    store.updateUser(req.user.id, {
        password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false
    });

    await logAction(req.user, 'PASSWORD_CHANGE', req.user.username);
    res.json({ success: true });
});

module.exports = router;
