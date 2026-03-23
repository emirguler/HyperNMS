const { readJSON, safeWriteJSON } = require('../utils/db');
const { DB_AUDIT } = require('../config');
const fs = require('fs');

const MAX_AUDIT_ENTRIES = 10000;

// Audit dosyasının varlığını kontrol et
function ensureAuditFile() {
    if (!fs.existsSync(DB_AUDIT)) {
        fs.writeFileSync(DB_AUDIT, JSON.stringify([]));
    }
}

async function logAction(user, action, target, details = {}) {
    ensureAuditFile();
    const logs = readJSON(DB_AUDIT);
    logs.push({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        userId: user?.id || null,
        username: user?.username || 'system',
        action,
        target,
        details,
        ip: details.ip || null
    });

    // Eski kayıtları temizle
    const trimmed = logs.length > MAX_AUDIT_ENTRIES ? logs.slice(-MAX_AUDIT_ENTRIES) : logs;
    await safeWriteJSON(DB_AUDIT, trimmed);
}

function getAuditLogs(filters = {}) {
    ensureAuditFile();
    let logs = readJSON(DB_AUDIT);

    if (filters.action) {
        logs = logs.filter(l => l.action === filters.action);
    }
    if (filters.username) {
        logs = logs.filter(l => l.username === filters.username);
    }
    if (filters.since) {
        const sinceDate = new Date(filters.since).getTime();
        logs = logs.filter(l => new Date(l.timestamp).getTime() >= sinceDate);
    }

    // Son kayıtlar en üstte
    return logs.reverse().slice(0, filters.limit || 200);
}

module.exports = { logAction, getAuditLogs };
