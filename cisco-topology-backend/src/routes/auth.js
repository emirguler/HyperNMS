const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { readJSON } = require('../utils/db');
const { SECRET_KEY, DB_USERS, JWT_EXPIRY } = require('../config');
const rateLimiter = require('../middleware/rateLimiter');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Login — rate limited (5 deneme/dakika)
router.post('/login', rateLimiter({ windowMs: 60000, max: 5, message: 'Çok fazla giriş denemesi, 1 dakika bekleyin' }), async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve parola gereklidir' });
    }

    const users = readJSON(DB_USERS);
    const user = users.find(u => u.username === username);
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
    res.json({ token, role: user.role });
});

module.exports = router;
