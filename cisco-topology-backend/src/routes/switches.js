const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch, isBlockedIP, isValidIPv4 } = require('../utils/validation');
const { encryptPassword, decryptPassword } = require('../utils/crypto');
const { getDeviceDetails, discoverNeighbors, searchMAC, inventoryAll, ipSlaStatus } = require('../services/snmpService');
const { probeDevice, ipSlaViaSsh, runCommands, runShowCommand, kbAuth } = require('../services/sshService');
const { listBackups, getBackup, backupDevice } = require('../services/configBackupService');
const { getImportableConfig } = require('../services/importableConfigService');
const { identifyFromSsh } = require('../utils/sshIdentify');
const { logAction } = require('../services/auditLog');
const { snmpCache } = require('../utils/cache');
const rateLimiter = require('../middleware/rateLimiter');
const ping = require('ping');
const ssh2 = require('ssh2').Client;
const { spawn } = require('child_process');

const router = express.Router();

// --- Manuel ping (Ping aracı) — hem admin hem User rolüne açık ---
// Ping çıktısını sınıflandır: success / timeout / unreachable / failed
function classifyPing(r) {
    if (r.alive) return { status: 'success', latency: r.time === 'unknown' ? null : Math.round(r.time) };
    const out = String(r.output || '').toLowerCase();
    if (out.includes('unreachable')) return { status: 'unreachable', latency: null };
    if (out.includes('timed out') || out.includes('timeout') || out.includes('100% packet loss')) return { status: 'timeout', latency: null };
    return { status: 'failed', latency: null };
}

const pingToolLimiter = rateLimiter({ windowMs: 60000, max: 80, message: 'Too many ping requests, please slow down' });
router.post('/ping', authenticate, pingToolLimiter, async (req, res) => {
    try {
        const ip = String((req.body && req.body.ip) || '').trim();
        // SSRF: yalnızca geçerli IPv4, bloklu aralıklar hariç (loopback/link-local/metadata/multicast)
        if (!isValidIPv4(ip) || isBlockedIP(ip)) {
            return res.status(400).json({ error: 'Valid IP address required' });
        }
        const n = Math.min(Math.max(parseInt(req.body && req.body.count) || 1, 1), 10);
        const isWin = process.platform === 'win32';
        const results = [];
        for (let i = 0; i < n; i++) {
            try {
                const r = await ping.promise.probe(ip, { timeout: 2, extra: isWin ? ['-n', '1'] : ['-c', '1'] });
                results.push(classifyPing(r));
            } catch (e) {
                results.push({ status: 'error', latency: null });
            }
        }
        res.json({ ip, results });
    } catch (e) {
        console.error('[PING-TOOL] Hata:', e.message);
        res.status(500).json({ error: 'Ping failed' });
    }
});

// --- Traceroute (Trace aracı) — hem admin hem User rolüne açık, ping ile aynı SSRF koruması ---
// tracert (Windows) / traceroute (Linux/Alpine) çıktısını satır satır ayrıştırır:
// her hop için { hop, ip, rtt(ms|null), timedOut }. Her iki formatı da destekler
// (Win: "1  <1 ms  10.0.0.1", Linux -n: "1  10.0.0.1  0.1 ms").
function parseTrace(output) {
    const hops = [];
    // Windows tracert CRLF verir; \r kalırsa regex'teki $ hop satırlarını yakalayamaz → \r?\n ile böl
    for (const line of String(output || '').split(/\r?\n/)) {
        const m = line.match(/^\s*(\d+)\s+(.*)$/);
        if (!m) continue; // başlık/altbilgi satırları
        const rest = m[2];
        const ipm = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        const rtts = [...rest.matchAll(/<?\s*([\d.]+)\s*ms/gi)].map(x => parseFloat(x[1])).filter(n => Number.isFinite(n));
        const hopIp = ipm ? ipm[1] : null;
        hops.push({
            hop: parseInt(m[1], 10),
            ip: hopIp,
            rtt: rtts.length ? Math.min(...rtts) : null,
            timedOut: !hopIp && /\*/.test(rest),
        });
    }
    return hops;
}

// Tek traceroute çalıştırması → { hops, err }. ASLA reject etmez. 45sn'de süreç öldürülür.
function spawnTrace(cmd, args) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(cmd, args, { windowsHide: true });
        } catch (e) {
            return resolve({ hops: [], err: 'failed' });
        }
        let out = '';
        let settled = false;
        const done = (r) => { if (settled) return; settled = true; clearTimeout(killer); resolve(r); };
        const killer = setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } }, 45000);
        child.stdout.on('data', d => { out += d.toString(); if (out.length > 65536) out = out.slice(-65536); });
        child.stderr.on('data', d => { out += d.toString(); });
        // ENOENT → komut yüklü değil (ör. Alpine'da traceroute paketi eksik)
        child.on('error', (e) => done({ hops: [], err: e.code === 'ENOENT' ? 'notinstalled' : 'failed' }));
        child.on('close', () => done({ hops: parseTrace(out), err: null }));
    });
}

