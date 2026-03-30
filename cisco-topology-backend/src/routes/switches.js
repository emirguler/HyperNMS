const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch, isBlockedIP } = require('../utils/validation');
const { encryptPassword, decryptPassword } = require('../utils/crypto');
const { getDeviceDetails, discoverNeighbors, searchMAC } = require('../services/snmpService');
const { logAction } = require('../services/auditLog');
const { snmpCache } = require('../utils/cache');
const ssh2 = require('ssh2').Client;

const router = express.Router();

router.get('/topology', authenticate, (req, res) => {
    const switches = store.getSwitches();
    const edges = store.getEdges();
    const isAdmin = req.user.role === 'Administrator';
    const TOPOLOGY_ALLOWLIST = ['id', 'name', 'ip', 'type', 'status', 'latency', 'position', 'tags', 'topologyPage', 'lastLatency', 'healthIntervalSec'];
    const safeSwitches = switches.map(({ sshPassword, ...s }) => {
        if (!isAdmin) {
            const filtered = {};
            for (const key of TOPOLOGY_ALLOWLIST) {
                if (s[key] !== undefined) filtered[key] = s[key];
            }
            return filtered;
        }
        s.sshPasswordSet = !!(sshPassword && sshPassword.length > 0);
        return s;
    });
    const tabs = store.getTopoTabs();
    res.json({ switches: safeSwitches, edges, tabs });
});

// --- Topology Tabs ---
router.get('/topology/tabs', authenticate, (req, res) => {
    res.json(store.getTopoTabs());
});

router.post('/topology/tabs', authenticate, requireAdmin, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Tab name required' });
    }
    const tab = store.addTopoTab({ id: 'tab-' + Date.now(), name: name.trim() });
    res.json(tab);
});

router.put('/topology/tabs/:id', authenticate, requireAdmin, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Tab name required' });
    }
    const ok = store.renameTopoTab(req.params.id, name.trim());
    if (!ok) return res.status(404).json({ error: 'Tab not found' });
    res.json({ success: true });
});

