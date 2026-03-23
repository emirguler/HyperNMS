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
        errors.push('Cihaz adı gereklidir');
    }
    if (data.name && data.name.length > 100) {
        errors.push('Cihaz adı 100 karakterden uzun olamaz');
    }

    if (!data.ip || !isValidHost(data.ip)) {
        errors.push('Geçerli bir IP adresi veya hostname gereklidir');
    }

    const validTypes = ['switch', 'router', 'firewall', 'server', 'pc', 'cloud'];
    if (data.type && !validTypes.includes(data.type)) {
        errors.push('Geçersiz cihaz tipi');
    }

    if (data.snmpPort) {
        const port = parseInt(data.snmpPort);
        if (isNaN(port) || port < 1 || port > 65535) {
            errors.push('SNMP portu 1-65535 arasında olmalıdır');
        }
    }

    if (data.snmpCommunity && data.snmpCommunity.length > 100) {
        errors.push('SNMP community 100 karakterden uzun olamaz');
    }

    if (data.sshUsername && data.sshUsername.length > 64) {
        errors.push('SSH kullanıcı adı 64 karakterden uzun olamaz');
    }

    if (data.model && data.model.length > 200) {
        errors.push('Model 200 karakterden uzun olamaz');
    }

    if (data.healthIntervalSec) {
        const interval = parseInt(data.healthIntervalSec);
        if (isNaN(interval) || interval < 5 || interval > 3600) {
            errors.push('Kontrol sıklığı 5-3600 saniye arasında olmalıdır');
        }
    }

    return errors;
}

// User validasyonu
function validateUser(data, isEdit = false) {
    const errors = [];

    if (!isEdit && (!data.username || typeof data.username !== 'string' || data.username.trim().length === 0)) {
        errors.push('Kullanıcı adı gereklidir');
    }
    if (data.username && data.username.length > 64) {
        errors.push('Kullanıcı adı 64 karakterden uzun olamaz');
    }
    if (data.username && !/^[a-zA-Z0-9._-]+$/.test(data.username)) {
        errors.push('Kullanıcı adı sadece harf, rakam, nokta, alt çizgi ve tire içerebilir');
    }

    if (!isEdit && (!data.password || data.password.length < 6)) {
        errors.push('Parola en az 6 karakter olmalıdır');
    }
    if (isEdit && data.password && data.password.length > 0 && data.password.length < 6) {
        errors.push('Parola en az 6 karakter olmalıdır');
    }

    const validRoles = ['Administrator', 'User'];
    if (data.role && !validRoles.includes(data.role)) {
        errors.push('Geçersiz rol');
    }

    return errors;
}

// Sanitize: sadece izin verilen alanları geçir (prototype pollution koruması)
function sanitizeSwitch(data) {
    const allowed = ['name', 'ip', 'model', 'type', 'sshUsername', 'sshPassword',
                     'snmpCommunity', 'snmpPort', 'snmpVersion', 'healthIntervalSec',
                     'position', 'tags', 'location', 'topologyPage'];
    const clean = {};
    for (const key of allowed) {
        if (data[key] !== undefined) {
            clean[key] = data[key];
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
    const allowed = ['username', 'password', 'role'];
    const clean = {};
    for (const key of allowed) {
        if (data[key] !== undefined) {
            clean[key] = typeof data[key] === 'string' ? data[key].trim() : data[key];
        }
    }
    return clean;
}

module.exports = { isValidIPv4, isValidHost, validateSwitch, validateUser, sanitizeSwitch, sanitizeUser };
