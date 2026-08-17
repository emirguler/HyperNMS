const WebSocket = require('ws');
const ssh2 = require('ssh2').Client;
const net = require('net');
const store = require('../utils/memoryStore');
const { decryptPassword } = require('../utils/crypto');
const { authenticateWs, normalizeRole, canOperate } = require('../middleware/auth');
const { isBlockedIP } = require('../utils/validation');
const sessionLog = require('./sessionLog');
const { logAction } = require('./auditLog');

// --- Cihaz keşfi için SSH probe (Find Device) ---
// Not: ssh2 gerçekleri (ampirik doğrulandı):
//  * conn.destroy() DEVAM EDEN bir bağlantıyı iptal etmez → asıl bütçe readyTimeout'tur.
//  * ssh2, teardown'dan SONRA da 'error' yayar; dinleyicisiz 'error' process'i ÇÖKERTİR
//    → dinleyici hep bağlı kalır, settle-once bayrağıyla korunur.
//  * connect()/shell() SENKRON throw edebilir → try/catch şart.
//  * Dizi veren algorithms ssh2 varsayılanlarını EZER → append ile legacy eklenir.
const PROBE_ALGORITHMS = {
    kex: { append: ['diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'] },
    cipher: { append: ['aes128-cbc', '3des-cbc'] },
    serverHostKey: { append: ['ssh-rsa', 'ssh-dss'] },
};

// ssh2 keyboard-interactive yaniti. Cisco Nexus/NX-OS gibi cihazlar cogu zaman "password"
// metodunu degil "keyboard-interactive"i sunar; bu handler + connect'te tryKeyboard:true olmadan
// ssh2 "All configured authentication methods failed" hatasi verir. Tum prompt'lara sifreyle yanit veririz.
function kbAuth(password) {
    return (name, instructions, lang, prompts, cb) => cb(prompts.map(() => password));
}

function classifyErr(err) {
    if (err && err.level === 'client-authentication') return 'auth_failed';
    const code = err && err.code;
    if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENOTFOUND') return 'unreachable';
    if (code === 'ETIMEDOUT' || /timed?\s*out|timeout/i.test(String((err && err.message) || ''))) return 'timeout';
    return 'error';
}