router.delete('/topology/tabs/:id', authenticate, requireAdmin, (req, res) => {
    const ok = store.removeTopoTab(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Tab not found or cannot delete main' });
    res.json({ success: true });
});

// --- Auto Topology Discovery (CDP/LLDP) ---
router.post('/topology/auto-discover', authenticate, requireAdmin, async (req, res) => {
    const { deviceIds, rootDeviceId } = req.body;
    if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
        return res.status(400).json({ error: 'deviceIds array required' });
    }

    const allSwitches = store.getSwitches();
    const targetDevices = allSwitches.filter(s => deviceIds.includes(s.id));
    const existingEdges = store.getEdges();

    console.log(`[DISCOVERY] Starting auto-discovery for ${targetDevices.length} devices...`);

    // Step 1: Collect all CDP/LLDP neighbors from all target devices
    const discoveryResults = [];
    for (const device of targetDevices) {
        const neighbors = await discoverNeighbors(device);
        for (const neighbor of neighbors) {
            discoveryResults.push({ sourceId: device.id, sourceName: device.name, ...neighbor });
        }
        if (neighbors.length > 0) {
            console.log(`[DISCOVERY] ${device.name}: found ${neighbors.length} neighbors via ${[...new Set(neighbors.map(n => n.protocol))].join('+')}`);
        }
    }

    // Step 2: Match neighbors to known devices
    // Multi-IP matching: try hostname first, then IP, then partial hostname
    function findMatchingDevice(neighbor) {
        const neighHostname = (neighbor.hostname || '').toLowerCase().split('.')[0];
        const neighIp = neighbor.ip;

        // 1. Exact hostname match (case-insensitive, strip domain)
        if (neighHostname) {
            const byHostname = allSwitches.find(s => {
                const sName = (s.name || '').toLowerCase().split('.')[0];
                const sSnmpHostname = (s.snmpHostname || '').toLowerCase().split('.')[0];
                return sName === neighHostname || sSnmpHostname === neighHostname;
            });
            if (byHostname) return byHostname;
        }

        // 2. IP match (CDP/LLDP IP might differ from monitor IP)
        if (neighIp) {
            const byIp = allSwitches.find(s => s.ip === neighIp);
            if (byIp) return byIp;
        }

        // 3. Partial hostname match (neighbor hostname contains device name or vice versa)
        if (neighHostname && neighHostname.length > 3) {
            const byPartial = allSwitches.find(s => {
                const sName = (s.name || '').toLowerCase();
                return sName.includes(neighHostname) || neighHostname.includes(sName);
            });
            if (byPartial) return byPartial;
        }

        return null;
    }

    // Step 3: Collect neighbor pairs (don't create edges yet — need tree depth first)
    const neighborPairs = [];
    for (const result of discoveryResults) {
        const target = findMatchingDevice(result);
        if (!target || target.id === result.sourceId) continue;
        if (!deviceIds.includes(target.id)) continue;

        // Skip duplicates (either direction)
        const exists = existingEdges.some(e =>
            (e.source === result.sourceId && e.target === target.id) ||
            (e.source === target.id && e.target === result.sourceId)
        ) || neighborPairs.some(p =>
            (p.a === result.sourceId && p.b === target.id) ||
            (p.a === target.id && p.b === result.sourceId)
        );

        if (!exists) {
            neighborPairs.push({ a: result.sourceId, b: target.id });
        }
    }

    // Step 4: Calculate tree layout
    // Build adjacency from existing edges + new pairs
    const adjacency = {};
    for (const id of deviceIds) adjacency[id] = [];

    for (const e of existingEdges) {
        if (deviceIds.includes(e.source) && deviceIds.includes(e.target)) {
            if (adjacency[e.source]) adjacency[e.source].push(e.target);
            if (adjacency[e.target]) adjacency[e.target].push(e.source);
        }
    }
    for (const p of neighborPairs) {
        adjacency[p.a].push(p.b);
        adjacency[p.b].push(p.a);
    }

    // Find root device — goes to TOP of tree
    let rootId;
    if (rootDeviceId && deviceIds.includes(rootDeviceId)) {
        // User explicitly selected root
        rootId = rootDeviceId;
    } else {
        // Auto-detect: use "in-degree" — how many page devices discovered this device as neighbor
        // The device discovered by the MOST other page devices is likely the core/backbone
        const inDegree = {};
        for (const id of deviceIds) inDegree[id] = 0;

        for (const result of discoveryResults) {
            const target = findMatchingDevice(result);
            if (target && target.id !== result.sourceId && deviceIds.includes(target.id)) {
                inDegree[target.id] = (inDegree[target.id] || 0) + 1;
            }
        }

        // Pick device with highest in-degree (most other devices see it as neighbor)
        // Tie-break: prefer device with most total adjacency connections
        rootId = deviceIds[0];
        let maxInDeg = -1;
        for (const id of deviceIds) {
            const deg = inDegree[id] || 0;
            if (deg > maxInDeg || (deg === maxInDeg && (adjacency[id] || []).length > (adjacency[rootId] || []).length)) {
                maxInDeg = deg;
                rootId = id;
            }
        }

        const rootDevice = allSwitches.find(s => s.id === rootId);
        console.log(`[DISCOVERY] Auto-selected root: ${rootDevice?.name} (in-degree: ${maxInDeg})`);
    }

    // BFS to assign depth (root=0=top, leaves=deepest=bottom)
    const nodeDepths = {};
    const parentMap = {}; // child → parent (for edge direction)
    const depthNodes = {};
    const bfsQueue = [rootId];
    const bfsVisited = new Set([rootId]);
    nodeDepths[rootId] = 0;

    while (bfsQueue.length > 0) {
        const current = bfsQueue.shift();
        const depth = nodeDepths[current];
        if (!depthNodes[depth]) depthNodes[depth] = [];
        depthNodes[depth].push(current);

        for (const neighbor of (adjacency[current] || [])) {
            if (!bfsVisited.has(neighbor)) {
                bfsVisited.add(neighbor);
                nodeDepths[neighbor] = depth + 1;
                parentMap[neighbor] = current;
                bfsQueue.push(neighbor);
            }
        }
    }

    // Disconnected nodes → last row
    let maxDepth = Object.keys(depthNodes).length > 0
        ? Math.max(...Object.values(nodeDepths)) : 0;
    for (const id of deviceIds) {
        if (!bfsVisited.has(id)) {
            maxDepth += 1;
            nodeDepths[id] = maxDepth;
            if (!depthNodes[maxDepth]) depthNodes[maxDepth] = [];
            depthNodes[maxDepth].push(id);
        }
    }

    // Assign positions: root at top, children below, centered
    const positions = {};
    const HORIZONTAL_SPACING = 180;
    const VERTICAL_SPACING = 150;

    for (const [depth, nodes] of Object.entries(depthNodes)) {
        const d = parseInt(depth);
        const totalWidth = (nodes.length - 1) * HORIZONTAL_SPACING;
        const startX = -totalWidth / 2;

        nodes.forEach((nodeId, idx) => {
            positions[nodeId] = {
                x: startX + idx * HORIZONTAL_SPACING + 400,
                y: d * VERTICAL_SPACING + 50
            };
        });
    }

    // Step 5: Create edges with correct direction (parent→child, bottom→top)
    const newEdges = [];
    for (const pair of neighborPairs) {
        // Determine which is parent (shallower depth) and which is child
        const depthA = nodeDepths[pair.a] ?? 999;
        const depthB = nodeDepths[pair.b] ?? 999;
        const parentId = depthA <= depthB ? pair.a : pair.b;
        const childId = depthA <= depthB ? pair.b : pair.a;

        const edge = {
            id: `e-${parentId}-${childId}-${Date.now() + newEdges.length}`,
            source: parentId,
            target: childId,
            sourceHandle: 'bottom',
            targetHandle: 'top'
        };
        newEdges.push(edge);
        store.addEdge(edge);
    }

    // Also fix existing edges: set handles based on tree depth
    const updatedEdges = [];
    for (const e of existingEdges) {
        if (!deviceIds.includes(e.source) || !deviceIds.includes(e.target)) continue;
        const depthS = nodeDepths[e.source] ?? 999;
        const depthT = nodeDepths[e.target] ?? 999;

        if (depthS <= depthT) {
            // source is parent → bottom to top (correct)
            if (e.sourceHandle !== 'bottom' || e.targetHandle !== 'top') {
                store.updateEdge(e.id, { sourceHandle: 'bottom', targetHandle: 'top' });
                updatedEdges.push(e.id);
            }
        } else {
            // source is actually child → swap direction in handles
            // Keep source/target IDs but flip handles
            store.updateEdge(e.id, {
                source: e.target, target: e.source,
                sourceHandle: 'bottom', targetHandle: 'top'
            });
            updatedEdges.push(e.id);
        }
    }

    // Step 6: Update device positions
    for (const [id, pos] of Object.entries(positions)) {
        store.updateSwitch(id, { position: pos });
    }

    console.log(`[DISCOVERY] Done: ${newEdges.length} new edges, ${updatedEdges.length} edges fixed, ${Object.keys(positions).length} devices positioned`);

    res.json({
        newEdges: newEdges.length,
        totalNeighbors: discoveryResults.length,
        positions,
        discoveryResults: discoveryResults.map(r => ({
            source: r.sourceName,
            protocol: r.protocol,
            neighbor: r.hostname || r.ip,
            matched: !!findMatchingDevice(r)
        }))
    });
});