const traceLimiter = rateLimiter({ windowMs: 60000, max: 20, message: 'Too many trace requests, please slow down' });
router.post('/traceroute', authenticate, traceLimiter, async (req, res) => {
    const ip = String((req.body && req.body.ip) || '').trim();
    // SSRF: ping ile aynı — yalnızca geçerli IPv4, bloklu aralıklar hariç
    if (!isValidIPv4(ip) || isBlockedIP(ip)) {
        return res.status(400).json({ error: 'Valid IP address required' });
    }
    const isWin = process.platform === 'win32';
    const MAX_HOPS = 20;
    // Argümanlar dizi olarak veriliyor (shell yok) → enjeksiyon yok. IP zaten doğrulandı.

    if (isWin) {
        // Windows tracert zaten ICMP echo → temiz sonuç
        const r = await spawnTrace('tracert', ['-d', '-h', String(MAX_HOPS), '-w', '2000', ip]);
        if (r.err === 'notinstalled') return res.status(500).json({ error: 'traceroute not installed on server' });
        return res.json({ ip, hops: r.hops });
    }

    // Linux: ÖNCE ICMP (-I) — Windows tracert ile aynı, temiz. Linux traceroute varsayılanı
    // UDP'dir ve firewall/hedef UDP probe'una cevap vermeyince timeout'a düşer.
    let r = await spawnTrace('traceroute', ['-I', '-n', '-m', String(MAX_HOPS), '-w', '2', ip]);
    if (r.err === 'notinstalled') return res.status(500).json({ error: 'traceroute not installed on server' });
    // ICMP hiç hop döndürmediyse (ör. raw-soket izni yoksa) UDP'ye düş → araç yine de çalışsın
    if (!r.hops.length) {
        const udp = await spawnTrace('traceroute', ['-n', '-m', String(MAX_HOPS), '-w', '2', ip]);
        if (udp.hops.length) r = udp;
    }
    return res.json({ ip, hops: r.hops });
});