// Tek cihaza bağlanıp "show version" çıktısını al. ASLA reject etmez (havuz için güvenli).
function probeDevice(ip, username, password) {
    return new Promise((resolve) => {
        const conn = new ssh2();
        let settled = false;
        let output = '';
        let idleTimer = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(hardTimer);
            if (idleTimer) clearTimeout(idleTimer);
            try { conn.destroy(); } catch (e) { /* ignore */ }
            resolve(result);
        };

        const hardTimer = setTimeout(() => finish({ status: 'timeout' }), 12000);

        conn.on('error', (err) => finish({ status: classifyErr(err) }));
        conn.on('timeout', () => { try { conn.destroy(); } catch (e) { /* ignore */ } });
        conn.on('close', () => finish({ status: output ? 'ok' : 'unreachable' }));
        conn.on('keyboard-interactive', kbAuth(password)); // Nexus/NX-OS

        conn.on('ready', () => {
            try {
                // Cisco IOS exec kanalını desteklemez; ayrıca paging'i kapatmak için
                // önce "terminal length 0" gönderilmeli → shell şart.
                conn.shell((err, stream) => {
                    if (err) return finish({ status: 'error' });
                    stream.on('data', (d) => {
                        output += d.toString();
                        if (output.length > 256 * 1024) return finish({ status: 'ok', output }); // taşma koruması
                        if (idleTimer) clearTimeout(idleTimer);
                        idleTimer = setTimeout(() => finish({ status: 'ok', output }), 1500); // çıktı durdu
                    });
                    stream.on('close', () => finish({ status: 'ok', output }));
                    try {
                        stream.write('terminal length 0\n');
                        setTimeout(() => { try { stream.write('show version\n'); } catch (e) { /* ignore */ } }, 500);
                    } catch (e) { finish({ status: 'error' }); }
                });
            } catch (e) { finish({ status: 'error' }); } // shell() senkron throw edebilir
        });

        try {
            conn.connect({
                host: ip, port: 22, username, password,
                readyTimeout: 6000,   // gerçek bağlantı bütçesi
                tryKeyboard: true,    // Nexus/NX-OS keyboard-interactive icin
                algorithms: PROBE_ALGORITHMS,
            });
        } catch (e) { finish({ status: 'error' }); } // connect() senkron throw edebilir
    });
}

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

    server.on('upgrade', (req, socket, head) => {
        if (req.url.startsWith('/ws/terminal')) {
            socket.setNoDelay(true); // Nagle'ı kapat → tuş/echo paketleri beklemeden gider (interaktif gecikmeyi önler)
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        }
    });

    wss.on('connection', (ws, req) => {
        const user = authenticateWs(req);
        if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: 'Authentication required. Please re-login.' }));
            ws.close();
            return;
        }

        // Administrator = tam kontrol (raw giriş). Operator = kısıtlı: sadece kendisine
        // atanmış whitelist komutlarını butonla çalıştırabilir; klavye girişi sunucuda yok sayılır.
        // Viewer (User / View Only) = SSH tamamen kapalı.
        const account = store.getUser(user.id) || {};
        // Yetki KAYITLI rolden okunur, token'dan DEGIL. Token rolu giris aninda
        // dondurulur ve JWT_EXPIRY (8sa) boyunca oyle kalir; admin bir kullaniciyi
        // Viewer'dan Operator'e cekince kullanici cikip yeniden girene kadar SSH
        // reddediliyordu. Ters yon daha da onemli: bir yetki DUSURME de ayni sure
        // boyunca etkisiz kaliyordu. Hesap silinmisse token roluna duseriz; zaten
        // allowedCommands da bos gelecegi icin bir sonraki kontrol reddeder.
        const effectiveRole = account.role || user.role;
        const isAdmin = normalizeRole(effectiveRole) === 'Administrator';
        if (!canOperate(effectiveRole)) {
            // Gercek rol adi yazilir. Sabit "View Only" metni, rol beklenmedik bir
            // deger oldugunda yalan soyleyip teshisi yanlis yone cekiyordu.
            console.warn(`[SSH] Reddedildi: ${user.username} — kayitli rol="${account.role || '(hesap yok)'}", token rolu="${user.role || '(yok)'}"`);
            ws.send(JSON.stringify({
                type: 'error',
                message: `Your role ("${effectiveRole || 'unknown'}") is not permitted to open SSH sessions.`
            }));
            ws.close();
            return;
        }
        const allowedCommands = isAdmin ? null : (Array.isArray(account.allowedCommands) ? account.allowedCommands : []);

        // Komut atanmamış Operator rolüne SSH tamamen kapalı
        if (!isAdmin && allowedCommands.length === 0) {
            ws.send(JSON.stringify({ type: 'error', message: 'No SSH commands assigned to your account. Access denied.' }));
            ws.close();
            return;
        }

        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const switchId = urlParams.get('switchId');
        const device = store.getSwitch(switchId);

        if (!device || !device.sshUsername) {
            ws.send(JSON.stringify({ type: 'error', message: 'SSH Credentials not found.' }));
            return;
        }

        if (isBlockedIP(device.ip)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Connection to this IP is not allowed' }));
            ws.close();
            return;
        }

        const safeSend = (data) => {
            try { if (ws.readyState === WebSocket.OPEN) ws.send(data); } catch (e) { /* ignore */ }
        };

        const sshPass = decryptPassword(device.sshPassword);
        // Oturum kaydedicisi conn.on('ready') icinde olusur; kapanis yollari
        // (stream close / ws close / ssh error) buradan erisir.
        let recorder = null;
        const conn = new ssh2();
        // Cihaza giden TCP soketinde Nagle'ı kapat (PuTTY de TCP_NODELAY yapar). ssh2 bunu kendi
        // soketinde yapmadığından soketi biz açıp 'sock' olarak veriyoruz → interaktif yazım gecikmesi biter.
        const deviceSock = net.connect({ host: device.ip, port: 22 });
        deviceSock.setNoDelay(true);
        deviceSock.on('error', () => { /* asıl hata conn 'error' ile ele alınır; burada yalnızca çökmeyi önle */ });
        conn.on('ready', () => {
            console.log(`[SSH] Connected to ${device.name} (${device.ip}) as ${user.username} [${isAdmin ? 'full' : 'restricted'}]`);
            safeSend(JSON.stringify({ type: 'info', message: 'SSH Connection Established.\r\n' }));
            // İstemciye modunu bildir: admin = tam kontrol, user = sadece komut butonları
            safeSend(JSON.stringify({ type: 'mode', readOnly: !isAdmin, commands: allowedCommands || [] }));

            // --- Oturum kaydi baslar ---
            // Cihaz adi/IP/topoloji adi ANLIK KOPYA: cihaz sonradan yeniden adlandirilir,
            // tasinir veya silinirse eski kayitlar anlamsizlasmasin.
            const tab = store.getTopoTabs ? (store.getTopoTabs() || []).find(t => t.id === device.topologyPage) : null;
            recorder = sessionLog.startSession({
                deviceId: device.id, deviceName: device.name, deviceIp: device.ip, deviceType: device.type,
                topologyPage: device.topologyPage || 'main',
                topologyName: (tab && tab.name) || device.topologyPage || 'Main Topology',
                userId: user.id, username: user.username, role: normalizeRole(effectiveRole),
                mode: isAdmin ? 'full' : 'restricted',
                clientIp: req.socket?.remoteAddress || null,
            }, () => {
                // Admin bu oturumu sonlandirdi
                safeSend(JSON.stringify({ type: 'error', message: '*** Session terminated by an administrator ***' }));
                try { conn.end(); } catch (e) { /* ignore */ }
                try { ws.close(); } catch (e) { /* ignore */ }
            });
            logAction(user, 'SESSION_START', device.name, { ip: req.socket?.remoteAddress, sessionId: recorder.id, deviceIp: device.ip })
                .catch(() => { /* denetim kaydi oturumu engellemesin */ });

            conn.shell((err, stream) => {
                if (err) { safeSend(JSON.stringify({ type: 'error', message: err.message })); return; }
                stream.on('data', (data) => {
                    const text = data.toString();
                    // YALNIZCA bu yon kaydedilir (cihaz -> istemci). Kullanicinin tuslari
                    // asla kaydedilmez: "enable" sifresi echo EDILMEDIGI icin cihaz
                    // ciktisinda gorunmez, ama tus vuruslarinda duz metin olarak gecerdi.
                    if (recorder) recorder.write(text);
                    safeSend(JSON.stringify({ type: 'data', data: text }));
                });
                stream.on('close', () => { conn.end(); try { ws.close(); } catch (e) {} });

                // Kısıtlı (User) oturum: sayfalamayı kapat — buton çıktıları --More-- ile durmasın
                if (!isAdmin) stream.write('terminal length 0\n');
                ws.on('message', (msg) => {
                    try {
                        const parsed = JSON.parse(msg);
                        if (isAdmin) {
                            // Tam kontrol: raw klavye girişi
                            if (parsed.type === 'data') stream.write(parsed.data);
                        } else {
                            // Kısıtlı kullanıcı: klavye girişi (data) yok sayılır.
                            // Sadece whitelist'te BİREBİR eşleşen komut çalıştırılır.
                            if (parsed.type === 'command' && typeof parsed.cmd === 'string') {
                                if (allowedCommands.includes(parsed.cmd)) {
                                    // Whitelist komutu: sabit liste, sir icermez -> kaydedilir
                                    if (recorder) recorder.command(parsed.cmd);
                                    stream.write(parsed.cmd + '\n');
                                } else {
                                    safeSend(JSON.stringify({ type: 'error', message: `Command not allowed: ${parsed.cmd}` }));
                                }
                            }
                        }
                    } catch (e) { /* ignore */ }
                });
            });
        }).on('error', (err) => {
            console.log(`[SSH] Error ${device.name}: ${err.message}`);
            if (recorder) recorder.end('ssh-error: ' + err.message);
            safeSend(JSON.stringify({ type: 'error', message: 'SSH Failed: ' + err.message }));
        }).on('keyboard-interactive', kbAuth(sshPass)).connect({
            sock: deviceSock,    // NoDelay'li kendi soketimiz (host/port bunun içinde)
            username: device.sshUsername,
            password: sshPass,
            tryKeyboard: true,   // Nexus/NX-OS keyboard-interactive icin
            algorithms: {
                kex: [
                    "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
                    "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha1"
                ],
                cipher: [
                    "aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-cbc"
                ],
                serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384"]
            }
        });

        ws.on('close', () => {
            try { conn.end(); } catch (e) { /* ignore */ }
            if (recorder && !recorder.ended) {
                recorder.end('closed');
                logAction(user, 'SESSION_END', device.name, {
                    ip: req.socket?.remoteAddress, sessionId: recorder.id,
                    durationMs: recorder.record.durationMs, bytes: recorder.record.bytes,
                }).catch(() => { /* ignore */ });
            }
        });
    });

    return wss;
}

