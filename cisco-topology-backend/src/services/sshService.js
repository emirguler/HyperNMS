const WebSocket = require('ws');
const ssh2 = require('ssh2').Client;
const net = require('net');
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
        const protocol = urlParams.get('protocol') || 'ssh';
        const device = store.getSwitch(switchId);

        if (!device) {
            ws.send(JSON.stringify({ type: 'error', message: 'Device not found.' }));
            return;
        }

        const safeSend = (data) => {
            try { if (ws.readyState === WebSocket.OPEN) ws.send(data); } catch (e) { /* ignore */ }
        };

        if (protocol === 'telnet') {
            handleTelnet(ws, device, safeSend);
        } else {
            handleSSH(ws, device, safeSend);
        }
    });

    return wss;
}

function handleSSH(ws, device, safeSend) {
    if (!device.sshUsername) {
        safeSend(JSON.stringify({ type: 'error', message: 'SSH Credentials not found.' }));
        return;
    }

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
        safeSend(JSON.stringify({ type: 'error', message: 'SSH Failed: ' + err.message }));
    }).connect({
        host: device.ip,
        port: 22,
        username: device.sshUsername,
        password: decryptPassword(device.sshPassword),
        algorithms: {
            kex: [
                "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
                "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha1",
                "diffie-hellman-group1-sha1", "diffie-hellman-group-exchange-sha1"
            ],
            cipher: [
                "aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc"
            ],
            serverHostKey: ["ssh-rsa", "ssh-dss", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384"]
        }
    });

    ws.on('close', () => {
        try { conn.end(); } catch (e) { /* ignore */ }
    });
}

function handleTelnet(ws, device, safeSend) {
    const socket = new net.Socket();
    let loginSent = false;
    let passwordSent = false;
    let buffer = '';

    socket.connect(23, device.ip, () => {
        console.log(`[TELNET] Connected to ${device.name} (${device.ip})`);
        safeSend(JSON.stringify({ type: 'info', message: 'Telnet Connection Established.\r\n' }));
    });

    socket.on('data', (data) => {
        let cleanData = '';
        const bytes = Buffer.from(data);

        // Filter out Telnet IAC negotiation sequences
        let i = 0;
        while (i < bytes.length) {
            if (bytes[i] === 0xFF && i + 2 < bytes.length) {
                const cmd = bytes[i + 1];
                // IAC DO/DONT/WILL/WONT — respond appropriately
                if (cmd === 0xFD || cmd === 0xFB) { // DO or WILL
                    const opt = bytes[i + 2];
                    // Refuse everything except echo (1) and suppress go ahead (3)
                    if (opt === 1 || opt === 3) {
                        socket.write(Buffer.from([0xFF, cmd === 0xFD ? 0xFB : 0xFD, opt])); // WILL/DO
                    } else {
                        socket.write(Buffer.from([0xFF, cmd === 0xFD ? 0xFC : 0xFE, opt])); // WONT/DONT
                    }
                    i += 3;
                    continue;
                } else if (cmd === 0xFE || cmd === 0xFC) { // DONT or WONT
                    i += 3;
                    continue;
                } else if (cmd === 0xFA) { // SB (subnegotiation)
                    // Skip until IAC SE (0xFF 0xF0)
                    i += 3;
                    while (i < bytes.length - 1) {
                        if (bytes[i] === 0xFF && bytes[i + 1] === 0xF0) { i += 2; break; }
                        i++;
                    }
                    continue;
                }
                i += 3;
                continue;
            }
            // Skip NULL bytes
            if (bytes[i] !== 0x00) {
                cleanData += String.fromCharCode(bytes[i]);
            }
            i++;
        }

        if (cleanData.length > 0) {
            safeSend(JSON.stringify({ type: 'data', data: cleanData }));
        }

        // Auto-login: detect username/password prompts
        buffer += cleanData.toLowerCase();
        if (buffer.length > 500) buffer = buffer.slice(-500);

        if (!loginSent && device.sshUsername && (buffer.includes('username:') || buffer.includes('login:'))) {
            loginSent = true;
            setTimeout(() => socket.write(device.sshUsername + '\r\n'), 200);
        }
        if (!passwordSent && loginSent && device.sshPassword && buffer.includes('password:')) {
            passwordSent = true;
            setTimeout(() => socket.write(decryptPassword(device.sshPassword) + '\r\n'), 200);
        }
    });

    socket.on('error', (err) => {
        console.log(`[TELNET] Error ${device.name}: ${err.message}`);
        safeSend(JSON.stringify({ type: 'error', message: 'Telnet Failed: ' + err.message }));
    });

    socket.on('close', () => {
        safeSend(JSON.stringify({ type: 'info', message: '\r\n*** Telnet connection closed ***\r\n' }));
        try { ws.close(); } catch (e) {}
    });

    ws.on('message', (msg) => {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'data') socket.write(parsed.data);
        } catch (e) { /* ignore */ }
    });

    ws.on('close', () => {
        try { socket.destroy(); } catch (e) { /* ignore */ }
    });
}

module.exports = { setupWebSocket };
