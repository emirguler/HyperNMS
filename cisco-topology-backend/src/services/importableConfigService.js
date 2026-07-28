// "Importable Backup" karti icin: cihazin GERCEK running-config'inden LAN/IP/route
// bilgilerini cikarip yeni bir switch'e yapistirilabilir provizyon sablonu uretir.
//
// GUVENLIK: parolalar asla ayristirilip yazilmaz -> her zaman yer tutucu (<PAROLA>).
// Community/hostname/SSH-user cihazin kendi verisinden gelir (data/ gitignore'lu; repo'ya yazilmaz).
const { listBackups, getBackup, backupDevice } = require('./configBackupService');
const { isBlockedIP } = require('../utils/validation');

// --- Ayristirici: Cisco IOS "show running-config" -> yapisal veri ---------------
// Satir-bazli, girinti duyarli. Girintili satirlar bir onceki ust-seviye blok baglamina aittir.
function parseRunningConfig(cfg) {
    const out = {
        hostname: null, domain: null, community: null, snmpHost: null, username: null,
        vlans: [], svis: [], phys: [], routes: [], ipsla: [], ipslaSchedule: [], tracks: []
    };
    const lines = String(cfg || '').replace(/\r/g, '').split('\n');
    let ctx = null; // { t: 'vlan'|'svi'|'phys'|'ipsla', d: <obj> }
    for (const raw of lines) {
        const indented = /^\s/.test(raw);
        const s = raw.trim();
        if (!s || s === '!') { ctx = null; continue; }

        if (!indented) {
            ctx = null;
            let m;
            if ((m = s.match(/^hostname\s+(\S+)/i))) { out.hostname = m[1]; continue; }
            if ((m = s.match(/^ip domain[- ]name\s+(\S+)/i))) { out.domain = m[1]; continue; }
            if ((m = s.match(/^snmp-server community\s+(\S+)/i))) { if (!out.community) out.community = m[1]; continue; }
            if ((m = s.match(/^snmp-server host\s+(\S+)/i))) { if (!out.snmpHost) out.snmpHost = m[1]; continue; }
            if ((m = s.match(/^username\s+(\S+)/i))) { if (!out.username) out.username = m[1]; continue; }
            if ((m = s.match(/^vlan\s+(\d+)\s*$/i))) { const v = { id: m[1], name: null }; out.vlans.push(v); ctx = { t: 'vlan', d: v }; continue; }
            if ((m = s.match(/^interface\s+Vlan\s*(\d+)/i))) { const svi = { id: m[1], ip: null, mask: null, shutdown: false }; out.svis.push(svi); ctx = { t: 'svi', d: svi }; continue; }
            if ((m = s.match(/^interface\s+(\S+)/i))) { const p = { name: m[1], mode: null, access: null, voice: null, trunkAllowed: null, trunkNative: null, portfast: false, shutdown: false }; out.phys.push(p); ctx = { t: 'phys', d: p }; continue; }
            if (/^ip route\s+/i.test(s)) { out.routes.push(s); continue; }
            if (/^ip sla schedule\s+/i.test(s)) { out.ipslaSchedule.push(s); continue; }
            if ((m = s.match(/^ip sla\s+(\d+)\s*$/i))) { const b = { id: m[1], lines: [] }; out.ipsla.push(b); ctx = { t: 'ipsla', d: b }; continue; }
            if (/^track\s+\d+/i.test(s)) { out.tracks.push(s); continue; }
            continue;
        }

        if (!ctx) continue;
        let m;
        if (ctx.t === 'vlan') {
            if ((m = s.match(/^name\s+(.+)$/i))) ctx.d.name = m[1].trim();
        } else if (ctx.t === 'svi') {
            if ((m = s.match(/^ip address\s+(\S+)\s+(\S+)/i))) { ctx.d.ip = m[1]; ctx.d.mask = m[2]; }
            else if (/^shutdown$/i.test(s)) ctx.d.shutdown = true;
        } else if (ctx.t === 'phys') {
            if ((m = s.match(/^switchport mode\s+(\S+)/i))) ctx.d.mode = m[1];
            else if ((m = s.match(/^switchport access vlan\s+(\d+)/i))) ctx.d.access = m[1];
            else if ((m = s.match(/^switchport voice vlan\s+(\d+)/i))) ctx.d.voice = m[1];
            else if ((m = s.match(/^switchport trunk allowed vlan\s+(?:add\s+)?(.+)$/i))) ctx.d.trunkAllowed = ctx.d.trunkAllowed ? ctx.d.trunkAllowed + ',' + m[1].trim() : m[1].trim();
            else if ((m = s.match(/^switchport trunk native vlan\s+(\d+)/i))) ctx.d.trunkNative = m[1];
            else if (/^spanning-tree portfast/i.test(s)) ctx.d.portfast = true;
            else if (/^shutdown$/i.test(s)) ctx.d.shutdown = true;
        } else if (ctx.t === 'ipsla') {
            ctx.d.lines.push(s);
        }
    }
    return out;
}