router.post('/mac-search', authenticate, async (req, res) => {
    const { query, force } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length < 5) {
        return res.status(400).json({ error: 'Valid IP or MAC address required' });
    }

    const devices = store.getSwitches().filter(s => s.status === 'UP' && s.snmpCommunity);
    if (devices.length === 0) {
        return res.json({ results: [], error: 'No devices with SNMP available' });
    }

    try {
        const result = await searchMAC(devices, query.trim(), !!force);
        res.json(result);
    } catch (e) {
        console.error('[MAC-SEARCH] Error:', e.message);
        res.status(500).json({ error: 'Search failed: ' + e.message });
    }
});

router.put('/switches/batch', authenticate, requireAdmin, async (req, res) => {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'ids array and updates object required' });
    }

    const allowed = ['sshUsername', 'sshPassword', 'snmpCommunity', 'tags', 'topologyPage', 'type', 'healthIntervalSec'];
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
        if (allowed.includes(key)) safeUpdates[key] = updates[key];
    }

    if (safeUpdates.sshPassword) {
        safeUpdates.sshPassword = encryptPassword(safeUpdates.sshPassword);
    }

    let count = 0;
    for (const id of ids) {
        const updated = store.updateSwitch(id, safeUpdates);
        if (updated) count++;
    }

    await logAction(req.user, 'DEVICE_BATCH_UPDATE', `${count} devices updated`, { fields: Object.keys(safeUpdates) });
    res.json({ success: true, updated: count });
});

