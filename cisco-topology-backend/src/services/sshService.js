const WebSocket = require('ws');
const ssh2 = require('ssh2').Client;
const store = require('../utils/memoryStore');
const { decryptPassword } = require('../utils/crypto');
const { authenticateWs } = require('../middleware/auth');
const { isBlockedIP } = require('../utils/validation');

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

    server.on('upgrade', (req, socket, head) => {
        if (req.url.startsWith('/ws/terminal')) {
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

        // Administrator = tam kontrol (raw giriş). User = salt-izle: sadece kendisine
        // atanmış whitelist komutlarını butonla çalıştırabilir; klavye girişi sunucuda yok sayılır.
        const isAdmin = user.role === 'Administrator';
        const account = store.getUser(user.id) || {};
        const allowedCommands = isAdmin ? null : (Array.isArray(account.allowedCommands) ? account.allowedCommands : []);

        // Komut atanmamış User rolüne SSH tamamen kapalı
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

        const conn = new ssh2();
        conn.on('ready', () => {
            console.log(`[SSH] Connected to ${device.name} (${device.ip}) as ${user.username} [${isAdmin ? 'full' : 'restricted'}]`);
            safeSend(JSON.stringify({ type: 'info', message: 'SSH Connection Established.\r\n' }));
            // İstemciye modunu bildir: admin = tam kontrol, user = sadece komut butonları
            safeSend(JSON.stringify({ type: 'mode', readOnly: !isAdmin, commands: allowedCommands || [] }));
            conn.shell((err, stream) => {
                if (err) { safeSend(JSON.stringify({ type: 'error', message: err.message })); return; }
                stream.on('data', (data) => safeSend(JSON.stringify({ type: 'data', data: data.toString() })));
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
            safeSend(JSON.stringify({ type: 'error', message: 'SSH Failed: ' + err.message }));
        }).connect({
            host: device.ip,
            port: 22,
            username: device.sshUsername,
            password: decryptPassword(device.sshPassword),
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
        });
    });

    return wss;
}

module.exports = { setupWebSocket };