// Sabit provizyon on-eki (running-config'te olmayan imperatif komutlar) + cihaz verisi.
function preamble(device, p) {
    const host = p.hostname || device.snmpHostname || device.name || 'SW-HOSTNAME';
    const community = p.community || device.snmpCommunity || '<COMMUNITY>';
    const sshUser = p.username || device.sshUsername || 'admin';
    const domain = p.domain || 'isuscada.local';
    const snmpHost = p.snmpHost || '11.1.3.43';
    return [
        'license right-to-use activate ipservices acceptEULA', '!',
        'conf t',
        `hostname ${host}`, '!',
        `username ${sshUser} priv 15 pass <PAROLA>`, '!',
        'enable password <ENABLE_PAROLA>', '!',
        'no ip cef optimize neighbor resolution', '!',
        `ip domain name ${domain}`, '!',
        'lldp run', '!',
        'service password-encryption',
        'no err dete cau link-flap', '!',
        'crypto key generate rsa modulus 1024', '!',
        'ip ssh ver 2', '!',
        'line vty 0 4', 'login local', 'transport input ssh', 'exit', '!',
        `snmp-server community ${community} RO`,
        `snmp-server host ${snmpHost} ${community}`,
        'ip ssh server algorithm mac hmac-sha2-256',
        'ip ssh server algorithm kex diffie-hellman-group14-sha1 diffie-hellman-group16-sha512',
        '', '!',
        'ip routing', '!'
    ];
}

// Ayristirilmis GERCEK config'ten importable sablon uret (LAN/IP/route cihaza gore).
function buildFromParsed(device, p) {
    const L = preamble(device, p);

    // VLAN tanimlari
    if (p.vlans.length) {
        for (const v of p.vlans) { L.push(`vlan ${v.id}`); if (v.name) L.push(`name ${v.name}`); }
        L.push('exit', '!');
    }
    // SVI (yalnizca IP'si olan VLAN arayuzleri)
    const svis = p.svis.filter(s => s.ip && s.mask);
    if (svis.length) {
        for (const s of svis) { L.push(`interface vlan ${s.id}`); L.push(`ip add ${s.ip} ${s.mask}`); L.push(s.shutdown ? 'shutdown' : 'no sh'); }
        L.push('exit', '!');
    }
    // Rotalar: once track'siz (default/host), sonra ip sla + track, sonra track'e bagli rotalar
    const plain = p.routes.filter(r => !/\btrack\b/i.test(r));
    const tracked = p.routes.filter(r => /\btrack\b/i.test(r));
    if (plain.length) { for (const r of plain) L.push(r); L.push('!'); }
    if (p.ipsla.length) {
        for (const b of p.ipsla) { L.push(`ip sla ${b.id}`); for (const ln of b.lines) L.push(` ${ln}`); }
        for (const sc of p.ipslaSchedule) L.push(sc);
        L.push('!');
    }
    if (p.tracks.length) { for (const tk of p.tracks) L.push(tk); L.push('!'); }
    if (tracked.length) { for (const r of tracked) L.push(r); L.push('!'); }
    // Fiziksel arayuzler (yalnizca switchport konfigi olanlar)
    const phys = p.phys.filter(x => x.mode || x.access || x.trunkAllowed || x.trunkNative || x.voice);
    for (const x of phys) {
        L.push(`interface ${x.name}`);
        if (x.mode) L.push(` switchport mode ${x.mode}`);
        if (x.trunkAllowed) L.push(` switchport trunk allowed vlan ${x.trunkAllowed}`);
        if (x.trunkNative) L.push(` switchport trunk native vlan ${x.trunkNative}`);
        if (x.access) L.push(` switchport access vlan ${x.access}`);
        if (x.voice) L.push(` switchport voice vlan ${x.voice}`);
        if (x.portfast) L.push(' spanning-tree portfast');
        if (x.shutdown) L.push(' shutdown');
    }
    L.push('end', '!');
    return L.join('\n');
}

