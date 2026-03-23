const crypto = require('crypto');
const { ENCRYPTION_KEY } = require('../config');

// Rastgele salt ile key türetme (her encrypt/decrypt için aynı salt kullanılmalı)
function deriveKey(salt) {
    return crypto.scryptSync(ENCRYPTION_KEY, salt, 32);
}

function encryptPassword(plainText) {
    const salt = crypto.randomBytes(16);
    const key = deriveKey(salt);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // Format: salt:iv:authTag:encrypted
    return salt.toString('hex') + ':' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptPassword(encryptedText) {
    if (!encryptedText) return '';
    try {
        const parts = encryptedText.split(':');
        if (parts.length === 4) {
            // Yeni format: salt:iv:authTag:encrypted
            const [saltHex, ivHex, authTagHex, encrypted] = parts;
            const key = deriveKey(Buffer.from(saltHex, 'hex'));
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        if (parts.length === 3) {
            // Eski format (sabit salt): iv:authTag:encrypted — geriye uyumlu
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
        return encryptedText; // Plain text (migration)
    } catch (e) {
        return encryptedText;
    }
}

module.exports = { encryptPassword, decryptPassword };
