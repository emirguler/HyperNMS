const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../utils/memoryStore');
const { BCRYPT_ROUNDS } = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateUser, sanitizeUser } = require('../utils/validation');
const { logAction } = require('../services/auditLog');
const presence = require('../services/presence');

const router = express.Router();

router.get('/users', authenticate, requireAdmin, (req, res) => {
    // totpSecret/totpPending/recoveryCodes ACIKCA cikarilir. Spread hepsini aynen
    // gecirdigi icin, biri 2FA acar acmaz sifreli secret ve kurtarma kodu hash'leri
    // istemciye gidecekti. Yalnizca totpEnabled disari verilir (listedeki rozet icin).
    const safeUsers = store.getUsers().map(({ password, totpSecret, totpPending, totpLastStep, recoveryCodes, ...u }) => ({
        ...u,
        totpEnabled: u.totpEnabled === true,
        require2fa: u.require2fa === true,   // Users sayfasindaki rozet + admin toggle'i icin
        active: presence.isActive(u.id),   // son 5 dk içinde istek yapmış (uygulaması açık)
        lastSeen: presence.lastSeenAt(u.id),
    }));
    res.json(safeUsers);
});

router.post('/users', authenticate, requireAdmin, async (req, res) => {
    const data = sanitizeUser(req.body);
    const errors = validateUser(data, false);
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });

    if (store.getUserByUsername(data.username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    const isAd = data.authType === 'ad';
    const newUser = {
        id: Date.now(),
        username: data.username,
        authType: isAd ? 'ad' : 'local',
        password: isAd ? '' : await bcrypt.hash(data.password, BCRYPT_ROUNDS), // AD: yerel sifre yok, AD'de dogrulanir
        role: data.role || 'Viewer',   // varsayilan en dusuk yetki (User / View Only)
        allowedCommands: data.allowedCommands || [],
        // Görebileceği topoloji sayfaları: null = tümü (kısıtsız). Admin her zaman tümünü görür.
        allowedTopoPages: (data.role === 'Administrator') ? null
            : (data.allowedTopoPages !== undefined ? data.allowedTopoPages : null),
        // Operator'e ham (tam) SSH klavye erisimi. Varsayilan KAPALI.
        fullSsh: data.fullSsh === true
    };
    store.addUser(newUser);

    await logAction(req.user, 'USER_CREATE', newUser.username);
    const { password, totpSecret, totpPending, totpLastStep, recoveryCodes, ...safeUser } = newUser;
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
    if (data.allowedCommands !== undefined) updates.allowedCommands = data.allowedCommands;
    if (data.allowedTopoPages !== undefined) updates.allowedTopoPages = data.allowedTopoPages;
    // Administrator her zaman tüm sayfaları görür → kısıtı temizle (asılı kalmasın).
    if (data.role === 'Administrator') updates.allowedTopoPages = null;
    if (data.fullSsh !== undefined) updates.fullSsh = data.fullSsh === true;
    // Rol Operator DISINA cikarsa bayrak anlamsizlasir ve unutulup asili kalmasin:
    // Viewer'a geri donen bir hesap sonradan tekrar Operator yapilinca sessizce
    // tam SSH ile geri gelirdi.
    if (data.role && data.role !== 'Operator') updates.fullSsh = false;

    // authType degisimi: AD'ye gecince yerel sifre kaldirilir; local ise sifre (verildiyse) guncellenir
    const targetAuthType = (data.authType && ['local', 'ad'].includes(data.authType)) ? data.authType : (user.authType || 'local');
    if (data.authType && ['local', 'ad'].includes(data.authType)) updates.authType = data.authType;
    if (targetAuthType === 'ad') {
        updates.password = '';
    } else if (data.password && data.password.length > 0) {
        updates.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }

    store.updateUser(req.params.id, updates);
    await logAction(req.user, 'USER_UPDATE', user.username);
    const { password, totpSecret, totpPending, totpLastStep, recoveryCodes, ...safeUser } = store.getUser(req.params.id);
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
