const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isValidIPv4, validateSwitch, validateUser, sanitizeSwitch, sanitizeUser } = require('./validation');

describe('isValidIPv4', () => {
    it('should accept valid IPs', () => {
        assert.strictEqual(isValidIPv4('192.168.1.1'), true);
        assert.strictEqual(isValidIPv4('10.0.0.1'), true);
        assert.strictEqual(isValidIPv4('255.255.255.255'), true);
        assert.strictEqual(isValidIPv4('0.0.0.0'), true);
    });

    it('should reject invalid IPs', () => {
        assert.strictEqual(isValidIPv4('256.1.1.1'), false);
        assert.strictEqual(isValidIPv4('1.1.1'), false);
        assert.strictEqual(isValidIPv4(''), false);
        assert.strictEqual(isValidIPv4(null), false);
        assert.strictEqual(isValidIPv4('abc.def.ghi.jkl'), false);
        assert.strictEqual(isValidIPv4('1.1.1.1.1'), false);
        assert.strictEqual(isValidIPv4('01.01.01.01'), false);
    });
});

describe('validateSwitch', () => {
    it('should pass valid switch data', () => {
        const errors = validateSwitch({ name: 'Switch-1', ip: '192.168.1.1', type: 'switch' });
        assert.strictEqual(errors.length, 0);
    });

    it('should reject missing name', () => {
        const errors = validateSwitch({ name: '', ip: '192.168.1.1' });
        assert.ok(errors.length > 0);
    });

    it('should reject invalid host', () => {
        const errors = validateSwitch({ name: 'Test', ip: 'invalid host with spaces!' });
        assert.ok(errors.some(e => e.includes('IP') || e.includes('hostname')));
    });

    it('should reject invalid type', () => {
        const errors = validateSwitch({ name: 'Test', ip: '10.0.0.1', type: 'hacker' });
        assert.ok(errors.length > 0);
    });

    it('should reject invalid snmp port', () => {
        const errors = validateSwitch({ name: 'Test', ip: '10.0.0.1', snmpPort: 99999 });
        assert.ok(errors.length > 0);
    });
});

describe('validateUser', () => {
    it('should pass valid user data', () => {
        const errors = validateUser({ username: 'admin', password: 'secure123', role: 'Administrator' });
        assert.strictEqual(errors.length, 0);
    });

    it('should reject short password', () => {
        const errors = validateUser({ username: 'admin', password: '123' });
        assert.ok(errors.length > 0);
    });

    it('should reject invalid username characters', () => {
        const errors = validateUser({ username: 'admin<script>', password: 'secure123' });
        assert.ok(errors.length > 0);
    });

    it('should reject invalid role', () => {
        const errors = validateUser({ username: 'admin', password: 'secure123', role: 'SuperAdmin' });
        assert.ok(errors.length > 0);
    });
});

describe('sanitizeSwitch', () => {
    it('should only keep allowed fields', () => {
        const result = sanitizeSwitch({ name: 'Test', ip: '10.0.0.1', evil: 'payload', admin: true });
        assert.strictEqual(result.name, 'Test');
        assert.strictEqual(result.ip, '10.0.0.1');
        assert.strictEqual(result.evil, undefined);
        assert.strictEqual(result.admin, undefined);
    });

    it('should sanitize tags', () => {
        const result = sanitizeSwitch({ name: 'Test', ip: '10.0.0.1', tags: ['core', 123, 'datacenter'] });
        assert.strictEqual(result.tags.length, 2); // 123 filtered out
        assert.deepStrictEqual(result.tags, ['core', 'datacenter']);
    });
});

describe('sanitizeUser', () => {
    it('should only keep allowed fields', () => {
        const result = sanitizeUser({ username: 'admin', password: 'test123', role: 'User', evil: 'payload' });
        assert.strictEqual(result.username, 'admin');
        assert.strictEqual(result.evil, undefined);
    });
});
