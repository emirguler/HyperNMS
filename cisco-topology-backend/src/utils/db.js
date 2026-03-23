const fs = require('fs');

const FILE_LOCKS = {};

function acquireLock(file) {
    return new Promise((resolve) => {
        if (!FILE_LOCKS[file]) {
            FILE_LOCKS[file] = { locked: false, queue: [] };
        }
        const lock = FILE_LOCKS[file];
        if (!lock.locked) {
            lock.locked = true;
            resolve();
        } else {
            lock.queue.push(resolve);
        }
    });
}

function releaseLock(file) {
    const lock = FILE_LOCKS[file];
    if (lock && lock.queue.length > 0) {
        const next = lock.queue.shift();
        next();
    } else if (lock) {
        lock.locked = false;
    }
}

function readJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`[DB] ${file} okunamadı:`, e.message);
        return [];
    }
}

async function safeWriteJSON(file, data) {
    await acquireLock(file);
    try {
        const tmpFile = file + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
        fs.renameSync(tmpFile, file);
    } finally {
        releaseLock(file);
    }
}

function writeJSON(file, data) {
    const tmpFile = file + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, file);
}

module.exports = { readJSON, writeJSON, safeWriteJSON };
