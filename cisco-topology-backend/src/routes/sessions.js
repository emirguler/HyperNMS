const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');
const sessionLog = require('../services/sessionLog');

const router = express.Router();

/* ============================================================================
   SSH OTURUM KAYITLARI - YALNIZCA ADMIN

   Transcript'ler running-config, SNMP community, IP plani gibi seylerin duz
   metin kopyasini icerir; bu yuzden her rota requireAdmin arkasindadir.
   ========================================================================== */

// Liste + filtreler. content= verilirse transcript ICINDE arama yapilir.
router.get('/sessions', authenticate, requireAdmin, (req, res) => {
    try {
        const sessions = sessionLog.listSessions({
            username: req.query.user || undefined,
            topologyPage: req.query.page || undefined,
            deviceId: req.query.deviceId || undefined,
            mode: req.query.mode || undefined,
            live: req.query.live === 'true' ? true : undefined,
            since: req.query.since || undefined,
            until: req.query.until || undefined,
            text: req.query.q || undefined,
            content: req.query.content || undefined,
            limit: Math.min(parseInt(req.query.limit, 10) || 300, 1000),
        });
        res.json({ sessions, retentionDays: sessionLog.RETENTION_DAYS });
    } catch (e) {
        console.error('[SESSIONS] liste hatasi:', e.message);
        res.status(500).json({ error: 'Could not read session log' });
    }
});

// Tek oturumun transcript'i: [{t,d}] ciktisi + [{t,c}] komut isaretleri
router.get('/sessions/:id/transcript', authenticate, requireAdmin, (req, res) => {
    const meta = sessionLog.getSession(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Session not found' });
    const { entries, missing } = sessionLog.readTranscript(req.params.id);
    res.json({ session: meta, entries, missing });
});

// Duz metin indirme (ANSI kacislari korunur, arsivlemek icin)
router.get('/sessions/:id/download', authenticate, requireAdmin, (req, res) => {
    const meta = sessionLog.getSession(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Session not found' });
    const { entries } = sessionLog.readTranscript(req.params.id);
    const head = `# NetPulse SSH session ${meta.id}\n# device : ${meta.deviceName} (${meta.deviceIp})\n` +
        `# user   : ${meta.username} [${meta.mode}]\n# started: ${meta.startedAt}\n` +
        `# ended  : ${meta.endedAt || '(live)'}\n\n`;
    const body = entries.map(e => (e.c !== undefined ? `\n[command] ${e.c}\n` : e.d)).join('');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="session-${meta.id}.log"`);
    res.send(head + body);
});

// Canli oturumu sonlandir
router.post('/sessions/:id/kill', authenticate, requireAdmin, async (req, res) => {
    const ok = sessionLog.killSession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Session is not live' });
    const meta = sessionLog.getSession(req.params.id);
    await logAction(req.user, 'SESSION_KILL', (meta && meta.deviceName) || req.params.id, {
        ip: req.ip, sessionId: req.params.id, targetUser: meta && meta.username,
    });
    res.json({ success: true });
});

module.exports = router;