router.get('/topology', authenticate, (req, res) => {
    const switches = store.getSwitches();
    const edges = store.getEdges();
    const isAdmin = req.user.role === 'Administrator';
    const TOPOLOGY_ALLOWLIST = ['id', 'name', 'ip', 'type', 'status', 'latency', 'position', 'tags', 'topologyPage', 'lastLatency', 'healthIntervalSec', 'ipSlaEnabled', 'ipSlaOkLabel', 'ipSlaFailLabel', 'version'];
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

// DİKKAT: Bu rota '/topology/tabs/:id'den ÖNCE gelmeli — aksi halde Express
// "reorder" kelimesini :id sanıp rename rotasını çalıştırır.
router.put('/topology/tabs/reorder', authenticate, requireAdmin, (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array required' });
    }
    store.reorderTopoTabs(ids);
    res.json({ success: true, tabs: store.getTopoTabs() });
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
    const { deviceIds, rootDeviceId, rootDeviceIds } = req.body;
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
    function findMatchingDevice(neighbor) {
        const neighHostname = (neighbor.hostname || '').toLowerCase().split('.')[0];
        const neighIp = neighbor.ip;

        if (neighHostname) {
            const byHostname = allSwitches.find(s => {
                const sName = (s.name || '').toLowerCase().split('.')[0];
                const sSnmpHostname = (s.snmpHostname || '').toLowerCase().split('.')[0];
                return sName === neighHostname || sSnmpHostname === neighHostname;
            });
            if (byHostname) return byHostname;
        }

        if (neighIp) {
            const byIp = allSwitches.find(s => s.ip === neighIp);
            if (byIp) return byIp;
        }

        if (neighHostname && neighHostname.length > 3) {
            const byPartial = allSwitches.find(s => {
                const sName = (s.name || '').toLowerCase();
                return sName.includes(neighHostname) || neighHostname.includes(sName);
            });
            if (byPartial) return byPartial;
        }

        return null;
    }

    // Step 3: Collect neighbor pairs
    const neighborPairs = [];
    for (const result of discoveryResults) {
        const target = findMatchingDevice(result);
        if (!target || target.id === result.sourceId) continue;
        if (!deviceIds.includes(target.id)) continue;

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

    // Step 4: Build adjacency graph
    const adjacency = {};
    for (const id of deviceIds) adjacency[id] = new Set();

    for (const e of existingEdges) {
        if (deviceIds.includes(e.source) && deviceIds.includes(e.target)) {
            adjacency[e.source]?.add(e.target);
            adjacency[e.target]?.add(e.source);
        }
    }
    for (const p of neighborPairs) {
        adjacency[p.a].add(p.b);
        adjacency[p.b].add(p.a);
    }

    // Determine root device(s) — supports dual backbone
    // rootDeviceIds: array of 1-2 backbone device IDs (new)
    // rootDeviceId: single root (legacy compat)
    let roots = [];
    if (rootDeviceIds && Array.isArray(rootDeviceIds) && rootDeviceIds.length > 0) {
        roots = rootDeviceIds.filter(id => deviceIds.includes(id));
    } else if (rootDeviceId && deviceIds.includes(rootDeviceId)) {
        roots = [rootDeviceId];
    }

    if (roots.length === 0) {
        // Auto-detect: pick device with highest in-degree
        const inDegree = {};
        for (const id of deviceIds) inDegree[id] = 0;
        for (const result of discoveryResults) {
            const target = findMatchingDevice(result);
            if (target && target.id !== result.sourceId && deviceIds.includes(target.id)) {
                inDegree[target.id] = (inDegree[target.id] || 0) + 1;
            }
        }
        let rootId = deviceIds[0];
        let maxInDeg = -1;
        for (const id of deviceIds) {
            const deg = inDegree[id] || 0;
            if (deg > maxInDeg || (deg === maxInDeg && (adjacency[id]?.size || 0) > (adjacency[rootId]?.size || 0))) {
                maxInDeg = deg;
                rootId = id;
            }
        }
        roots = [rootId];
        const rootDevice = allSwitches.find(s => s.id === rootId);
        console.log(`[DISCOVERY] Auto-selected root: ${rootDevice?.name} (in-degree: ${maxInDeg})`);
    }

    const isDualBackbone = roots.length === 2;
    console.log(`[DISCOVERY] Roots: ${roots.map(id => allSwitches.find(s => s.id === id)?.name).join(', ')} (dual: ${isDualBackbone})`);

    // BFS from all roots simultaneously (all roots = depth 0)
    const nodeDepths = {};
    const parentMap = {};
    const childrenMap = {}; // parent → [children] for subtree width calc
    const bfsQueue = [];
    const bfsVisited = new Set();

    for (const rootId of roots) {
        nodeDepths[rootId] = 0;
        bfsQueue.push(rootId);
        bfsVisited.add(rootId);
        childrenMap[rootId] = [];
    }

    while (bfsQueue.length > 0) {
        const current = bfsQueue.shift();
        const depth = nodeDepths[current];

        for (const neighbor of (adjacency[current] || [])) {
            if (!bfsVisited.has(neighbor)) {
                bfsVisited.add(neighbor);
                nodeDepths[neighbor] = depth + 1;
                parentMap[neighbor] = current;
                if (!childrenMap[current]) childrenMap[current] = [];
                childrenMap[current].push(neighbor);
                if (!childrenMap[neighbor]) childrenMap[neighbor] = [];
                bfsQueue.push(neighbor);
            }
        }
    }

    // Disconnected nodes → extra row
    let maxDepth = Object.keys(nodeDepths).length > 0
        ? Math.max(...Object.values(nodeDepths)) : 0;
    for (const id of deviceIds) {
        if (!bfsVisited.has(id)) {
            maxDepth += 1;
            nodeDepths[id] = maxDepth;
            if (!childrenMap[id]) childrenMap[id] = [];
        }
    }

    // Step 5: Calculate proper tree positions using subtree widths
    const NODE_WIDTH = 170;
    const HORIZONTAL_GAP = 40;
    const VERTICAL_SPACING = 180;
    const MIN_NODE_SPACING = NODE_WIDTH + HORIZONTAL_GAP; // 210px

    // Calculate subtree width for each node (leaf = 1 unit)
    const subtreeWidth = {};
    function calcSubtreeWidth(nodeId) {
        if (subtreeWidth[nodeId] !== undefined) return subtreeWidth[nodeId];
        const children = childrenMap[nodeId] || [];
        if (children.length === 0) {
            subtreeWidth[nodeId] = MIN_NODE_SPACING;
            return MIN_NODE_SPACING;
        }
        let total = 0;
        for (const child of children) {
            total += calcSubtreeWidth(child);
        }
        subtreeWidth[nodeId] = Math.max(MIN_NODE_SPACING, total);
        return subtreeWidth[nodeId];
    }

    // Calculate widths for all roots
    for (const rootId of roots) {
        calcSubtreeWidth(rootId);
    }
    // Also calc for disconnected nodes
    for (const id of deviceIds) {
        if (subtreeWidth[id] === undefined) calcSubtreeWidth(id);
    }

    // Assign positions recursively
    const positions = {};

    function assignPositions(nodeId, centerX, depth) {
        positions[nodeId] = {
            x: centerX - NODE_WIDTH / 2,
            y: depth * VERTICAL_SPACING + 50
        };
        const children = childrenMap[nodeId] || [];
        if (children.length === 0) return;

        // Distribute children centered under parent
        let totalChildWidth = 0;
        for (const child of children) {
            totalChildWidth += subtreeWidth[child];
        }

        let currentX = centerX - totalChildWidth / 2;
        for (const child of children) {
            const childWidth = subtreeWidth[child];
            const childCenter = currentX + childWidth / 2;
            assignPositions(child, childCenter, depth + 1);
            currentX += childWidth;
        }
    }

    if (isDualBackbone) {
        // Dual backbone: place side by side at depth 0
        const BB_GAP = 250; // gap between the two BBs
        const leftRoot = roots[0];
        const rightRoot = roots[1];
        const leftWidth = subtreeWidth[leftRoot] || MIN_NODE_SPACING;
        const rightWidth = subtreeWidth[rightRoot] || MIN_NODE_SPACING;
        const totalWidth = leftWidth + BB_GAP + rightWidth;
        const startX = totalWidth / 2; // center offset

        // Left BB: centered over its subtree on the left side
        const leftCenter = startX - leftWidth / 2 - BB_GAP / 2 + NODE_WIDTH / 2;
        // Right BB: centered over its subtree on the right side
        const rightCenter = startX + rightWidth / 2 + BB_GAP / 2 + NODE_WIDTH / 2;

        // Place BB nodes at depth 0
        positions[leftRoot] = { x: leftCenter - NODE_WIDTH / 2, y: 50 };
        positions[rightRoot] = { x: rightCenter - NODE_WIDTH / 2, y: 50 };

        // Assign children for each BB (depth 1+)
        const leftChildren = childrenMap[leftRoot] || [];
        const rightChildren = childrenMap[rightRoot] || [];

        // Left subtree
        if (leftChildren.length > 0) {
            let totalChildWidth = leftChildren.reduce((sum, c) => sum + subtreeWidth[c], 0);
            let currentX = leftCenter - totalChildWidth / 2;
            for (const child of leftChildren) {
                if (child === rightRoot) continue; // skip the other BB
                const childWidth = subtreeWidth[child];
                assignPositions(child, currentX + childWidth / 2, 1);
                currentX += childWidth;
            }
        }

        // Right subtree
        if (rightChildren.length > 0) {
            let totalChildWidth = rightChildren.reduce((sum, c) => sum + subtreeWidth[c], 0);
            let currentX = rightCenter - totalChildWidth / 2;
            for (const child of rightChildren) {
                if (child === leftRoot) continue; // skip the other BB
                const childWidth = subtreeWidth[child];
                assignPositions(child, currentX + childWidth / 2, 1);
                currentX += childWidth;
            }
        }
    } else {
        // Single root: center the whole tree
        const rootId = roots[0];
        const totalWidth = subtreeWidth[rootId] || MIN_NODE_SPACING;
        assignPositions(rootId, totalWidth / 2 + 200, 0);
    }

    // Position disconnected nodes in a row at the bottom
    const disconnected = deviceIds.filter(id => !roots.includes(id) && !parentMap[id] && !bfsVisited.has(id));
    if (disconnected.length > 0) {
        const disconnectedY = (maxDepth + 1) * VERTICAL_SPACING + 50;
        const totalW = (disconnected.length - 1) * MIN_NODE_SPACING;
        const startX = -totalW / 2 + 400;
        disconnected.forEach((id, idx) => {
            positions[id] = { x: startX + idx * MIN_NODE_SPACING, y: disconnectedY };
        });
    }

    // Step 6: Create edges with correct direction
    const newEdges = [];

    // If dual backbone, create edge between the two BBs via side handles
    if (isDualBackbone) {
        const bbEdgeExists = existingEdges.some(e =>
            (e.source === roots[0] && e.target === roots[1]) ||
            (e.source === roots[1] && e.target === roots[0])
        ) || neighborPairs.some(p =>
            (p.a === roots[0] && p.b === roots[1]) ||
            (p.a === roots[1] && p.b === roots[0])
        );

        if (!bbEdgeExists) {
            const bbEdge = {
                id: `e-${roots[0]}-${roots[1]}-${Date.now()}`,
                source: roots[0],
                target: roots[1],
                sourceHandle: 'right',
                targetHandle: 'left'
            };
            newEdges.push(bbEdge);
            store.addEdge(bbEdge);
        }
    }

    for (const pair of neighborPairs) {
        // Skip BB-to-BB pair (already handled above)
        if (isDualBackbone &&
            ((pair.a === roots[0] && pair.b === roots[1]) ||
             (pair.a === roots[1] && pair.b === roots[0]))) {
            continue;
        }

        const depthA = nodeDepths[pair.a] ?? 999;
        const depthB = nodeDepths[pair.b] ?? 999;
        const parentId = depthA <= depthB ? pair.a : pair.b;
        const childId = depthA <= depthB ? pair.b : pair.a;

        // Same-depth connection (e.g. cross-links) → use side handles
        let sourceHandle = 'bottom';
        let targetHandle = 'top';
        if (depthA === depthB) {
            const posA = positions[pair.a];
            const posB = positions[pair.b];
            if (posA && posB) {
                if (posA.x < posB.x) {
                    sourceHandle = 'right';
                    targetHandle = 'left';
                } else {
                    sourceHandle = 'left';
                    targetHandle = 'right';
                }
            }
        }

        const edge = {
            id: `e-${parentId}-${childId}-${Date.now() + newEdges.length}`,
            source: depthA === depthB ? pair.a : parentId,
            target: depthA === depthB ? pair.b : childId,
            sourceHandle,
            targetHandle
        };
        newEdges.push(edge);
        store.addEdge(edge);
    }

    // Fix existing edges: set handles based on tree depth
    const updatedEdges = [];
    for (const e of existingEdges) {
        if (!deviceIds.includes(e.source) || !deviceIds.includes(e.target)) continue;
        const depthS = nodeDepths[e.source] ?? 999;
        const depthT = nodeDepths[e.target] ?? 999;

        // Dual backbone edge — set side handles
        if (isDualBackbone &&
            ((e.source === roots[0] && e.target === roots[1]) ||
             (e.source === roots[1] && e.target === roots[0]))) {
            const leftId = positions[roots[0]]?.x <= positions[roots[1]]?.x ? roots[0] : roots[1];
            const rightId = leftId === roots[0] ? roots[1] : roots[0];
            store.updateEdge(e.id, { source: leftId, target: rightId, sourceHandle: 'right', targetHandle: 'left' });
            updatedEdges.push(e.id);
            continue;
        }

        if (depthS === depthT) {
            // Same depth — side handles
            const posS = positions[e.source];
            const posT = positions[e.target];
            if (posS && posT) {
                const sh = posS.x < posT.x ? 'right' : 'left';
                const th = posS.x < posT.x ? 'left' : 'right';
                store.updateEdge(e.id, { sourceHandle: sh, targetHandle: th });
                updatedEdges.push(e.id);
            }
        } else if (depthS <= depthT) {
            if (e.sourceHandle !== 'bottom' || e.targetHandle !== 'top') {
                store.updateEdge(e.id, { sourceHandle: 'bottom', targetHandle: 'top' });
                updatedEdges.push(e.id);
            }
        } else {
            store.updateEdge(e.id, {
                source: e.target, target: e.source,
                sourceHandle: 'bottom', targetHandle: 'top'
            });
            updatedEdges.push(e.id);
        }
    }

    // Step 7: Update device positions
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
    // 4 hane = kısmi MAC araması (searchMAC alt-dize eşleşmesi yapar)
    if (!query || typeof query !== 'string' || query.trim().length < 4) {
        return res.status(400).json({ error: 'Enter at least 4 characters' });
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

    const allowed = ['sshUsername', 'sshPassword', 'snmpCommunity', 'tags', 'topologyPage', 'type', 'healthIntervalSec', 'ipSlaEnabled', 'ipSlaOkLabel', 'ipSlaFailLabel'];
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
        if (allowed.includes(key)) safeUpdates[key] = updates[key];
    }

    // IP SLA alanları: boolean'a çevir / etiketleri kırp (tek-cihaz sanitizeSwitch ile aynı davranış)
    if (safeUpdates.ipSlaEnabled !== undefined) {
        safeUpdates.ipSlaEnabled = !(safeUpdates.ipSlaEnabled === false || safeUpdates.ipSlaEnabled === 'false');
    }
    for (const k of ['ipSlaOkLabel', 'ipSlaFailLabel']) {
        if (safeUpdates[k] !== undefined) safeUpdates[k] = String(safeUpdates[k]).trim().slice(0, 12);
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

// --- Find Device: verilen IP'lere SSH ile bağlanıp cihaz kimliğini keşfet ---
// Güvenlik notları:
//  * admin-only; limiter ROUTE seviyesinde (global limiter Referer ile atlatılabiliyor)
//  * her IP strict IPv4 + isBlockedIP → SSRF ("localhost", "127.1", "2130706433" gibi
//    formlar isValidHost'u geçtiği için hostname ASLA kabul edilmez)
//  * port sabit 22 (gövdeden port alınsa dahili port tarayıcısına dönerdi)
//  * sınırlı eşzamanlılık; parola asla loglanmaz/yankılanmaz; ham hata mesajı dönmez
const MAX_PROBE_TARGETS = 64;
const PROBE_CONCURRENCY = 8;
// 40 istek × 8 IP = 5dk'da ~320 hedef; tekrar denemelere pay bırakır ama SSH fan-out'u sınırlar
const discoverLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 40, message: 'Too many discovery requests, please wait' });

async function probePool(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = cursor++;
            if (i >= items.length) return;
            results[i] = await worker(items[i]); // worker ASLA reject etmemeli
        }
    });
    await Promise.all(runners);
    return results;
}