router.post('/switches', authenticate, requireAdmin, async (req, res) => {
    const payload = sanitizeSwitch(req.body);
    const errors = validateSwitch(payload);
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });

    if (store.getSwitches().find(s => s.ip === payload.ip)) {
        return res.status(400).json({ error: 'This IP address is already registered' });
    }

    if (payload.sshPassword) payload.sshPassword = encryptPassword(payload.sshPassword);

    const newSwitch = { id: Date.now().toString(), status: 'DOWN', latency: 0, position: { x: 0, y: 0 }, tags: [], ...payload };
    store.addSwitch(newSwitch);

    await logAction(req.user, 'DEVICE_CREATE', newSwitch.name, { ip: newSwitch.ip, type: newSwitch.type });
    res.json({ ...newSwitch, sshPassword: undefined });
});

router.put('/switches/:id', authenticate, requireAdmin, async (req, res) => {
    const payload = sanitizeSwitch(req.body);
    const isPositionOnly = Object.keys(payload).length === 1 && payload.position;

    if (!isPositionOnly && payload.ip) {
        const errors = validateSwitch({ ...payload, name: payload.name || 'tmp' }).filter(e => !e.includes('Device name'));
        if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });
    }

    if (payload.sshPassword) {
        payload.sshPassword = encryptPassword(payload.sshPassword);
    } else {
        delete payload.sshPassword;
    }

    const updated = store.updateSwitch(req.params.id, payload);
    if (!updated) return res.status(404).json({ error: 'Device not found' });

    if (!isPositionOnly) await logAction(req.user, 'DEVICE_UPDATE', updated.name, { ip: updated.ip });
    res.json({ ...updated, sshPassword: undefined });
});

router.delete('/switches/:id', authenticate, requireAdmin, async (req, res) => {
    const target = store.getSwitch(req.params.id);
    if (!target) return res.status(404).json({ error: 'Device not found' });

    store.deleteSwitch(req.params.id);
    // İlgili edge'leri de sil
    store.getEdges().filter(e => e.source === req.params.id || e.target === req.params.id)
        .forEach(e => store.deleteEdge(e.id));

    await logAction(req.user, 'DEVICE_DELETE', target.name, { ip: target.ip });
    res.json({ success: true });
});

router.get('/switches/:id/details', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).send();
    const details = await getDeviceDetails(device);
    // Admin can see SNMP community, SSH username, and password status
    if (req.user.role === 'Administrator') {
        details.snmpCommunity = device.snmpCommunity || '';
        details.sshUsername = device.sshUsername || '';
        details.sshPasswordSet = !!(device.sshPassword && device.sshPassword.length > 0);
        details.model = device.model || '';
    }
    res.json(details);
});

router.get('/switches/:id/ping-history', authenticate, (req, res) => {
    const duration = parseInt(req.query.duration) || 3600000;
    const since = Date.now() - duration;
    const history = store.getHistory(req.params.id, since);
    res.json(history);
});