// --- IP SLA via SSH ---
// IE4010 gibi CISCO-RTTMON-MIB'i SNMP'de yayınlamayan cihazlar için:
// "show ip sla summary" çıktısını SSH ile alıp Return Code'u parse eder.
const IPSLA_SSH_ALGORITHMS = {
    kex: ["ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha1"],
    cipher: ["aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-cbc"],
    serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384"]
};

function runShowCommand(device, command) {
    return new Promise((resolve, reject) => {
        const conn = new ssh2();
        const pw = decryptPassword(device.sshPassword);
        let result = '';
        let dataTimeout = null;
        const hardTimeout = setTimeout(() => { try { conn.end(); } catch (e) {} resolve(result); }, 15000);
        conn.on('ready', () => {
            conn.shell((err, stream) => {
                if (err) { clearTimeout(hardTimeout); try { conn.end(); } catch (e) {} return reject(err); }
                stream.on('data', (data) => {
                    result += data.toString();
                    if (dataTimeout) clearTimeout(dataTimeout);
                    dataTimeout = setTimeout(() => { clearTimeout(hardTimeout); try { stream.end(); conn.end(); } catch (e) {} resolve(result); }, 1500);
                });
                stream.on('close', () => { clearTimeout(hardTimeout); if (dataTimeout) clearTimeout(dataTimeout); try { conn.end(); } catch (e) {} resolve(result); });
                stream.write('terminal length 0\n');
                setTimeout(() => stream.write(command + '\n'), 500);
            });
        }).on('error', (err) => { clearTimeout(hardTimeout); reject(err); }).on('keyboard-interactive', kbAuth(pw)).connect({
            host: device.ip, port: 22,
            username: device.sshUsername,
            password: pw,
            readyTimeout: 8000,
            tryKeyboard: true,   // Nexus/NX-OS keyboard-interactive icin
            algorithms: IPSLA_SSH_ALGORITHMS
        });
    });
}