router.post('/switches/discover', authenticate, requireAdmin, discoverLimiter, async (req, res) => {
    try {
        const { ips, username, password } = req.body || {};
        // Uzunluk kontrolü İLK: devasa dizi per-item işten önce reddedilsin
        if (!Array.isArray(ips) || ips.length === 0) return res.status(400).json({ error: 'ips array required' });
        if (ips.length > MAX_PROBE_TARGETS) return res.status(400).json({ error: `Maximum ${MAX_PROBE_TARGETS} IPs per request` });
        if (typeof username !== 'string' || !username || username.length > 64) return res.status(400).json({ error: 'Valid username required (max 64)' });
        if (typeof password !== 'string' || !password || password.length > 256) return res.status(400).json({ error: 'Valid password required (max 256)' });

        const targets = [];
        for (const raw of ips) {
            const ip = String(raw || '').trim();
            if (!isValidIPv4(ip) || isBlockedIP(ip)) {
                return res.status(400).json({ error: `Invalid or not allowed IP: ${ip.slice(0, 45)}` });
            }
            if (!targets.includes(ip)) targets.push(ip);
        }

        const results = await probePool(targets, PROBE_CONCURRENCY, async (ip) => {
            const r = await probeDevice(ip, username, password);
            if (r.status !== 'ok' || !r.output) {
                return { ip, status: r.status === 'ok' ? 'error' : r.status };
            }
            const info = identifyFromSsh(r.output, { ip });
            return { ip, status: 'ok', name: info.name, model: info.model, type: info.type, vendor: info.vendor, confidence: info.confidence };
        });

        const found = results.filter(r => r.status === 'ok').length;
        // Parola ASLA loglanmaz — audit_log.json düz metin ve GET /audit ile okunabilir
        await logAction(req.user, 'DEVICE_DISCOVER', `${targets.length} host(s)`, {
            targets, username, found, failed: targets.length - found
        });

        res.json({ results });
    } catch (e) {
        console.error('[DISCOVER] Hata:', e.message);
        res.status(500).json({ error: 'Discovery failed' });
    }
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
    // SNMP'den taze sürüm okunduysa cihaz kaydına yaz (liste sıralaması bu alanı kullanır).
    if (details.version && details.version !== device.version) {
        store.updateSwitch(device.id, { version: details.version });
    }
    details.topologyPage = device.topologyPage || 'main'; // cihazın bulunduğu topoloji sayfası (id)
    // IP SLA rozet etiketleri (OK→birincil, Timeout→yedek). Boşsa varsayılan MD/GSM. Her iki rol görebilir.
    details.ipSlaOkLabel = device.ipSlaOkLabel || 'MD';
    details.ipSlaFailLabel = device.ipSlaFailLabel || 'GSM';
    // Admin can see SNMP community, SSH username, and password status
    if (req.user.role === 'Administrator') {
        details.snmpCommunity = device.snmpCommunity || '';
        details.sshUsername = device.sshUsername || '';
        details.sshPasswordSet = !!(device.sshPassword && device.sshPassword.length > 0);
        details.model = device.model || '';
    }
    res.json(details);
});

