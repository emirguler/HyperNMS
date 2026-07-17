const express = require('express');
const store = require('../utils/memoryStore');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateSwitch, sanitizeSwitch, isBlockedIP, isValidIPv4 } = require('../utils/validation');
const { encryptPassword, decryptPassword } = require('../utils/crypto');
const { getDeviceDetails, discoverNeighbors, searchMAC } = require('../services/snmpService');
const { probeDevice } = require('../services/sshService');
const { identifyFromSsh } = require('../utils/sshIdentify');
const { logAction } = require('../services/auditLog');
const { snmpCache } = require('../utils/cache');
const rateLimiter = require('../middleware/rateLimiter');
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
