const crypto = require('crypto');
const { ENCRYPTION_KEY } = require('../config');

function deriveKey(salt) {
    return crypto.scryptSync(ENCRYPTION_KEY, salt, 32);
}

function encryptPassword(plainText) {
    if (!plainText) return '';
    const salt = crypto.randomBytes(16);
    const key = deriveKey(salt);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // Format: salt:iv:authTag:encrypted (4-part only)
    return salt.toString('hex') + ':' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptPassword(encryptedText) {
    if (!encryptedText) return '';
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 4) {
            // Legacy 3-part format — attempt migration decryption
            if (parts.length === 3) {
                const [ivHex, authTagHex, encrypted] = parts;
                const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
                const iv = Buffer.from(ivHex, 'hex');
                const authTag = Buffer.from(authTagHex, 'hex');
                const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                decipher.setAuthTag(authTag);
                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            }
            console.warn('[CRYPTO] Unknown encryption format — returning empty');
            return '';
        }
        const [saltHex, ivHex, authTagHex, encrypted] = parts;
        const key = deriveKey(Buffer.from(saltHex, 'hex'));
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('[CRYPTO] Decryption failed:', e.message);
        return '';
    }
}

module.exports = { encryptPassword, decryptPassword };
