const snmp = require('net-snmp');

const TRAFFIC_CACHE = {};
const SMOOTHING_FACTOR = 0.3;

function bufferToBigInt(buffer) {
    if (!Buffer.isBuffer(buffer)) return BigInt(buffer);
    let value = BigInt(0);
    for (const byte of buffer) {
        value = (value << BigInt(8)) + BigInt(byte);
    }
    return value;
}

function getVendorConfig(sysDescr) {
    const desc = sysDescr.toLowerCase();
    let config = { vendor: 'Generic', cpuOid: null };

    if (desc.includes('cisco')) {
        config.vendor = 'Cisco';
        config.cpuOid = '1.3.6.1.4.1.9.2.1.58.0';
    } else if (desc.includes('huawei')) {
        config.vendor = 'Huawei';
        config.cpuOid = '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.1';
    } else if (desc.includes('procurve') || desc.includes('hp') || desc.includes('aruba')) {
        config.vendor = 'HP/Aruba';
        config.cpuOid = '1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0';
    } else if (desc.includes('juniper')) {
        config.vendor = 'Juniper';
        config.cpuOid = '1.3.6.1.4.1.2636.3.1.13.1.8.9.1.0.0';
    } else if (desc.includes('fortinet')) {
        config.vendor = 'Fortinet';
        config.cpuOid = '1.3.6.1.4.1.12356.101.4.1.3.0';
    } else if (desc.includes('linux')) {
        config.vendor = 'Linux Server';
        config.cpuOid = '1.3.6.1.4.1.2021.10.1.3.1';
    }

    return config;
}

function formatUptime(ticks) {
    if (!ticks) return '';
    let seconds = Math.floor(ticks / 100);
    const days = Math.floor(seconds / (3600 * 24));
    seconds -= days * 3600 * 24;
    const hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;
    const minutes = Math.floor(seconds / 60);

    let result = [];
    if (days > 0) result.push(`${days} Days`);
    if (hours > 0) result.push(`${hours} Hours`);
    if (minutes > 0) result.push(`${minutes} Mins`);

    return result.join(', ') || 'Just Started';
}

function createSnmpSession(ip, community, port, version, v3Options) {
    if (version === 'v3' && v3Options) {
        // SNMPv3 — authPriv desteği
        const secLevel = v3Options.securityLevel || 'authPriv';
        const authProto = v3Options.authProtocol === 'SHA' ? snmp.AuthProtocols.sha : snmp.AuthProtocols.md5;
        const privProto = v3Options.privProtocol === 'AES' ? snmp.PrivProtocols.aes : snmp.PrivProtocols.des;

        const user = {
            name: v3Options.securityName || community,
            level: secLevel === 'authPriv' ? snmp.SecurityLevel.authPriv
                 : secLevel === 'authNoPriv' ? snmp.SecurityLevel.authNoPriv
                 : snmp.SecurityLevel.noAuthNoPriv,
            authProtocol: authProto,
            authKey: v3Options.authKey || '',
            privProtocol: privProto,
            privKey: v3Options.privKey || ''
        };

        return snmp.createV3Session(ip, user, {
            port: port || 161,
            timeout: 5000,
            retries: 1
        });
    }

    // SNMPv2c (varsayılan)
    return snmp.createSession(ip, community, {
        port: port || 161,
        version: snmp.Version2c,
        timeout: 5000,
        retries: 1
    });
}