// IP SLA oku: önce SNMP (CISCO-RTTMON-MIB); boşsa ve SSH bilgisi varsa "show ip sla summary" SSH fallback.
// (IE4010 gibi RTTMON MIB'i yayınlamayan cihazlar SNMP'de boş döner ama CLI'da IP SLA çalışır)
async function readIpSla(device) {
    // ipSlaEnabled açıkça false ise atla (tanımsız/true → açık; varsayılan açık)
    if (!device || device.status !== 'UP' || device.ipSlaEnabled === false) return [];
    let list = await ipSlaStatus(device);
    if ((!list || list.length === 0) && device.sshUsername && device.sshPassword) {
        list = await ipSlaViaSsh(device);
    }
    return list || [];
}

// IP SLA durumu — her iki rol; cihazda IP SLA yoksa [] döner
router.get('/switches/:id/ip-sla', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    try {
        const cacheKey = `ipsla:${device.id}`;
        const cached = snmpCache.get(cacheKey);
        if (cached) return res.json(cached);
        const list = await readIpSla(device);
        snmpCache.set(cacheKey, list, 15000); // 15 sn kısa cache (poll yükünü sınırla)
        res.json(list);
    } catch (e) {
        console.error('[IP-SLA] Hata:', e.message);
        res.status(500).json({ error: 'IP SLA read failed' });
    }
});

// Ping geçmişi. Birleşik nokta şekli döner: { mode, bucketMs, rangeMs, points:[{t,avg,min,max,up,down}] }
//  - 1H (veya eski ?duration=): ham 5sn örnekler (avg=min=max=latency, down=0/1)
//  - 1D/1W/1M: ham seri yalnızca ~7 saat tuttuğundan 5dk özet (rollup) serisinden servis edilir
router.get('/switches/:id/ping-history', authenticate, (req, res) => {
    const RANGE_MS = { '1H': 3600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000 };
    const range = String(req.query.range || '');

    // Ham seri ~7 saati kapsadığından 24 saat ve üzeri aralıklar rollup'tan gelir (1D=288 kova).
    if (range === '1D' || range === '1W' || range === '1M') {
        const rangeMs = RANGE_MS[range];
        const buckets = store.getRollup(req.params.id, Date.now() - rangeMs);
        return res.json({ mode: 'rollup', bucketMs: store.ROLLUP_BUCKET_MS, rangeMs, points: buckets });
    }

    const durationParam = parseInt(req.query.duration);
    const rangeMs = RANGE_MS[range] || (durationParam > 0 ? durationParam : 3600000);
    const raw = store.getHistory(req.params.id, Date.now() - rangeMs);
    const points = raw.map(h => {
        const isDown = h.value === -1;
        const v = isDown ? null : h.value;
        return { t: h.timestamp, avg: v, min: v, max: v, up: isDown ? 0 : 1, down: isDown ? 1 : 0 };
    });
    res.json({ mode: 'raw', bucketMs: 0, rangeMs, points });
});

