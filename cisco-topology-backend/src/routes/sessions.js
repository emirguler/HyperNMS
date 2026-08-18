const express = require('express');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logAction } = require('../services/auditLog');
const sessionLog = require('../services/sessionLog');
const { renderEntries } = require('../utils/terminalRender');

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
    // 'rendered': kontrol karakterleri UYGULANMIS hali - yani ekranda ne
    // gorunduyse o. Yazarken duzeltilen komutlar artik silinmis harfleriyle
    // birlikte gorunmuyor. 'entries' ham kalir (t offsetleriyle oynatma icin).
    res.json({ session: meta, entries, rendered: renderEntries(entries), missing });
});

// Duz metin indirme (ANSI kacislari korunur, arsivlemek icin)
router.get('/sessions/:id/download', authenticate, requireAdmin, (req, res) => {
    const meta = sessionLog.getSession(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Session not found' });
    const { entries } = sessionLog.readTranscript(req.params.id);
    const head = `# NetPulse SSH session ${meta.id}\n# device : ${meta.deviceName} (${meta.deviceIp})\n` +
        `# user   : ${meta.username} [${meta.mode}]\n# started: ${meta.startedAt}\n` +
        `# ended  : ${meta.endedAt || '(live)'}\n\n`;
    // Indirilen dosya da islenmis hali tasir: ham akis bir metin editorunde
    // backspace'ler yuzunden okunmaz oluyordu.
    const body = renderEntries(entries);
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

// --- Kayit silme: YALNIZCA yerlesik "admin" ---
// Transcript'ler running-config, SNMP community gibi hassas veri icerir; silme
// yikici ve geri alinamaz oldugu icin en ayricalikli hesaba kilitlenmistir.

// Tumunu sil (canli olanlar korunur). :id rotasindan ONCE tanimli olmali ki
// "all" bir id sanilmasin — yine de ayri path oldugu icin cakismaz.
router.delete('/sessions', authenticate, requireSuperAdmin, async (req, res) => {
    const { removed } = await sessionLog.deleteAllSessions();
    await logAction(req.user, 'SESSION_DELETE_ALL', String(removed), { ip: req.ip, count: removed });
    res.json({ success: true, removed });
});

// Tek kaydi sil
router.delete('/sessions/:id', authenticate, requireSuperAdmin, async (req, res) => {
    const meta = sessionLog.getSession(req.params.id);
    const r = await sessionLog.deleteSession(req.params.id);
    if (r.live) return res.status(400).json({ error: 'Terminate the live session before deleting it' });
    await logAction(req.user, 'SESSION_DELETE', (meta && meta.deviceName) || req.params.id, {
        ip: req.ip, sessionId: req.params.id, targetUser: meta && meta.username,
    });
    res.json({ success: true });
});

module.exports = router;
