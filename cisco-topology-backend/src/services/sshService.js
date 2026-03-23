const WebSocket = require('ws');
const ssh2 = require('ssh2').Client;
const store = require('../utils/memoryStore');
const { decryptPassword } = require('../utils/crypto');
const { authenticateWs } = require('../middleware/auth');

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/terminal' });

    wss.on('connection', (ws, req) => {
        // WebSocket JWT doğrulaması
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

        const conn = new ssh2();
        conn.on('ready', () => {
            ws.send(JSON.stringify({ type: 'info', message: 'SSH Connection Established.\r\n' }));
            conn.shell((err, stream) => {
                if (err) return ws.send(JSON.stringify({ type: 'error', message: err.message }));
                stream.on('data', (data) => ws.send(JSON.stringify({ type: 'data', data: data.toString() })));
                stream.on('close', () => { conn.end(); ws.close(); });
                ws.on('message', (msg) => {
                    try {
                        const parsed = JSON.parse(msg);
                        if (parsed.type === 'data') stream.write(parsed.data);
                    } catch (e) { /* ignore parse errors */ }
                });
            });
        }).on('error', (err) => {
            ws.send(JSON.stringify({ type: 'error', message: 'Connection Failed: ' + err.message }));
        }).connect({
            host: device.ip,
            port: 22,
            username: device.sshUsername,
            password: decryptPassword(device.sshPassword),
            algorithms: {
                kex: [
                    "diffie-hellman-group1-sha1", "diffie-hellman-group14-sha1",
                    "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
                    "diffie-hellman-group-exchange-sha256", "diffie-hellman-group-exchange-sha1"
                ],
                cipher: [
                    "aes128-ctr", "aes192-ctr", "aes256-ctr",
                    "aes128-cbc", "3des-cbc", "aes192-cbc", "aes256-cbc"
                ],
                serverHostKey: ["ssh-rsa", "ssh-dss"]
            }
        });

        ws.on('close', () => {
            try { conn.end(); } catch (e) { /* ignore */ }
        });
    });

    return wss;
}

module.exports = { setupWebSocket };
