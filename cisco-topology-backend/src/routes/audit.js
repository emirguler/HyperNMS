const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getAuditLogs } = require('../services/auditLog');

const router = express.Router();

router.get('/audit', authenticate, requireAdmin, (req, res) => {
    const filters = {
        action: req.query.action,
        username: req.query.username,
        since: req.query.since,
        limit: parseInt(req.query.limit) || 200
    };
    res.json(getAuditLogs(filters));
});

module.exports = router;
