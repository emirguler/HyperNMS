const express = require('express');
const { readJSON, writeJSON } = require('../utils/db');
const { DB_EDGES } = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');

const router = express.Router();

router.post('/edges', authenticate, requireAdmin, async (req, res) => {
    const edges = readJSON(DB_EDGES);
    const newEdge = req.body;

    if (!newEdge.id || !newEdge.source || !newEdge.target) {
        return res.status(400).json({ error: 'Edge id, source ve target gereklidir' });
    }

    if (!edges.find(e => e.id === newEdge.id)) {
        // Sadece izin verilen alanları al
        edges.push({
            id: newEdge.id,
            source: newEdge.source,
            target: newEdge.target,
            sourceHandle: newEdge.sourceHandle || null,
            targetHandle: newEdge.targetHandle || null,
            animated: newEdge.animated || false,
            style: newEdge.style || {}
        });
        writeJSON(DB_EDGES, edges);
        await logAction(req.user, 'EDGE_CREATE', newEdge.id);
    }
    res.json({ success: true });
});

router.delete('/edges/:id', authenticate, requireAdmin, async (req, res) => {
    let edges = readJSON(DB_EDGES);
    const initialLength = edges.length;
    edges = edges.filter(e => e.id !== req.params.id);
    if (edges.length !== initialLength) {
        writeJSON(DB_EDGES, edges);
        await logAction(req.user, 'EDGE_DELETE', req.params.id);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Bağlantı bulunamadı' });
    }
});

module.exports = router;