// "show ip sla summary" satırlarını parse et → [{ id, type, target, rtt, sense, status }]
const SSH_CODE_MAP = [
    [/\bOK\b/i, 'ok', 1], [/timeout/i, 'timeout', 4], [/disconnected/i, 'disconnected', 2],
    [/over ?threshold/i, 'overThreshold', 3], [/busy/i, 'busy', 5], [/no ?connection/i, 'notConnected', 6],
    [/dropped/i, 'dropped', 7],
];
function parseIpSlaSummary(text) {
    const out = [];
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    for (const line of lines) {
        // Veri satırı: opsiyonel *,^,~ işareti + operasyon numarası ile başlar
        const m = line.match(/^\s*[*^~]?\s*(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
        if (!m) continue;
        const rest = m[4]; // RTT + Return Code + Last Run
        let status = null, sense = 0;
        for (const [re, st, sn] of SSH_CODE_MAP) { if (re.test(rest)) { status = st; sense = sn; break; } }
        // Bilinen kod yoksa: sadece "last run" (ago/never) işareti varsa yine de kayıt say (non-ok)
        if (!status) {
            if (!/\bago\b|\bnever\b/i.test(rest)) continue; // muhtemelen başlık/gürültü satırı
            status = 'other';
        }
        const rttM = rest.match(/RTT\s*=\s*(\d+)/i);
        out.push({ id: m[1], type: m[2], target: m[3], rtt: rttM ? Number(rttM[1]) : null, sense, status });
    }
    return out;
}

async function ipSlaViaSsh(device) {
    if (!device || !device.sshUsername || !device.sshPassword || isBlockedIP(device.ip)) return [];
    try {
        const raw = await runShowCommand(device, 'show ip sla summary');
        return parseIpSlaSummary(raw);
    } catch (e) {
        return [];
    }
}

// Toplu komut calistirma (Command-line sayfasi).
//   config=false -> komutlar dogrudan exec modunda calisir (show/display).
//   config=true  -> "configure terminal ... end" ile sarmalanip konfig satirlari gonderilir.
// Ham shell ciktisini dondurur. GUVENLIK dogrulamasi (mod/denylist) ROUTE katmaninda yapilir.
function runCommands(device, lines, { config = false, save = false, timeoutMs = 25000 } = {}) {
    return new Promise((resolve, reject) => {
        const conn = new ssh2();
        const pw = decryptPassword(device.sshPassword);
        let result = '';
        let dataTimeout = null;
        let closed = false;
        const finish = () => { closed = true; clearTimeout(hardTimeout); if (dataTimeout) clearTimeout(dataTimeout); try { conn.end(); } catch (e) {} resolve(result); };
        const hardTimeout = setTimeout(finish, timeoutMs);
        conn.on('ready', () => {
            conn.shell((err, stream) => {
                if (err) { closed = true; clearTimeout(hardTimeout); try { conn.end(); } catch (e) {} return reject(err); }
                stream.on('data', (data) => {
                    result += data.toString();
                    // Her veri geldiginde idle timer'i sifirla — 2sn veri gelmezse bitir
                    if (dataTimeout) clearTimeout(dataTimeout);
                    dataTimeout = setTimeout(() => { try { stream.end(); } catch (e) {} finish(); }, 2000);
                });
                stream.on('close', () => finish());
                const script = ['terminal length 0'];
                if (config) script.push('configure terminal');
                for (const l of lines) script.push(l);
                if (config && save) script.push('do write memory'); // config modunda kalarak startup-config'e kaydet
                if (config) script.push('end');
                // Satirlari araliklarla yaz — IOS input buffer'ini tasirmadan echo'yu bekle
                let i = 0;
                const writeNext = () => {
                    if (closed || i >= script.length) return;
                    try { stream.write(script[i++] + '\n'); } catch (e) {}
                    setTimeout(writeNext, 200);
                };
                setTimeout(writeNext, 400);
            });
        }).on('error', (err) => { if (!closed) { closed = true; clearTimeout(hardTimeout); reject(err); } }).on('keyboard-interactive', kbAuth(pw)).connect({
            host: device.ip, port: 22,
            username: device.sshUsername,
            password: pw,
            readyTimeout: 8000,
            tryKeyboard: true,   // Nexus/NX-OS keyboard-interactive icin
            algorithms: IPSLA_SSH_ALGORITHMS
        });
    });
}

module.exports = { setupWebSocket, probeDevice, ipSlaViaSsh, runShowCommand, runCommands, kbAuth };