// --- Config Backup (yalnızca admin) ---
// Liste: son 7 yedeğin metadata'sı (yeni -> eski), config gövdesi olmadan
router.get('/switches/:id/config-backups', authenticate, requireAdmin, (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(listBackups(device.id));
});

// Tek yedeğin tam içeriği (görüntüleme/indirme)
router.get('/switches/:id/config-backups/:timestamp', authenticate, requireAdmin, (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const b = getBackup(device.id, req.params.timestamp);
    if (!b) return res.status(404).json({ error: 'Backup not found' });
    res.json(b);
});

// Manuel yedek al (kart üzerindeki "Şimdi yedekle" butonu)
router.post('/switches/:id/config-backups/run', authenticate, requireAdmin, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (!device.sshUsername || !device.sshPassword) return res.status(400).json({ error: 'SSH credentials missing' });
    if (isBlockedIP(device.ip)) return res.status(403).json({ error: 'Connection to this IP is not allowed' });
    try {
        const ok = await backupDevice(device);
        if (!ok) return res.status(502).json({ error: 'Backup failed (SSH error or empty config)' });
        res.json({ success: true, backups: listBackups(device.id) });
    } catch (e) {
        res.status(500).json({ error: 'Backup failed' });
    }
});

// Importable Backup: cihazin gercek running-config'inden yeni switch'e yapistirilabilir sablon
router.get('/switches/:id/importable-config', authenticate, requireAdmin, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    try {
        const result = await getImportableConfig(device);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to build importable config' });
    }
});

// --- Toplu komut gonderme (Command-line sayfasi) — job + polling ile canli akis ---
// Yikici komutlar her iki modda da reddedilir (birden cok cihaza yanlislikla calistirmayi onler).
const BULK_DENY = [
    /\breload\b/i, /\berase\b/i, /\bwrite\s+erase\b/i, /\bwr\s+er/i, /\bdelete\b/i,
    /\bformat\b/i, /\bboot\s+system\b/i, /\bconfig-register\b/i, /\bno\s+username\b/i,
];
const BULK_SHOW_REDIRECT = ['redirect', 'tee', 'tftp:', 'ftp:', 'scp:', 'http:', '>'];
const BULK_CONCURRENCY = 8;

