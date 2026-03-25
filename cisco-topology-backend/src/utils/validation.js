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

    const validTypes = ['switch', 'router', 'firewall', 'server', 'pc', 'cloud'];
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

    // H5: Strong password policy
    const checkPw = !isEdit ? data.password : (data.password && data.password.length > 0 ? data.password : null);
    if (!isEdit && !data.password) {
        errors.push('Password is required');
    }
    if (checkPw) {
        if (checkPw.length < 8) errors.push('Password must be at least 8 characters');
        if (!/[A-Z]/.test(checkPw)) errors.push('Password must contain an uppercase letter');
        if (!/[a-z]/.test(checkPw)) errors.push('Password must contain a lowercase letter');
        if (!/[0-9]/.test(checkPw)) errors.push('Password must contain a digit');
        if (!/[^A-Za-z0-9]/.test(checkPw)) errors.push('Password must contain a special character');
    }

    const validRoles = ['Administrator', 'User'];
    if (data.role && !validRoles.includes(data.role)) {
        errors.push('Invalid role');
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

function isBlockedIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    const trimmed = ip.trim();
    if (trimmed === '0.0.0.0' || trimmed === '::1' || trimmed.startsWith('fe80:')) return true;
    if (isValidIPv4(trimmed)) {
        const parts = trimmed.split('.').map(Number);
        if (parts[0] === 127) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
    }
    return false;
}

module.exports = { isValidIPv4, isValidHost, isBlockedIP, validateSwitch, validateUser, sanitizeSwitch, sanitizeUser };
