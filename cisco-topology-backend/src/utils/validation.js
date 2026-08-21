// IP adresi formatını doğrula (IPv4)
function isValidIPv4(ip) {
    if (!ip || typeof ip !== 'string') return false;
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => {
        const num = parseInt(part, 10);
        return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
    });
}

// Hostname adresi veya IP olabilir
function isValidHost(host) {
    if (!host || typeof host !== 'string') return false;
    if (isValidIPv4(host)) return true;
    // Basit hostname regex
    return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) && host.length <= 255;
}

// Switch/cihaz validasyonu
function validateSwitch(data) {
    const errors = [];

    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
        errors.push('Device name is required');
    }
    if (data.name && data.name.length > 100) {
        errors.push('Device name cannot exceed 100 characters');
    }

    if (!data.ip || !isValidHost(data.ip)) {
        errors.push('Valid IP address or hostname required');
    } else if (isBlockedIP(data.ip)) {
        errors.push('This IP address is not allowed (loopback, link-local, or reserved)');
    }

    const validTypes = ['switch', 'router', 'firewall', 'server', 'pc', 'cloud', 'antenna'];
    if (data.type && !validTypes.includes(data.type)) {
        errors.push('Invalid device type');
    }

    if (data.snmpPort) {
        const port = parseInt(data.snmpPort);
        if (isNaN(port) || port < 1 || port > 65535) {
            errors.push('SNMP port must be between 1-65535');
        }
    }

    if (data.snmpCommunity && data.snmpCommunity.length > 100) {
        errors.push('SNMP community cannot exceed 100 characters');
    }

    if (data.sshUsername && data.sshUsername.length > 64) {
        errors.push('SSH username cannot exceed 64 characters');
    }

    if (data.model && data.model.length > 200) {
        errors.push('Model cannot exceed 200 characters');
    }

    if (data.healthIntervalSec) {
        const interval = parseInt(data.healthIntervalSec);
        if (isNaN(interval) || interval < 5 || interval > 3600) {
            errors.push('Check interval must be between 5-3600 seconds');
        }
    }

    return errors;
}

// User validasyonu
function validateUser(data, isEdit = false) {
    const errors = [];

    if (!isEdit && (!data.username || typeof data.username !== 'string' || data.username.trim().length === 0)) {
        errors.push('Username is required');
    }
    if (data.username && data.username.length > 64) {
        errors.push('Username cannot exceed 64 characters');
    }
    if (data.username && !/^[a-zA-Z0-9._-]+$/.test(data.username)) {
        errors.push('Username may only contain letters, numbers, dots, underscores, and hyphens');
    }

    // AD kullanicilari icin yerel sifre yok (kimlik AD'de dogrulanir)
    const isAd = data.authType === 'ad';
    if (data.authType && !['local', 'ad'].includes(data.authType)) {
        errors.push('Invalid auth type');
    }

    // H5: Strong password policy (yalnizca yerel kullanicilar icin)
    const checkPw = isAd ? null : (!isEdit ? data.password : (data.password && data.password.length > 0 ? data.password : null));
    if (!isEdit && !isAd && !data.password) {
        errors.push('Password is required');
    }
    if (checkPw) {
        if (checkPw.length < 8) errors.push('Password must be at least 8 characters');
        if (!/[A-Z]/.test(checkPw)) errors.push('Password must contain an uppercase letter');
        if (!/[a-z]/.test(checkPw)) errors.push('Password must contain a lowercase letter');
        if (!/[0-9]/.test(checkPw)) errors.push('Password must contain a digit');
        if (!/[^A-Za-z0-9]/.test(checkPw)) errors.push('Password must contain a special character');
    }

    // Viewer = "User (View Only)" — sadece izleme. Operator = eski 'User' (Restricted-Config).
    const validRoles = ['Administrator', 'Operator', 'Viewer'];
    if (data.role && !validRoles.includes(data.role)) {
        errors.push('Invalid role');
    }

    return errors;
}

