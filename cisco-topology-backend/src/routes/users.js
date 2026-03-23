const express = require('express');
const bcrypt = require('bcryptjs');
const { readJSON, writeJSON } = require('../utils/db');
const { DB_USERS, BCRYPT_ROUNDS } = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateUser, sanitizeUser } = require('../utils/validation');
const { logAction } = require('../services/auditLog');

const router = express.Router();

router.get('/users', authenticate, (req, res) => {
    const users = readJSON(DB_USERS);
    const safeUsers = users.map(({ password, ...u }) => u);
    res.json(safeUsers);
});

router.post('/users', authenticate, requireAdmin, async (req, res) => {
    const data = sanitizeUser(req.body);
    const errors = validateUser(data, false);
    if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(', ') });
    }

    const users = readJSON(DB_USERS);

    if (users.find(u => u.username === data.username)) {
        return res.status(400).json({ error: 'Bu kullanıcı adı zaten mevcut' });
    }

    const hashedPw = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const newUser = {
        id: Date.now(),
        username: data.username,
        password: hashedPw,
        role: data.role || 'User'
    };
    users.push(newUser);
    writeJSON(DB_USERS, users);

    await logAction(req.user, 'USER_CREATE', newUser.username);
    const { password, ...safeUser } = newUser;
    res.json(safeUser);
});

router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
    const data = sanitizeUser(req.body);
    const errors = validateUser(data, true);
    if (errors.length > 0) {
        return res.status(400).json({ error: errors.join(', ') });
    }

    const users = readJSON(DB_USERS);
    const idx = users.findIndex(u => String(u.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    if (data.role) users[idx].role = data.role;
    if (data.username) users[idx].username = data.username;

    if (data.password && data.password.length > 0) {
        users[idx].password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }

    writeJSON(DB_USERS, users);
    await logAction(req.user, 'USER_UPDATE', users[idx].username);
    const { password, ...safeUser } = users[idx];
    res.json(safeUser);
});

router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
    let users = readJSON(DB_USERS);
    const target = users.find(u => String(u.id) === String(req.params.id));

    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    if (target.role === 'Administrator') {
        const adminCount = users.filter(u => u.role === 'Administrator').length;
        if (adminCount <= 1) {
            return res.status(400).json({ error: 'Son administrator hesabı silinemez' });
        }
    }

    users = users.filter(u => String(u.id) !== String(req.params.id));
    writeJSON(DB_USERS, users);
    await logAction(req.user, 'USER_DELETE', target.username);
    res.json({ success: true });
});

module.exports = router;
