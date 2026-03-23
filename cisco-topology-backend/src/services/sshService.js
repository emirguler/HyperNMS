const WebSocket = require('ws');
const ssh2 = require('ssh2').Client;
const store = require('../utils/memoryStore');
const { decryptPassword } = require('../utils/crypto');
const { authenticateWs } = require('../middleware/auth');

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

    server.on('upgrade', (req, socket, head) => {
        if (req.url.startsWith('/ws/terminal')) {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        }
        // /ws/notifications is handled by notificationService
    });

    wss.on('connection', (ws, req) => {
        const user = authenticateWs(req);
        if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: 'Authentication required. Please re-login.' }));
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

        const safeSend = (data) => {
            try { if (ws.readyState === WebSocket.OPEN) ws.send(data); } catch (e) { /* ignore */ }
        };

        const conn = new ssh2();
        conn.on('ready', () => {
            console.log(`[SSH] Connected to ${device.name} (${device.ip})`);
            safeSend(JSON.stringify({ type: 'info', message: 'SSH Connection Established.\r\n' }));
            conn.shell((err, stream) => {
                if (err) { safeSend(JSON.stringify({ type: 'error', message: err.message })); return; }
                stream.on('data', (data) => safeSend(JSON.stringify({ type: 'data', data: data.toString() })));
                stream.on('close', () => { conn.end(); try { ws.close(); } catch (e) {} });
                ws.on('message', (msg) => {
                    try {
                        const parsed = JSON.parse(msg);
                        if (parsed.type === 'data') stream.write(parsed.data);
                    } catch (e) { /* ignore */ }
                });
            });
        }).on('error', (err) => {
            console.log(`[SSH] Error ${device.name}: ${err.message}`);
            safeSend(JSON.stringify({ type: 'error', message: 'Connection Failed: ' + err.message }));
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
