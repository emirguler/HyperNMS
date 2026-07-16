const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');

const router = express.Router();

router.post('/edges', authenticate, requireAdmin, async (req, res) => {
    const newEdge = req.body;
    if (!newEdge.id || !newEdge.source || !newEdge.target) {
        return res.status(400).json({ error: 'Edge id, source ve target gereklidir' });
    }
    // Cihazın kendine bağlanması (loop) anlamsız — UI'da da engelli ama API'den gelmesin
    if (newEdge.source === newEdge.target) {
        return res.status(400).json({ error: 'Bir cihaz kendine bağlanamaz' });
    }

    store.addEdge({
        id: newEdge.id,
        source: newEdge.source,
        target: newEdge.target,
        sourceHandle: newEdge.sourceHandle || null,
        targetHandle: newEdge.targetHandle || null,
        animated: newEdge.animated || false,
        style: newEdge.style || {}
    });

    await logAction(req.user, 'EDGE_CREATE', newEdge.id);
    res.json({ success: true });
});

router.delete('/edges/:id', authenticate, requireAdmin, async (req, res) => {
    if (store.deleteEdge(req.params.id)) {
        await logAction(req.user, 'EDGE_DELETE', req.params.id);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Bağlantı bulunamadı' });
    }
});

module.exports = router;