// Toplu is kayitlari — sonuclar cihaz tamamlandikca doldurulur; frontend GET ile polling yapar (canli akis).
const bulkJobs = new Map(); // jobId -> { mode, total, completed, results, done, startedAt, expiresAt, owner }
const BULK_JOB_TTL_MS = 10 * 60 * 1000;
function newBulkJobId() { return 'blk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function cleanupBulkJobs() { const now = Date.now(); for (const [id, j] of bulkJobs) { if (j.expiresAt && j.expiresAt < now) bulkJobs.delete(id); } }
function summarizeJob(job) {
    const ok = job.results.filter(r => r.ok).length;
    const failed = job.results.filter(r => r.status !== 'pending' && !r.ok).length;
    return { mode: job.mode, total: job.total, completed: job.completed, ok, failed, done: job.done, results: job.results };
}

// requireAdmin: cihazlarda serbest/konfig komut calistirir — yalnizca yonetici.
// Is'i olusturup HEMEN jobId doner; komutlar arkaplanda calisir, sonuclar polling ile alinir.
router.post('/switches/bulk-exec', authenticate, requireAdmin, async (req, res) => {
    cleanupBulkJobs();
    const { ids, commands, mode, saveAfter } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No devices selected' });
    if (ids.length > 300) return res.status(400).json({ error: 'Too many devices (max 300)' });
    if (mode !== 'show' && mode !== 'config') return res.status(400).json({ error: 'Invalid mode' });
    if (typeof commands !== 'string' || !commands.trim()) return res.status(400).json({ error: 'No commands provided' });
    if (commands.length > 6000) return res.status(400).json({ error: 'Command text too long (max 6000 chars)' });

    const lines = commands.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'No commands provided' });
    if (lines.length > 200) return res.status(400).json({ error: 'Too many command lines (max 200)' });

    // Guvenlik dogrulamasi (satir bazli)
    for (const line of lines) {
        if (/[`]/.test(line) || /\$\(/.test(line)) return res.status(403).json({ error: `Blocked characters in: "${line}"` });
        if (BULK_DENY.some(re => re.test(line))) return res.status(403).json({ error: `Destructive command blocked: "${line}"` });
        if (mode === 'show') {
            const lc = line.toLowerCase();
            if (!(lc.startsWith('show ') || lc.startsWith('display '))) return res.status(403).json({ error: `Read-only mode allows only show/display: "${line}"` });
            if (BULK_SHOW_REDIRECT.some(b => lc.includes(b))) return res.status(403).json({ error: `Output redirection not allowed: "${line}"` });
        }
    }

    // Hedef cihazlari cozumle; calistirilamayanlari (SSH yok / engelli / bulunamadi) ayir
    const targets = [];
    const skipped = [];
    for (const id of ids) {
        const d = store.getSwitch(id);
        if (!d) { skipped.push({ id: String(id), name: String(id), ok: false, error: 'Device not found', status: 'skipped' }); continue; }
        if (!d.sshUsername || !d.sshPassword) { skipped.push({ id: d.id, name: d.name, ip: d.ip, ok: false, error: 'SSH credentials missing', status: 'skipped' }); continue; }
        if (isBlockedIP(d.ip)) { skipped.push({ id: d.id, name: d.name, ip: d.ip, ok: false, error: 'Connection to this IP is not allowed', status: 'skipped' }); continue; }
        targets.push(d);
    }
    if (targets.length === 0) return res.status(400).json({ error: 'No runnable devices (missing SSH credentials?)', results: skipped });

    const doSave = mode === 'config' && !!saveAfter;
    await logAction(req.user, 'BULK_EXEC', `${mode}${doSave ? '+save' : ''} on ${targets.length} device(s)`, { mode, count: targets.length, lines: lines.length, save: doSave, sample: lines.slice(0, 3) });

    // Is olustur: hedefler 'pending', atlananlar 'skipped'. Hedefler results[] icinde ilk sirada.
    const jobId = newBulkJobId();
    const results = [
        ...targets.map(d => ({ id: d.id, name: d.name, ip: d.ip, status: 'pending' })),
        ...skipped
    ];
    const job = { mode, total: results.length, completed: skipped.length, results, done: false, startedAt: Date.now(), expiresAt: 0, owner: req.user && req.user.username };
    bulkJobs.set(jobId, job);

    // Arkaplan havuzu — response'tan SONRA calisir; job.results tamamlandikca guncellenir
    const timeoutMs = mode === 'config' ? 30000 : 15000;
    (async () => {
        let idx = 0;
        await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, targets.length) }, async () => {
            while (idx < targets.length) {
                const my = idx++;
                const d = targets[my];
                const t0 = Date.now();
                try {
                    const output = await runCommands(d, lines, { config: mode === 'config', save: doSave, timeoutMs });
                    job.results[my] = { id: d.id, name: d.name, ip: d.ip, ok: true, durationMs: Date.now() - t0, output: String(output || '').replace(/\r/g, '').trim(), status: 'done' };
                } catch (e) {
                    job.results[my] = { id: d.id, name: d.name, ip: d.ip, ok: false, durationMs: Date.now() - t0, error: e.message || 'SSH error', status: 'done' };
                }
                job.completed++;
            }
        }));
        job.done = true;
        job.expiresAt = Date.now() + BULK_JOB_TTL_MS;
    })().catch((err) => { job.done = true; job.error = err.message; job.expiresAt = Date.now() + BULK_JOB_TTL_MS; });

    res.json({ jobId, ...summarizeJob(job) });
});

// Is durumu (canli akis): sonuclar cihaz tamamlandikca dolar, done=true olunca biter
router.get('/switches/bulk-exec/:jobId', authenticate, requireAdmin, (req, res) => {
    const job = bulkJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found or expired' });
    res.json({ jobId: req.params.jobId, ...summarizeJob(job) });
});

// SSH komutu çalıştır (show run vb.)
// requireAdmin: bu rota cihazda komut çalıştırır (running-config dahil) — User rolü
// SSH'ta whitelist'e kısıtlıyken buradan serbest komut çalıştırabilmemeli.
router.post('/switches/:id/exec', authenticate, requireAdmin, async (req, res) => {
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
        const execPw = decryptPassword(device.sshPassword);
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
            }).on('keyboard-interactive', kbAuth(execPw)).connect({
                host: device.ip, port: 22,
                username: device.sshUsername,
                password: execPw,
                tryKeyboard: true,   // Nexus/NX-OS keyboard-interactive icin
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

router.get('/switches/export/csv', authenticate, requireAdmin, (req, res) => {
    const switches = store.getSwitches();
    const headers = ['Name', 'IP', 'Type', 'Status', 'Latency', 'Model', 'Tags'];
    const rows = switches.map(s => [
        s.name, s.ip, s.type || 'switch', s.status, s.latency, s.model || '', (s.tags || []).join(';')
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=devices.csv');
    res.send('﻿' + csv); // UTF-8 BOM → Excel'de Türkçe karakter bozulmaz
});

// --- Detaylı envanter (Detailed List): her cihazdan SNMP ile serial/model/version topla ---
// Aktif olarak tüm cihazlara SNMP atar → admin-only + kendi rate limiter'ı.
const detailedExportLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10, message: 'Too many export requests, please wait' });
router.get('/switches/export/detailed', authenticate, requireAdmin, detailedExportLimiter, async (req, res) => {
    try {
        const rows = await inventoryAll(store.getSwitches());
        // Topoloji sayfası id → okunur ad
        const pageName = (id) => store.getTopoTabs().find(t => t.id === (id || 'main'))?.name || (id || 'main');
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const headers = ['Device Name', 'Type', 'Manufacturer', 'Model', 'Serial Number', 'Image Version', 'LAN IP', 'Topology Page'];
        const csv = [
            headers.join(','),
            ...rows.map(r => [r.name, r.type, r.manufacturer, r.model, r.serial, r.version, r.ip, pageName(r.topologyPage)].map(esc).join(','))
        ].join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=devices-detailed.csv');
        res.send('﻿' + csv);
    } catch (e) {
        console.error('[EXPORT-DETAILED] Hata:', e.message);
        res.status(500).json({ error: 'Detailed export failed' });
    }
});

// --- Arayüz (interface) yapılandırma — cihaz detayındaki "Config" butonu ---
// Komutlar SUNUCUDA doğrulanmış girdilerden (mode + VLAN id'leri) üretilir; serbest komut yok.
// Bu yüzden admin dışı roller de kullanabilir (yalnızca authenticate). Yıkıcı/serbest giriş imkânsız.
const IFNAME_RE = /^[A-Za-z][A-Za-z0-9./_-]{1,40}$/;      // GigabitEthernet1/0/1, Fa1/5, Po1 ...
const VLAN_OK = (v) => Number.isInteger(v) && v >= 1 && v <= 4094;

function parseVlanBrief(text) {
    const out = [];
    const seen = new Set();
    for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
        // "10   MGMT     active   Gi1/0/1, ..." → id + ad (status act/sus ile başlar)
        const m = line.match(/^\s*(\d{1,4})\s+(\S+)\s+(act|sus)/i);
        if (!m) continue;
        const id = parseInt(m[1], 10);
        if (!VLAN_OK(id) || (id >= 1002 && id <= 1005) || seen.has(id)) continue; // 1002-1005 varsayılan fddi/token
        seen.add(id);
        out.push({ id, name: m[2] });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
}

// VLAN listesi (dropdown'lar için) — "show vlan brief"
router.get('/switches/:id/vlans', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (!device.sshUsername || !device.sshPassword) return res.status(400).json({ error: 'SSH credentials missing' });
    if (isBlockedIP(device.ip)) return res.status(403).json({ error: 'Connection to this IP is not allowed' });
    try {
        const raw = await runShowCommand(device, 'show vlan brief');
        res.json({ vlans: parseVlanBrief(raw) });
    } catch (e) {
        res.status(500).json({ error: 'SSH error: ' + (e.message || 'failed') });
    }
});

// Arayüzün mevcut ayarları — "show running-config interface <name>" (sol taraf)
router.get('/switches/:id/interface-config', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const name = String(req.query.name || '').trim();
    if (!IFNAME_RE.test(name)) return res.status(400).json({ error: 'Invalid interface name' });
    if (!device.sshUsername || !device.sshPassword) return res.status(400).json({ error: 'SSH credentials missing' });
    if (isBlockedIP(device.ip)) return res.status(403).json({ error: 'Connection to this IP is not allowed' });
    try {
        const raw = await runShowCommand(device, `show running-config interface ${name}`);
        const clean = String(raw || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
            .split('\n').filter(l => !/terminal length 0/.test(l)).join('\n').trim();
        res.json({ output: clean });
    } catch (e) {
        res.status(500).json({ error: 'SSH error: ' + (e.message || 'failed') });
    }
});

// Arayüz ayarını uygula — mode (access/trunk) + VLAN'lar. Komutlar burada üretilir (sağ taraf).
router.post('/switches/:id/interface-config', authenticate, async (req, res) => {
    const device = store.getSwitch(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (!device.sshUsername || !device.sshPassword) return res.status(400).json({ error: 'SSH credentials missing' });
    if (isBlockedIP(device.ip)) return res.status(403).json({ error: 'Connection to this IP is not allowed' });

    const { name, mode } = req.body || {};
    const ifName = String(name || '').trim();
    if (!IFNAME_RE.test(ifName)) return res.status(400).json({ error: 'Invalid interface name' });
    if (mode !== 'access' && mode !== 'trunk') return res.status(400).json({ error: 'Invalid mode' });

    const cmds = [`interface ${ifName}`];
    if (mode === 'access') {
        // Önce moda geç, SONRA trunk kalıntı komutlarını sil (aksi halde access portta trunk satırları kalır)
        cmds.push('switchport mode access');
        cmds.push('no switchport trunk allowed vlan');
        cmds.push('no switchport trunk native vlan');
        cmds.push('no switchport trunk encapsulation'); // yapılandırılabilir platformlarda temizler; fixed'de zararsız hata
        if (req.body.accessVlan != null && req.body.accessVlan !== '') {
            const v = parseInt(req.body.accessVlan, 10);
            if (!VLAN_OK(v)) return res.status(400).json({ error: 'Invalid access VLAN' });
            cmds.push(`switchport access vlan ${v}`);
        }
    } else {
        // Access kalıntısını sil, sonra trunk'a geç
        cmds.push('no switchport access vlan');
        cmds.push('switchport trunk encapsulation dot1q'); // bazı platformlarda gerekli; desteklemeyende zararsız hata
        cmds.push('switchport mode trunk');
        if (req.body.nativeVlan != null && req.body.nativeVlan !== '') {
            const nv = parseInt(req.body.nativeVlan, 10);
            if (!VLAN_OK(nv)) return res.status(400).json({ error: 'Invalid native VLAN' });
            cmds.push(`switchport trunk native vlan ${nv}`);
        }
        // Dizi geldiyse açık liste ayarla (boş dizi = none). Hiç gelmediyse (undefined) dokunma
        // → cihazdaki mevcut "hepsi izinli" (allowed vlan satırı yok) korunur.
        const allowed = Array.isArray(req.body.allowedVlans) ? req.body.allowedVlans.map(x => parseInt(x, 10)) : null;
        if (allowed) {
            if (!allowed.every(VLAN_OK)) return res.status(400).json({ error: 'Invalid allowed VLAN' });
            if (allowed.length) {
                const uniq = [...new Set(allowed)].sort((a, b) => a - b);
                cmds.push(`switchport trunk allowed vlan ${uniq.join(',')}`);
            } else {
                cmds.push('switchport trunk allowed vlan none');
            }
        }
    }

    // Mod'dan bağımsız: admin durumu (shutdown/no shutdown) ve PoE (power inline auto/never).
    // Frontend bunları yalnızca değiştiyse gönderir → PoE olmayan portta gereksiz hata olmaz.
    if (typeof req.body.shutdown === 'boolean') cmds.push(req.body.shutdown ? 'shutdown' : 'no shutdown');
    if (req.body.powerInline === 'auto' || req.body.powerInline === 'never') cmds.push(`power inline ${req.body.powerInline}`);

    try {
        const output = await runCommands(device, cmds, { config: true, save: !!req.body.save });
        const clean = String(output || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trim();
        await logAction(req.user, 'IFACE_CONFIG', `${device.name} ${ifName}`, { mode, save: !!req.body.save, cmds });
        res.json({ ok: true, commands: cmds, output: clean });
    } catch (e) {
        res.status(500).json({ error: 'SSH error: ' + (e.message || 'failed') });
    }
});

module.exports = router;