// Sanitize: sadece izin verilen alanları geçir (prototype pollution koruması)
function sanitizeSwitch(data) {
    const allowed = ['name', 'ip', 'model', 'type', 'sshUsername', 'sshPassword',
                     'snmpCommunity', 'snmpPort', 'snmpVersion', 'healthIntervalSec',
                     'position', 'tags', 'location', 'topologyPage', 'ipSlaEnabled',
                     'ipSlaOkLabel', 'ipSlaFailLabel'];
    const clean = {};
    for (const key of allowed) {
        if (data[key] !== undefined) {
            clean[key] = data[key];
        }
    }
    // ipSlaEnabled boolean'a çevrilir (yalnızca açıkça false/'false' → kapalı; varsayılan açık)
    if (clean.ipSlaEnabled !== undefined) {
        clean.ipSlaEnabled = !(clean.ipSlaEnabled === false || clean.ipSlaEnabled === 'false');
    }
    // IP SLA rozet etiketleri (OK→MD / Timeout→GSM): string'e çevir, kırp (boş bırakılırsa gösterimde varsayılana düşer)
    for (const k of ['ipSlaOkLabel', 'ipSlaFailLabel']) {
        if (clean[k] !== undefined) {
            clean[k] = String(clean[k]).trim().slice(0, 12);
        }
    }
    // Position objesini ayrıca sanitize et
    if (clean.position) {
        clean.position = {
            x: Number(clean.position.x) || 0,
            y: Number(clean.position.y) || 0
        };
    }
    // Tags array kontrolü
    if (clean.tags) {
        if (!Array.isArray(clean.tags)) clean.tags = [];
        clean.tags = clean.tags.filter(t => typeof t === 'string').slice(0, 20).map(t => t.slice(0, 50));
    }
    return clean;
}

function sanitizeUser(data) {
    const allowed = ['username', 'password', 'role', 'authType', 'fullSsh'];
    const clean = {};
    for (const key of allowed) {
        if (data[key] !== undefined) {
            clean[key] = typeof data[key] === 'string' ? data[key].trim() : data[key];
        }
    }
    // fullSsh bir YETKI bayragi: tipini serbest birakma. "false" metni ya da bir
    // nesne gelirse truthy olup Operator'e ham klavye erisimi acardi.
    if (data.fullSsh !== undefined) clean.fullSsh = data.fullSsh === true;

    // allowedCommands: Operator rolündeki kısıtlı SSH oturumları için komut whitelist'i
    if (data.allowedCommands !== undefined) {
        clean.allowedCommands = Array.isArray(data.allowedCommands)
            ? data.allowedCommands
                .filter(c => typeof c === 'string')
                .map(c => c.trim())
                .filter(c => c.length > 0)
                .slice(0, 100)
                .map(c => c.slice(0, 200))
            : [];
    }

    // allowedTopoPages: kullanıcının görebileceği topoloji sayfası id'leri.
    // null = tüm sayfalar (kısıtsız, geriye dönük varsayılan). Dizi = yalnızca bu id'ler.
    if (data.allowedTopoPages !== undefined) {
        clean.allowedTopoPages = Array.isArray(data.allowedTopoPages)
            ? data.allowedTopoPages
                .filter(p => typeof p === 'string')
                .map(p => p.trim())
                .filter(p => p.length > 0)
                .slice(0, 500)
            : null;
    }
    return clean;
}

function isBlockedIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    const trimmed = ip.trim();
    if (trimmed === '0.0.0.0' || trimmed === '::1' || trimmed.startsWith('fe80:')) return true;
    if (isValidIPv4(trimmed)) {
        const parts = trimmed.split('.').map(Number);
        if (parts[0] === 0) return true;                        // 0.0.0.0/8 "this network"
        if (parts[0] === 127) return true;                      // loopback
        if (parts[0] === 169 && parts[1] === 254) return true;  // link-local + bulut metadata
        if (parts[0] >= 224) return true;                       // multicast 224/4, ayrılmış 240/4, broadcast
    }
    return false;
}

module.exports = { isValidIPv4, isValidHost, isBlockedIP, validateSwitch, validateUser, sanitizeSwitch, sanitizeUser };