async function getDeviceDetails(device) {
    const { sshPassword, sshUsername, snmpCommunity, ...safeDevice } = device;
    let responseData = {
        ...safeDevice, interfaces: [], snmpHostname: null, uptime: null,
        cpu: 0, ram: 0, detectedVendor: 'Unknown'
    };

    if (device.status !== 'UP' || !device.snmpCommunity) {
        return responseData;
    }

    try {
        const session = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);

        const getScalar = (oids) => new Promise((resolve) => {
            session.get(oids, (err, varbinds) => {
                if (err) resolve(null); else resolve(varbinds);
            });
        });

        const getSubtree = (oid) => new Promise((resolve) => {
            const results = [];
            session.subtree(oid, 20, (varbinds) => {
                for (const vb of varbinds) results.push(vb);
            }, (err) => resolve(results));
        });

        // 1. Temel bilgiler
        const baseOids = [
            '1.3.6.1.2.1.1.5.0', // Hostname
            '1.3.6.1.2.1.1.3.0', // Uptime
            '1.3.6.1.2.1.1.1.0'  // sysDescr
        ];

        const baseData = await getScalar(baseOids);
        let vendorConfig = { cpuOid: null };

        if (baseData) {
            if (!snmp.isVarbindError(baseData[0])) responseData.snmpHostname = baseData[0].value.toString();
            if (!snmp.isVarbindError(baseData[1])) responseData.uptime = formatUptime(baseData[1].value);
            if (!snmp.isVarbindError(baseData[2])) {
                const sysDescr = baseData[2].value.toString();
                vendorConfig = getVendorConfig(sysDescr);
                responseData.detectedVendor = vendorConfig.vendor;
            }
        }

        // 2. CPU
        if (vendorConfig.cpuOid) {
            const cpuData = await getScalar([vendorConfig.cpuOid]);
            if (cpuData && !snmp.isVarbindError(cpuData[0])) {
                responseData.cpu = cpuData[0].value;
            }
        }

        // 3. Interface status
        const oldTableData = await getSubtree('1.3.6.1.2.1.2.2.1.8');
        const statusMap = {};
        oldTableData.forEach(vb => {
            const index = vb.oid.split('.').pop();
            statusMap[index] = vb.value === 1 ? 'up' : 'down';
        });

        // 4. ifXTable (64-bit counters)
        const newTableData = await getSubtree('1.3.6.1.2.1.31.1.1.1');
        const interfacesMap = {};

        // VLAN
        let vlanMap = {};
        let vlanNameMap = {};
        const parseSnmpInt = (val) => {
            if (Buffer.isBuffer(val)) return val.length > 0 ? val.readUIntBE(0, val.length) : 0;
            return parseInt(val);
        };

        if (responseData.detectedVendor === 'Cisco') {
            try {
                // 0. Bridge port → ifIndex mapping
                // dot1qPvid ve diğer BRIDGE-MIB OID'leri bridge port index kullanır, ifIndex değil
                // OID: 1.3.6.1.2.1.17.1.4.1.2 (dot1dBasePortIfIndex)
                const bridgeToIf = {};  // bridgePort → ifIndex
                const ifToBridge = {};  // ifIndex → bridgePort
                const bridgeData = await getSubtree('1.3.6.1.2.1.17.1.4.1.2');
                bridgeData.forEach(vb => {
                    const bridgePort = vb.oid.split('.').pop();
                    const ifIdx = parseSnmpInt(vb.value).toString();
                    bridgeToIf[bridgePort] = ifIdx;
                    ifToBridge[ifIdx] = bridgePort;
                });

                // 1. Trunk portları tespit et (ifIndex bazlı)
                const trunkPorts = new Set();
                const trunkModeData = await getSubtree('1.3.6.1.4.1.9.9.46.1.6.1.1.14');
                trunkModeData.forEach(vb => {
                    const ifIdx = vb.oid.split('.').pop();
                    const mode = parseSnmpInt(vb.value);
                    if (mode === 1 || mode === 5) trunkPorts.add(ifIdx);
                });

                // 2. Access VLAN (vmVlan — ifIndex bazlı)
                const accessVlanData = await getSubtree('1.3.6.1.4.1.9.9.68.1.2.2.1.2');
                accessVlanData.forEach(vb => {
                    const ifIdx = vb.oid.split('.').pop();
                    const val = parseSnmpInt(vb.value);
                    if (val > 0 && !trunkPorts.has(ifIdx)) {
                        vlanMap[ifIdx] = val.toString();
                    }
                });

                // 3. Dinamik VLAN tespiti (vmVlanType — ifIndex bazlı)
                const dynamicPorts = new Set();
                const vlanTypeData = await getSubtree('1.3.6.1.4.1.9.9.68.1.2.2.1.1');
                vlanTypeData.forEach(vb => {
                    const ifIdx = vb.oid.split('.').pop();
                    const vtype = parseSnmpInt(vb.value);
                    if (vtype === 2 || vtype === 3) dynamicPorts.add(ifIdx);
                });

                // 4. dot1qPvid — bridge port index bazlı → ifIndex'e çevir
                const pvidData = await getSubtree('1.3.6.1.2.1.17.7.1.4.5.1.1');
                pvidData.forEach(vb => {
                    const bridgePort = vb.oid.split('.').pop();
                    const ifIdx = bridgeToIf[bridgePort] || bridgePort;
                    const val = parseSnmpInt(vb.value);
                    if (val > 0) {
                        if (dynamicPorts.has(ifIdx)) {
                            vlanMap[ifIdx] = val.toString() + ' (D)';
                        } else if (!vlanMap[ifIdx]) {
                            vlanMap[ifIdx] = val.toString();
                        }
                    }
                });

                // 5. Trunk native VLAN (ifIndex bazlı)
                const trunkVlanData = await getSubtree('1.3.6.1.4.1.9.9.46.1.6.1.1.5');
                trunkVlanData.forEach(vb => {
                    const ifIdx = vb.oid.split('.').pop();
                    const val = parseSnmpInt(vb.value);
                    if (val > 0 && trunkPorts.has(ifIdx)) {
                        vlanMap[ifIdx] = val.toString() + ' (T)';
                    }
                });

                // 6. VLAN isimleri (vtpVlanName)
                const vlanNameData = await getSubtree('1.3.6.1.4.1.9.9.46.1.3.1.1.4');
                vlanNameData.forEach(vb => {
                    const vlanId = vb.oid.split('.').pop();
                    const name = vb.value.toString();
                    if (name && vlanId) vlanNameMap[vlanId] = name;
                });

                console.log(`[VLAN] ${device.ip}: bridge ports=${Object.keys(bridgeToIf).length}, vlans found=${Object.keys(vlanMap).length}, trunk=${trunkPorts.size}, dynamic=${dynamicPorts.size}`);
            } catch (err) {
                console.log("[VLAN] Hata:", err.message);
            }
        }

        newTableData.forEach(vb => {
            if (snmp.isVarbindError(vb)) return;
            const oidParts = vb.oid.split('.');
            const index = oidParts.pop();
            const column = oidParts.pop();

            if (!interfacesMap[index]) {
                const vlanStr = vlanMap[index] || '-';
                const vlanId = vlanStr.replace(/\s*\(T\)/, '');
                interfacesMap[index] = {
                    index, name: '', status: statusMap[index] || 'down',
                    vlan: vlanStr,
                    vlanName: vlanNameMap[vlanId] || '-',
                    speedMbps: 0,
                    rawIn: BigInt(0), rawOut: BigInt(0)
                };
            }

            if (column === '1') interfacesMap[index].name = vb.value.toString();
            else if (column === '15') interfacesMap[index].speedMbps = vb.value;
            else if (column === '6') interfacesMap[index].rawIn = bufferToBigInt(vb.value);
            else if (column === '10') interfacesMap[index].rawOut = bufferToBigInt(vb.value);
        });

        session.close();

        // 5. Trafik hesaplama
        const now = Date.now();
        const deviceCache = TRAFFIC_CACHE[device.id] || {};

        responseData.interfaces = Object.values(interfacesMap)
            .filter(i => {
                const nameLower = i.name.toLowerCase();
                return !nameLower.includes('vlan') && !nameLower.includes('null') && !nameLower.includes('loopback')
                    && !nameLower.startsWith('nu') && !nameLower.startsWith('bl');
            })
            .map(i => {
                let currentBpsIn = 0, currentBpsOut = 0;
                const prev = deviceCache[i.index];

                if (prev) {
                    const timeDiff = (now - prev.timestamp) / 1000;
                    if (timeDiff > 0) {
                        if (i.rawIn >= prev.rawIn) currentBpsIn = Number((i.rawIn - prev.rawIn) * BigInt(8)) / timeDiff;
                        if (i.rawOut >= prev.rawOut) currentBpsOut = Number((i.rawOut - prev.rawOut) * BigInt(8)) / timeDiff;
                    }
                }

                let smoothedIn = currentBpsIn, smoothedOut = currentBpsOut;
                if (prev && prev.lastSmoothedIn !== undefined) {
                    smoothedIn = (currentBpsIn * SMOOTHING_FACTOR) + (prev.lastSmoothedIn * (1 - SMOOTHING_FACTOR));
                    smoothedOut = (currentBpsOut * SMOOTHING_FACTOR) + (prev.lastSmoothedOut * (1 - SMOOTHING_FACTOR));
                }

                deviceCache[i.index] = {
                    timestamp: now, rawIn: i.rawIn, rawOut: i.rawOut,
                    lastSmoothedIn: smoothedIn, lastSmoothedOut: smoothedOut
                };

                return {
                    index: i.index, name: i.name, status: i.status, vlan: i.vlan, vlanName: i.vlanName,
                    speed: i.speedMbps * 1000000, trafficIn: smoothedIn, trafficOut: smoothedOut
                };
            });

        responseData.interfaces.sort((a, b) => parseInt(a.index) - parseInt(b.index));
        TRAFFIC_CACHE[device.id] = deviceCache;

        // 6. RAM
        try {
            const ramSession = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
            const hrStorageData = await new Promise((resolve) => {
                const results = [];
                ramSession.subtree('1.3.6.1.2.1.25.2.3.1', 20, (varbinds) => {
                    for (const vb of varbinds) results.push(vb);
                }, () => resolve(results));
            });

            const storageEntries = {};
            hrStorageData.forEach(vb => {
                const oidParts = vb.oid.split('.');
                const index = oidParts.pop();
                const column = oidParts.pop();
                if (!storageEntries[index]) storageEntries[index] = {};
                storageEntries[index][column] = vb.value;
            });

            let totalRam = 0, usedRam = 0;
            for (const entry of Object.values(storageEntries)) {
                const typeOid = entry['2'] ? entry['2'].toString() : '';
                if (typeOid.includes('1.3.6.1.2.1.25.2.1.2')) {
                    const blockSize = parseInt(entry['4']) || 1;
                    const totalBlocks = parseInt(entry['5']) || 0;
                    const usedBlocks = parseInt(entry['6']) || 0;
                    totalRam += totalBlocks * blockSize;
                    usedRam += usedBlocks * blockSize;
                }
            }

            if (totalRam > 0) {
                responseData.ram = Math.round((usedRam / totalRam) * 100);
            } else if (responseData.detectedVendor === 'Cisco') {
                const ciscoMemSession = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
                const memOids = ['1.3.6.1.4.1.9.9.48.1.1.1.5.1', '1.3.6.1.4.1.9.9.48.1.1.1.6.1'];
                const memData = await new Promise((resolve) => {
                    ciscoMemSession.get(memOids, (err, varbinds) => {
                        if (err) resolve(null); else resolve(varbinds);
                    });
                });
                if (memData && !snmp.isVarbindError(memData[0]) && !snmp.isVarbindError(memData[1])) {
                    const used = parseInt(memData[0].value);
                    const free = parseInt(memData[1].value);
                    if (used + free > 0) responseData.ram = Math.round((used / (used + free)) * 100);
                }
                ciscoMemSession.close();
            }
            ramSession.close();
        } catch (ramErr) {
            responseData.ram = 0;
        }

        return responseData;
    } catch (e) {
        console.error("[SNMP] Kritik Hata:", e);
        return responseData;
    }
}

module.exports = { getDeviceDetails, getVendorConfig };