// SSH komutu çalıştır (show run vb.)
router.post('/switches/:id/exec', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (!device.sshUsername || !device.sshPassword) return res.status(400).json({ error: 'SSH credentials missing' });
    if (isBlockedIP(device.ip)) return res.status(403).json({ error: 'Connection to this IP is not allowed' });

    const command = req.body.command;
    if (!command || typeof command !== 'string' || command.length > 500) {
        return res.status(400).json({ error: 'Valid command required (max 500 chars)' });
    }

    const cmd = command.trim().toLowerCase();
    const ALLOWED_PREFIXES = ['show ', 'display '];
    if (!ALLOWED_PREFIXES.some(p => cmd.startsWith(p))) {
        return res.status(403).json({ error: 'Only read-only commands (show, display) are allowed' });
    }

    if (/[;|&`\n\r]/.test(command) || /\$\(/.test(command)) {
        return res.status(403).json({ error: 'Command contains blocked characters' });
    }

    const BLOCKED_PIPES = ['redirect', 'tee', 'append', '>', 'tftp:', 'ftp:', 'scp:', 'http:'];
    if (BLOCKED_PIPES.some(b => cmd.includes(b))) {
        return res.status(403).json({ error: 'Output redirection is not allowed' });
    }

    const cacheKey = `exec:${device.id}:${command}`;
    const cached = snmpCache.get(cacheKey);
    if (cached) return res.json({ output: cached });

    try {
        const output = await new Promise((resolve, reject) => {
            const conn = new ssh2();
            let result = '';
            let dataTimeout = null;
            const hardTimeout = setTimeout(() => { conn.end(); resolve(result); }, 20000);

            conn.on('ready', () => {
                // Cisco IOS shell modunda çalıştır (exec desteklemiyor)
                conn.shell((err, stream) => {
                    if (err) { clearTimeout(hardTimeout); conn.end(); return reject(err); }

                    stream.on('data', (data) => {
                        result += data.toString();
                        // Her veri geldiğinde timer'ı sıfırla — 2 saniye veri gelmezse bitir
                        if (dataTimeout) clearTimeout(dataTimeout);
                        dataTimeout = setTimeout(() => {
                            clearTimeout(hardTimeout);
                            stream.end();
                            conn.end();
                            resolve(result);
                        }, 2000);
                    });

                    stream.on('close', () => {
                        clearTimeout(hardTimeout);
                        if (dataTimeout) clearTimeout(dataTimeout);
                        conn.end();
                        resolve(result);
                    });

                    // terminal length 0 ile paging'i kapat, sonra komutu çalıştır
                    stream.write('terminal length 0\n');
                    setTimeout(() => stream.write(command + '\n'), 500);
                });
            }).on('error', (err) => {
                clearTimeout(hardTimeout);
                reject(err);
            }).connect({
                host: device.ip, port: 22,
                username: device.sshUsername,
                password: decryptPassword(device.sshPassword),
                algorithms: {
                    kex: ["ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha1"],
                    cipher: ["aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-cbc"],
                    serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384"]
                }
            });
        });

        // Çıktıyı temizle — ANSI escape kodlarını ve prompt'ları kaldır
        const cleanOutput = output
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape
            .replace(/\r/g, '')                      // carriage return
            .split('\n')
            .filter(line => !line.includes('terminal length 0')) // komut echo'sunu kaldır
            .join('\n')
            .trim();

        snmpCache.set(cacheKey, cleanOutput, 120000); // 2 dakika cache
        await logAction(req.user, 'SSH_EXEC', device.name, { command });
        res.json({ output: cleanOutput });
    } catch (err) {
        res.status(500).json({ error: 'SSH error:' + err.message });
    }
});

router.get('/switches/export/csv', authenticate, (req, res) => {
    const switches = store.getSwitches();
    const headers = ['Name', 'IP', 'Type', 'Status', 'Latency', 'Model', 'Tags'];
    const rows = switches.map(s => [
        s.name, s.ip, s.type || 'switch', s.status, s.latency, s.model || '', (s.tags || []).join(';')
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=devices.csv');
    res.send(csv);
});

module.exports = router;