// Yedegi/canli config'i olmayan cihazlar icin genel ornek sablon (elle duzenlenir).
function exampleTemplate(device) {
    const host = device.snmpHostname || device.name || 'SW-HOSTNAME';
    const community = device.snmpCommunity || '<COMMUNITY>';
    const sshUser = device.sshUsername || 'admin';
    return `license right-to-use activate ipservices acceptEULA
!
conf t
hostname ${host}
!
username ${sshUser} priv 15 pass <PAROLA>
!
enable password <ENABLE_PAROLA>
!
no ip cef optimize neighbor resolution
!
ip domain name isuscada.local
!
lldp run
!
service password-encryption
no err dete cau link-flap
!
crypto key generate rsa modulus 1024
!
ip ssh ver 2
!
line vty 0 4
login local
transport input ssh
exit
!
snmp-server community ${community} RO
snmp-server host 11.1.3.43 ${community}
ip ssh server algorithm mac hmac-sha2-256
ip ssh server algorithm kex diffie-hellman-group14-sha1 diffie-hellman-group16-sha512

!
ip routing
!
vlan 5
name TTVPN
vlan 7
name KAMERA
vlan 8
name OTOMASYON
vlan 9
name MODEM
vlan 73
name ANTEN
vlan 130
name MGMT
exit
!
interface vlan 5
ip add 192.168.14.9 255.255.255.0
no sh
interface vlan 7
ip add 10.37.7.254 255.255.255.0
no sh
interface vlan 8
ip add 10.37.8.126 255.255.255.128
no sh
interface vlan 9
ip add 10.37.8.200 255.255.255.128
no sh
interface vlan 130
ip add 10.36.100.8 255.255.255.0
no sh
exit
!
ip route 0.0.0.0 0.0.0.0 10.36.100.1
!
ip sla 1
 icmp-echo 11.1.1.1 source-ip 10.36.100.8
 frequency 5
ip sla schedule 1 life forever start-time now
!
track 1 ip sla 1 reachability
!
ip route 11.1.0.0 255.255.0.0 192.168.14.1 track 1
ip route 10.60.60.0 255.255.255.0 192.168.14.1 track 1
!
end
!`;
}

// Cihaz icin importable config metnini uret. Once en yeni yedek; yoksa canli cek (best-effort).
async function getImportableConfig(device) {
    let cfg = null, source = 'template', timestamp = null;

    const backups = listBackups(device.id);
    if (backups && backups.length) {
        const b = getBackup(device.id, backups[0].timestamp);
        if (b && b.config) { cfg = b.config; source = 'backup'; timestamp = b.timestamp; }
    }
    // Yedek yoksa canli cek (yeni bir yedek de olusur). SSH bilgisi yoksa/engelli IP ise atla.
    if (!cfg && device.sshUsername && device.sshPassword && !isBlockedIP(device.ip)) {
        try {
            if (await backupDevice(device)) {
                const arr = listBackups(device.id);
                if (arr.length) { const b = getBackup(device.id, arr[0].timestamp); if (b && b.config) { cfg = b.config; source = 'live'; timestamp = b.timestamp; } }
            }
        } catch (e) { /* best-effort */ }
    }

    if (cfg) {
        const parsed = parseRunningConfig(cfg);
        // En azindan SVI ya da rota bulunduysa gercekten parse edilmis kabul et; degilse ornege dus.
        if (parsed.svis.some(s => s.ip) || parsed.routes.length || parsed.vlans.length) {
            return { text: buildFromParsed(device, parsed), source, timestamp };
        }
    }
    return { text: exampleTemplate(device), source: 'template', timestamp: null };
}

module.exports = { parseRunningConfig, buildFromParsed, exampleTemplate, getImportableConfig };
