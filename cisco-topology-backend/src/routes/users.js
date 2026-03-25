const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../utils/memoryStore');
const { BCRYPT_ROUNDS } = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateUser, sanitizeUser } = require('../utils/validation');
const { logAction } = require('../services/auditLog');

const router = express.Router();

router.get('/users', authenticate, requireAdmin, (req, res) => {
    const safeUsers = store.getUsers().map(({ password, ...u }) => u);
    res.json(safeUsers);
});

router.post('/users', authenticate, requireAdmin, async (req, res) => {
    const data = sanitizeUser(req.body);
    const errors = validateUser(data, false);
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });

    if (store.getUserByUsername(data.username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPw = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const newUser = { id: Date.now(), username: data.username, password: hashedPw, role: data.role || 'User' };
    store.addUser(newUser);

    await logAction(req.user, 'USER_CREATE', newUser.username);
    const { password, ...safeUser } = newUser;
    res.json(safeUser);
});

router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
    const data = sanitizeUser(req.body);
    const errors = validateUser(data, true);
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });

    const user = store.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updates = {};
    if (data.role) updates.role = data.role;
    if (data.username) updates.username = data.username;
    if (data.password && data.password.length > 0) {
        updates.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }

    store.updateUser(req.params.id, updates);
    await logAction(req.user, 'USER_UPDATE', user.username);
    const { password, ...safeUser } = store.getUser(req.params.id);
    res.json(safeUser);
});

router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
    const target = store.getUser(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role === 'Administrator') {
        const adminCount = store.getUsers().filter(u => u.role === 'Administrator').length;
        if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last administrator account' });
    }

    store.deleteUser(req.params.id);
    await logAction(req.user, 'USER_DELETE', target.username);
    res.json({ success: true });
});

module.exports = router;
