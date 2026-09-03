const snmp = require('net-snmp');
const { snmpCache } = require('../utils/cache');

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
    let config = { vendor: 'Generic', cpuOid: null, cpuOidFallback: null, isNexus: false };

    if (desc.includes('cisco')) {
        config.vendor = 'Cisco';
        if (desc.includes('nx-os') || desc.includes('nexus')) {
            // Nexus uses CISCO-PROCESS-MIB (cpmCPUTotal5minRev)
            config.cpuOid = '1.3.6.1.4.1.9.9.109.1.1.1.1.8.1';
            config.cpuOidFallback = '1.3.6.1.4.1.9.9.109.1.1.1.1.5.1'; // cpmCPUTotal5min (older)
            config.isNexus = true;
        } else {
            // Catalyst / IOS — OLD-CISCO-CPU-MIB, fallback to CISCO-PROCESS-MIB
            config.cpuOid = '1.3.6.1.4.1.9.2.1.58.0';
            config.cpuOidFallback = '1.3.6.1.4.1.9.9.109.1.1.1.1.8.1';
        }
    } else if (desc.includes('huawei')) {
        config.vendor = 'Huawei';
        config.cpuOid = '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.1';
    } else if (desc.includes('arubaos-cx') || desc.includes('aruba cx')) {
        // ArubaOS-CX (newer CX series: 6x00, 83xx, etc.)
        config.vendor = 'Aruba';
        config.cpuOid = '1.3.6.1.4.1.47196.4.1.1.3.11.2.1.1.6.0'; // arubaWiredSystemCPUUtil
        config.cpuOidFallback = '1.3.6.1.4.1.47196.4.1.1.3.11.2.1.1.6.1';
        config.isArubaCX = true;
    } else if (desc.includes('procurve') || desc.includes('hp') || desc.includes('aruba')) {
        // ArubaOS-Switch / ProCurve (older: 2530, 2930, 3810, etc.)
        config.vendor = 'HP/Aruba';
        config.cpuOid = '1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0'; // hpSwitchCpuStat
        config.cpuOidFallback = '1.3.6.1.4.1.11.2.14.11.5.1.9.6.2.0';
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

function formatUptimeSeconds(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
    let seconds = Math.floor(totalSeconds);
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

// sysUpTime TimeTicks (yüzde-saniye) → saniye. 32-bit sayaç 2^32/100 ≈ 497 günde SARAR.
function formatUptime(ticks) {
    if (!ticks) return '';
    return formatUptimeSeconds(Math.floor(Number(ticks) / 100));
}

function parseSnmpInt(val) {
    if (Buffer.isBuffer(val)) return val.length > 0 ? val.readUIntBE(0, Math.min(val.length, 6)) : 0;
    return parseInt(val) || 0;
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

    // SNMP cache — 60 saniye içinde aynı cihaz için tekrar sorgu atma
    const cacheKey = `snmp:${device.id}`;
    const cached = snmpCache.get(cacheKey);
    if (cached) {
        return { ...responseData, ...cached };
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
            '1.3.6.1.2.1.1.5.0',      // Hostname (sysName)
            '1.3.6.1.2.1.1.3.0',      // sysUpTime (TimeTicks — 497 günde SARAR)
            '1.3.6.1.2.1.1.1.0',      // sysDescr
            '1.3.6.1.6.3.10.2.1.3.0'  // snmpEngineTime (saniye — pratikte sarmaz; uzun uptime için)
        ];

        const baseData = await getScalar(baseOids);
        let vendorConfig = { cpuOid: null };
        let sysDescrStr = '';

        if (baseData) {
            if (!snmp.isVarbindError(baseData[0])) responseData.snmpHostname = baseData[0].value.toString();
            // Uptime: sysUpTime TimeTicks 2^32/100 ≈ 497 günde sararak yanlış küçük değer
            // verir (ör. 552 gün → 55 gün). snmpEngineTime saniye cinsindendir ve pratikte
            // sarmaz. İkisinin BÜYÜĞÜNÜ al: sarma olduysa engine kazanır; engine yok/sıfırsa
            // sysUpTime kullanılır.
            {
                let sysUpSec = null, engSec = null;
                if (!snmp.isVarbindError(baseData[1])) {
                    const t = Number(baseData[1].value);
                    if (Number.isFinite(t) && t >= 0) sysUpSec = Math.floor(t / 100);
                }
                if (baseData[3] && !snmp.isVarbindError(baseData[3])) {
                    const e = Number(baseData[3].value);
                    if (Number.isFinite(e) && e > 0) engSec = e;
                }
                const cand = [sysUpSec, engSec].filter(v => v != null);
                if (cand.length) responseData.uptime = formatUptimeSeconds(Math.max(...cand));
            }
            if (!snmp.isVarbindError(baseData[2])) {
                sysDescrStr = baseData[2].value.toString();
                vendorConfig = getVendorConfig(sysDescrStr);
                responseData.detectedVendor = vendorConfig.vendor;
                console.log(`[SNMP] ${device.ip} sysDescr: "${sysDescrStr.substring(0, 80)}" → vendor: ${vendorConfig.vendor}`);
            }
        } else {
            console.log(`[SNMP] ${device.ip} base SNMP query returned null — community or connectivity issue`);
        }

        // Yazılım sürümü — ENTITY-MIB entPhysicalSoftwareRev (chassis öncelikli), yoksa sysDescr'den.
        // probeVersion (arka plan yenileme) ile AYNI mantık → detay ve liste tutarlı olur.
        // Yalnızca SNMP yanıt veriyorsa (baseData) dene; ölü SNMP'de subtree'ler boşuna timeout
        // ekler (sayfa gecikmesinin ana kaynağı). Boş dönerse kayıttaki son bilinen sürüm korunur.
        if (baseData) {
            try {
                // Sürüm + seri + model aynı ENTITY-MIB yürüyüşünden (chassis öncelikli).
                const [entClassVbs, entSwVbs, entSerialVbs, entModelVbs] = await Promise.all([getSubtree(ENT_CLASS), getSubtree(ENT_SW_REV), getSubtree(ENT_SERIAL), getSubtree(ENT_MODEL)]);
                const ver = pickVersion(entClassVbs, entSwVbs, sysDescrStr);
                if (ver) responseData.version = ver;
                const serial = pickSerial(entClassVbs, entSerialVbs);
                if (serial) responseData.serial = serial;
                const model = pickModel(entClassVbs, entModelVbs);
                if (model) responseData.snmpModel = model;
            } catch (e) {
                const ver = imageVersionFromSysDescr(sysDescrStr);
                if (ver) responseData.version = ver;
            }
        }

        // 2. CPU (try primary OID, then fallback)
        if (vendorConfig.cpuOid) {
            try {
                const cpuData = await getScalar([vendorConfig.cpuOid]);
                if (cpuData && !snmp.isVarbindError(cpuData[0])) {
                    responseData.cpu = parseSnmpInt(cpuData[0].value);
                } else if (vendorConfig.cpuOidFallback) {
                    const cpuFallback = await getScalar([vendorConfig.cpuOidFallback]);
                    if (cpuFallback && !snmp.isVarbindError(cpuFallback[0])) {
                        responseData.cpu = parseSnmpInt(cpuFallback[0].value);
                    }
                }
            } catch (cpuErr) {
                console.log(`[SNMP] ${device.ip} CPU query failed: ${cpuErr.message}`);
            }
        }

        // 3. Interface status — yalnızca SNMP yanıt veriyorsa (baseData). SNMP ölüyse
        // (ör. cihaz GSM yolunda SNMP UDP'yi geçirmiyor) bu çoklu subtree yürüyüşleri
        // boşuna ~30sn timeout ekler; canlılık kanıtı yoksa hiç girme — interface'i
        // route katmanı SSH ('show interfaces status') fallback'i ile getirir.
        const oldTableData = baseData ? await getSubtree('1.3.6.1.2.1.2.2.1.8') : [];
        const statusMap = {};
        oldTableData.forEach(vb => {
            const index = vb.oid.split('.').pop();
            statusMap[index] = parseSnmpInt(vb.value) === 1 ? 'up' : 'down';
        });

        // 4. ifXTable (64-bit counters)
        const newTableData = baseData ? await getSubtree('1.3.6.1.2.1.31.1.1.1') : [];
        const interfacesMap = {};

        // VLAN
        let vlanMap = {};
        let vlanNameMap = {};
        let trunkAllowedMap = {};
        let trunkPorts = new Set();
        // parseSnmpInt is now a module-level function

        if (responseData.detectedVendor === 'HP/Aruba' || vendorConfig.isArubaCX) {
            // HP/Aruba VLAN detection using IEEE 802.1Q MIB (dot1qVlanStaticUntaggedPorts + dot1qPvid)
            try {
                // dot1qPvid — untagged/access VLAN per port
                const pvidData = await getSubtree('1.3.6.1.2.1.17.7.1.4.5.1.1');
                pvidData.forEach(vb => {
                    const portIdx = vb.oid.split('.').pop();
                    const vlanId = parseSnmpInt(vb.value);
                    if (vlanId > 0) vlanMap[portIdx] = vlanId.toString();
                });

                // dot1qVlanStaticName — VLAN names
                const vlanNameData = await getSubtree('1.3.6.1.2.1.17.7.1.4.3.1.1');
                vlanNameData.forEach(vb => {
                    const vlanId = vb.oid.split('.').pop();
                    const name = vb.value.toString();
                    if (name) vlanNameMap[vlanId] = name;
                });

                // Bridge port → ifIndex mapping
                const bridgePortMap = {};
                const dot1dData = await getSubtree('1.3.6.1.2.1.17.1.4.1.2');
                dot1dData.forEach(vb => {
                    const bridgePort = vb.oid.split('.').pop();
                    const ifIdx = parseSnmpInt(vb.value).toString();
                    bridgePortMap[bridgePort] = ifIdx;
                });

                // Re-map vlanMap from bridge port index to ifIndex
                const remappedVlan = {};
                for (const [portIdx, vlan] of Object.entries(vlanMap)) {
                    const ifIdx = bridgePortMap[portIdx] || portIdx;
                    remappedVlan[ifIdx] = vlan;
                }
                Object.assign(vlanMap, remappedVlan);

                console.log(`[VLAN-HP] ${device.ip}: vlans found=${Object.keys(vlanNameMap).length}, ports=${Object.keys(vlanMap).length}`);
            } catch (err) {
                console.log("[VLAN-HP] Error:", err.message);
            }
        } else if (responseData.detectedVendor === 'Cisco') {
            try {
                // 1. Trunk portları tespit et
                const trunkModeData = await getSubtree('1.3.6.1.4.1.9.9.46.1.6.1.1.14');
                trunkModeData.forEach(vb => {
                    const ifIdx = vb.oid.split('.').pop();
                    const mode = parseSnmpInt(vb.value);
                    if (mode === 1 || mode === 5) trunkPorts.add(ifIdx);
                });

                // 2. Trunk native VLAN + allowed VLANs bitmap
                const trunkVlanData = await getSubtree('1.3.6.1.4.1.9.9.46.1.6.1.1.5');
                trunkVlanData.forEach(vb => {
                    const ifIdx = vb.oid.split('.').pop();
                    const val = parseSnmpInt(vb.value);
                    if (val > 0 && trunkPorts.has(ifIdx)) {
                        vlanMap[ifIdx] = val.toString() + ' (T)';
                    }
                });

                // Trunk allowed VLANs bitmap (1.3.6.1.4.1.9.9.46.1.6.1.1.4)
                const trunkBitmapData = await getSubtree('1.3.6.1.4.1.9.9.46.1.6.1.1.4');
                for (const vb of trunkBitmapData) {
                    const ifIdx = vb.oid.split('.').pop();
                    if (!trunkPorts.has(ifIdx)) continue;
                    if (Buffer.isBuffer(vb.value)) {
                        const vlans = [];
                        for (let byte = 0; byte < vb.value.length; byte++) {
                            for (let bit = 7; bit >= 0; bit--) {
                                if (vb.value[byte] & (1 << bit)) {
                                    vlans.push(byte * 8 + (7 - bit));
                                }
                            }
                        }
                        trunkAllowedMap[ifIdx] = vlans;
                    }
                }

                // 3. Statik config VLAN'ları al (vmVlan) — dinamik karşılaştırma için
                const staticVlanMap = {};
                const accessVlanData = await getSubtree('1.3.6.1.4.1.9.9.68.1.2.2.1.2');
                accessVlanData.forEach(vb => {
                    const ifIdx = vb.oid.split('.').pop();
                    const val = parseSnmpInt(vb.value);
                    if (val > 0) staticVlanMap[ifIdx] = val;
                });

                // 4. VLAN isimleri al (vtpVlanName)
                const vlanNameData = await getSubtree('1.3.6.1.4.1.9.9.46.1.3.1.1.4');
                const vlanIds = [];
                vlanNameData.forEach(vb => {
                    const vlanId = vb.oid.split('.').pop();
                    const name = vb.value.toString();
                    if (name && vlanId) {
                        vlanNameMap[vlanId] = name;
                        vlanIds.push(vlanId);
                    }
                });

                // 4. Operasyonel VLAN tespiti — community@vlan ile her VLAN'ın bridge tablosunu sorgula
                // Bu yöntem 802.1X/ISE tarafından dinamik atanan VLAN'ları da doğru gösterir
                const accessVlanIds = vlanIds.filter(v => {
                    const n = parseInt(v);
                    return n > 0 && n < 1002; // Sadece normal VLAN'lar (1002-1005 arası reserved)
                });

                for (const vid of accessVlanIds) {
                    try {
                        const vlanSession = snmp.createSession(device.ip, device.snmpCommunity + '@' + vid, {
                            port: device.snmpPort || 161, version: snmp.Version2c, timeout: 3000, retries: 0
                        });

                        const bridgePorts = await new Promise((resolve) => {
                            const results = [];
                            vlanSession.subtree('1.3.6.1.2.1.17.1.4.1.2', 20, (varbinds) => {
                                for (const vb of varbinds) results.push(vb);
                            }, () => resolve(results));
                        });

                        bridgePorts.forEach(vb => {
                            const ifIdx = parseSnmpInt(vb.value).toString();
                            // Trunk portları atla — onlar zaten native VLAN ile işaretli
                            if (trunkPorts.has(ifIdx)) return;

                            const staticVlan = staticVlanMap[ifIdx];
                            const isDynamic = staticVlan && staticVlan !== parseInt(vid);
                            const label = isDynamic ? vid + ' (D)' : vid;

                            if (!vlanMap[ifIdx]) {
                                vlanMap[ifIdx] = label;
                            } else if (!vlanMap[ifIdx].includes(vid)) {
                                // Aynı portta birden fazla VLAN (multi-auth: telefon + PC)
                                vlanMap[ifIdx] += ', ' + label;
                            }
                        });

                        vlanSession.close();
                    } catch (e) {
                        // VLAN sorgusu başarısız olabilir, devam et
                    }
                }

                console.log(`[VLAN] ${device.ip}: vlans scanned=${accessVlanIds.length}, ports found=${Object.keys(vlanMap).length}, trunk=${trunkPorts.size}`);
            } catch (err) {
                console.log("[VLAN] Hata:", err.message);
            }
        }

        // Helper: populate interfacesMap entry for a given index
        const ensureInterface = (index) => {
            if (interfacesMap[index]) return;
            const vlanStr = vlanMap[index] || '-';
            const vlanNameStr = vlanStr.split(',').map(v => {
                const id = v.trim().replace(/\s*\([TDB]\)/, '');
                return vlanNameMap[id] || '-';
            }).join(', ');
            const activeVlanIds = new Set(Object.keys(vlanNameMap));
            let trunkVlans = null;
            if (trunkAllowedMap[index]) {
                trunkVlans = trunkAllowedMap[index]
                    .filter(v => activeVlanIds.has(v.toString()))
                    .map(v => v.toString());
            }
            interfacesMap[index] = {
                index, name: '', status: statusMap[index] || 'down',
                vlan: vlanStr, vlanName: vlanNameStr, trunkVlans,
                speedMbps: 0, rawIn: BigInt(0), rawOut: BigInt(0)
            };
        };

        // ifXTable (64-bit counters, interface names)
        newTableData.forEach(vb => {
            if (snmp.isVarbindError(vb)) return;
            const oidParts = vb.oid.split('.');
            const index = oidParts.pop();
            const column = oidParts.pop();
            ensureInterface(index);

            if (column === '1') interfacesMap[index].name = vb.value.toString();
            else if (column === '15') interfacesMap[index].speedMbps = vb.value;
            else if (column === '6') interfacesMap[index].rawIn = bufferToBigInt(vb.value);
            else if (column === '10') interfacesMap[index].rawOut = bufferToBigInt(vb.value);
        });

        // Fallback: if ifXTable returned nothing, use ifTable (32-bit counters)
        if (Object.keys(interfacesMap).length === 0 && Object.keys(statusMap).length > 0) {
            console.log(`[SNMP] ${device.ip} ifXTable empty, falling back to ifTable`);
            const ifTableData = await getSubtree('1.3.6.1.2.1.2.2.1');
            ifTableData.forEach(vb => {
                if (snmp.isVarbindError(vb)) return;
                const oidParts = vb.oid.split('.');
                const index = oidParts.pop();
                const column = oidParts.pop();
                ensureInterface(index);

                if (column === '2') interfacesMap[index].name = vb.value.toString(); // ifDescr
                else if (column === '5') interfacesMap[index].speedMbps = Math.round(parseSnmpInt(vb.value) / 1000000); // ifSpeed (bps→Mbps)
                else if (column === '10') interfacesMap[index].rawIn = BigInt(parseSnmpInt(vb.value)); // ifInOctets (32-bit)
                else if (column === '16') interfacesMap[index].rawOut = BigInt(parseSnmpInt(vb.value)); // ifOutOctets (32-bit)
            });
        }

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
                    index: i.index, name: i.name, status: i.status,
                    vlan: i.vlan, vlanName: i.vlanName, trunkVlans: i.trunkVlans,
                    speed: i.speedMbps * 1000000, trafficIn: smoothedIn, trafficOut: smoothedOut
                };
            });

        responseData.interfaces.sort((a, b) => parseInt(a.index) - parseInt(b.index));
        TRAFFIC_CACHE[device.id] = deviceCache;

        // 6. RAM — yalnızca SNMP canlıysa (baseData); ölü SNMP'de boşuna timeout ekleme.
        if (baseData) try {
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
            } else if (vendorConfig.isArubaCX) {
                // ArubaOS-CX: use vendor-specific memory OIDs
                try {
                    const arubaMemSession = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
                    const arubaMemOids = [
                        '1.3.6.1.4.1.47196.4.1.1.3.11.2.1.1.10.0', // arubaWiredSystemMemoryTotal
                        '1.3.6.1.4.1.47196.4.1.1.3.11.2.1.1.11.0'  // arubaWiredSystemMemoryFree
                    ];
                    const arubaMemData = await new Promise((resolve) => {
                        arubaMemSession.get(arubaMemOids, (err, varbinds) => {
                            if (err) resolve(null); else resolve(varbinds);
                        });
                    });
                    if (arubaMemData && !snmp.isVarbindError(arubaMemData[0]) && !snmp.isVarbindError(arubaMemData[1])) {
                        const total = parseSnmpInt(arubaMemData[0].value);
                        const free = parseSnmpInt(arubaMemData[1].value);
                        if (total > 0) responseData.ram = Math.round(((total - free) / total) * 100);
                    }
                    arubaMemSession.close();
                } catch {}
            } else if (responseData.detectedVendor === 'HP/Aruba') {
                // ArubaOS-Switch / ProCurve: use HP memory OIDs
                try {
                    const hpMemSession = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
                    const hpMemOids = [
                        '1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.6.1', // hpLocalMemTotalBytes
                        '1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.7.1'  // hpLocalMemFreeBytes
                    ];
                    const hpMemData = await new Promise((resolve) => {
                        hpMemSession.get(hpMemOids, (err, varbinds) => {
                            if (err) resolve(null); else resolve(varbinds);
                        });
                    });
                    if (hpMemData && !snmp.isVarbindError(hpMemData[0]) && !snmp.isVarbindError(hpMemData[1])) {
                        const total = parseSnmpInt(hpMemData[0].value);
                        const free = parseSnmpInt(hpMemData[1].value);
                        if (total > 0) responseData.ram = Math.round(((total - free) / total) * 100);
                    }
                    hpMemSession.close();
                } catch {}
            } else if (responseData.detectedVendor === 'Cisco') {
                // Try CISCO-ENHANCED-MEMPOOL-MIB first (works on Nexus + newer IOS)
                let gotCiscoRam = false;
                try {
                    const cempSession = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
                    const cempUsedOid = '1.3.6.1.4.1.9.9.221.1.1.1.1.18'; // cempMemPoolHCUsed
                    const cempFreeOid = '1.3.6.1.4.1.9.9.221.1.1.1.1.20'; // cempMemPoolHCFree
                    const cempData = await new Promise((resolve) => {
                        const results = [];
                        cempSession.subtree(cempUsedOid, 20, (varbinds) => {
                            for (const vb of varbinds) results.push({ type: 'used', vb });
                        }, () => {
                            cempSession.subtree(cempFreeOid, 20, (varbinds) => {
                                for (const vb of varbinds) results.push({ type: 'free', vb });
                            }, () => resolve(results));
                        });
                    });
                    if (cempData.length > 0) {
                        let totalUsed = 0, totalFree = 0;
                        cempData.forEach(r => {
                            const val = parseSnmpInt(r.vb.value);
                            if (r.type === 'used') totalUsed += val;
                            else totalFree += val;
                        });
                        if (totalUsed + totalFree > 0) {
                            responseData.ram = Math.round((totalUsed / (totalUsed + totalFree)) * 100);
                            gotCiscoRam = true;
                        }
                    }
                    cempSession.close();
                } catch {}

                // Fallback: CISCO-MEMORY-POOL-MIB (Catalyst / older IOS)
                if (!gotCiscoRam) {
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
            }
            ramSession.close();
        } catch (ramErr) {
            responseData.ram = 0;
        }

        // Sonucu cache'le (60 saniye)
        const cacheData = {
            interfaces: responseData.interfaces, snmpHostname: responseData.snmpHostname,
            uptime: responseData.uptime, cpu: responseData.cpu, ram: responseData.ram,
            detectedVendor: responseData.detectedVendor, version: responseData.version
        };
        snmpCache.set(cacheKey, cacheData);

        return responseData;
    } catch (e) {
        console.error("[SNMP] Kritik Hata:", e);
        return responseData;
    }
}

// --- CDP/LLDP Auto-Discovery ---
// CDP OIDs
const CDP_CACHE_DEVICE_ID = '1.3.6.1.4.1.9.9.23.1.2.1.1.6';    // cdpCacheDeviceId (hostname)
const CDP_CACHE_ADDRESS = '1.3.6.1.4.1.9.9.23.1.2.1.1.4';       // cdpCacheAddress (IP, binary)
const CDP_CACHE_DEVICE_PORT = '1.3.6.1.4.1.9.9.23.1.2.1.1.7';   // cdpCacheDevicePort (remote port name)
const CDP_CACHE_PLATFORM = '1.3.6.1.4.1.9.9.23.1.2.1.1.8';      // cdpCachePlatform

// LLDP OIDs
const LLDP_REM_SYS_NAME = '1.0.8802.1.1.2.1.4.1.1.9';           // lldpRemSysName
const LLDP_REM_MAN_ADDR = '1.0.8802.1.1.2.1.4.2.1.4';           // lldpRemManAddrIfId (management address)
const LLDP_REM_PORT_DESC = '1.0.8802.1.1.2.1.4.1.1.8';           // lldpRemPortDesc

async function discoverNeighbors(device) {
    if (!device.snmpCommunity || device.status !== 'UP') return [];

    const neighbors = [];

    try {
        const session = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);

        const getSubtree = (oid) => new Promise((resolve) => {
            const results = [];
            session.subtree(oid, 20, (varbinds) => {
                for (const vb of varbinds) results.push(vb);
            }, (err) => resolve(results));
        });

        // --- CDP Discovery ---
        const [cdpDeviceIds, cdpAddresses, cdpPorts, cdpPlatforms] = await Promise.all([
            getSubtree(CDP_CACHE_DEVICE_ID),
            getSubtree(CDP_CACHE_ADDRESS),
            getSubtree(CDP_CACHE_DEVICE_PORT),
            getSubtree(CDP_CACHE_PLATFORM)
        ]);

        // Parse CDP entries — OID format: ...ifIndex.cdpCacheDeviceIndex
        const cdpMap = {};
        for (const vb of cdpDeviceIds) {
            const parts = vb.oid.split('.');
            const key = parts.slice(-2).join('.');
            if (!cdpMap[key]) cdpMap[key] = {};
            cdpMap[key].hostname = vb.value.toString().split('.')[0]; // Strip domain
        }
        for (const vb of cdpAddresses) {
            const parts = vb.oid.split('.');
            const key = parts.slice(-2).join('.');
            if (cdpMap[key] && Buffer.isBuffer(vb.value) && vb.value.length === 4) {
                cdpMap[key].ip = `${vb.value[0]}.${vb.value[1]}.${vb.value[2]}.${vb.value[3]}`;
            }
        }
        for (const vb of cdpPorts) {
            const parts = vb.oid.split('.');
            const key = parts.slice(-2).join('.');
            if (cdpMap[key]) cdpMap[key].remotePort = vb.value.toString();
        }
        for (const vb of cdpPlatforms) {
            const parts = vb.oid.split('.');
            const key = parts.slice(-2).join('.');
            if (cdpMap[key]) cdpMap[key].platform = vb.value.toString();
        }

        for (const [, entry] of Object.entries(cdpMap)) {
            if (entry.hostname || entry.ip) {
                neighbors.push({
                    protocol: 'CDP',
                    hostname: entry.hostname || '',
                    ip: entry.ip || '',
                    remotePort: entry.remotePort || '',
                    platform: entry.platform || ''
                });
            }
        }

        // --- LLDP Discovery ---
        const [lldpNames, lldpPorts] = await Promise.all([
            getSubtree(LLDP_REM_SYS_NAME),
            getSubtree(LLDP_REM_PORT_DESC)
        ]);

        // Also try to get LLDP management addresses
        let lldpAddrs = [];
        try { lldpAddrs = await getSubtree(LLDP_REM_MAN_ADDR); } catch {}

        const lldpMap = {};
        for (const vb of lldpNames) {
            const parts = vb.oid.split('.');
            const key = parts.slice(-3, -1).join('.'); // timeMark.localPortNum
            if (!lldpMap[key]) lldpMap[key] = {};
            lldpMap[key].hostname = vb.value.toString().split('.')[0];
        }
        for (const vb of lldpPorts) {
            const parts = vb.oid.split('.');
            const key = parts.slice(-3, -1).join('.');
            if (lldpMap[key]) lldpMap[key].remotePort = vb.value.toString();
        }
        // LLDP management address — OID includes IP bytes
        for (const vb of lldpAddrs) {
            const oidStr = vb.oid;
            // Try to extract IP from OID tail (subtype.len.a.b.c.d)
            const parts = oidStr.split('.');
            if (parts.length >= 4) {
                const ipParts = parts.slice(-4);
                const ip = ipParts.join('.');
                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
                    // Find which lldp entry this belongs to
                    const key = parts.slice(-7, -5).join('.');
                    if (lldpMap[key]) lldpMap[key].ip = ip;
                }
            }
        }

        for (const [, entry] of Object.entries(lldpMap)) {
            // Skip if already found via CDP (same hostname)
            const alreadyFound = neighbors.some(n => n.hostname && n.hostname === entry.hostname);
            if (!alreadyFound && (entry.hostname || entry.ip)) {
                neighbors.push({
                    protocol: 'LLDP',
                    hostname: entry.hostname || '',
                    ip: entry.ip || '',
                    remotePort: entry.remotePort || '',
                    platform: ''
                });
            }
        }

        session.close();
    } catch (e) {
        console.error(`[DISCOVERY] ${device.name} (${device.ip}): ${e.message}`);
    }

    return neighbors;
}

// --- MAC Address Search with in-memory cache + parallel queries ---

// In-memory MAC table cache: { mac -> [{ switchId, switchName, switchIp, port, vlan, type }] }
let macCache = new Map();
let macCacheTimestamp = 0;
const MAC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let macCacheBuilding = false;

// ARP cache: { ip -> mac }
let arpCache = new Map();

// Scan a single device's MAC table (called in parallel)
async function scanDeviceMacTable(device) {
    const entries = [];
    if (!device.snmpCommunity) return entries;

    try {
        const session = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
        const getSubtree = (oid) => new Promise((resolve) => {
            const r = [];
            session.subtree(oid, 20, (vbs) => { for (const vb of vbs) r.push(vb); }, () => resolve(r));
        });

        // Get VLAN list, interface names, trunk ports in parallel
        const [vlanData, ifNameData, trunkData] = await Promise.all([
            getSubtree('1.3.6.1.4.1.9.9.46.1.3.1.1.4'),
            getSubtree('1.3.6.1.2.1.31.1.1.1.1'),
            getSubtree('1.3.6.1.4.1.9.9.46.1.6.1.1.14')
        ]);

        const vlanIds = vlanData.map(vb => vb.oid.split('.').pop())
            .filter(v => { const n = parseInt(v); return n > 0 && n < 1002; });

        const ifNames = {};
        ifNameData.forEach(vb => { ifNames[vb.oid.split('.').pop()] = vb.value.toString(); });

        const trunkPorts = new Set();
        trunkData.forEach(vb => { if (parseSnmpInt(vb.value) === 1) trunkPorts.add(vb.oid.split('.').pop()); });

        session.close();

        // Scan VLANs in parallel (batches of 5 to avoid overwhelming)
        const batchSize = 5;
        for (let i = 0; i < vlanIds.length; i += batchSize) {
            const batch = vlanIds.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(vid => scanVlanMacTable(device, vid, ifNames, trunkPorts)));
            for (const vlanEntries of batchResults) entries.push(...vlanEntries);
        }
    } catch (e) {
        // Device unreachable, skip
    }
    return entries;
}

// Scan MAC table for a single VLAN on a device
async function scanVlanMacTable(device, vid, ifNames, trunkPorts) {
    const entries = [];
    try {
        const vlanSession = snmp.createSession(device.ip, device.snmpCommunity + '@' + vid, {
            port: device.snmpPort || 161, version: snmp.Version2c, timeout: 3000, retries: 0
        });

        const getSubtree = (oid) => new Promise((resolve) => {
            const r = [];
            vlanSession.subtree(oid, 20, (vbs) => { for (const vb of vbs) r.push(vb); }, () => resolve(r));
        });

        // Get MAC addresses, bridge ports, and bridge→ifIndex mappings in parallel
        const [macData, portData, bridgeData] = await Promise.all([
            getSubtree('1.3.6.1.2.1.17.4.3.1.1'),
            getSubtree('1.3.6.1.2.1.17.4.3.1.2'),
            getSubtree('1.3.6.1.2.1.17.1.4.1.2')
        ]);

        // Build bridge port → ifIndex map
        const bridgeToIf = {};
        bridgeData.forEach(vb => {
            const bp = vb.oid.split('.').pop();
            bridgeToIf[bp] = parseSnmpInt(vb.value);
        });

        // Build MAC suffix → bridge port map
        const macToBridge = {};
        portData.forEach(vb => {
            const suffix = vb.oid.replace('1.3.6.1.2.1.17.4.3.1.2.', '');
            macToBridge[suffix] = parseSnmpInt(vb.value);
        });

        // Process MACs
        for (const vb of macData) {
            if (!Buffer.isBuffer(vb.value) || vb.value.length !== 6) continue;
            const mac = vb.value.toString('hex').toLowerCase();
            const macSuffix = vb.oid.replace('1.3.6.1.2.1.17.4.3.1.1.', '');
            const bridgePort = macToBridge[macSuffix];
            if (!bridgePort) continue;
            const ifIdx = bridgeToIf[bridgePort.toString()];
            if (!ifIdx) continue;

            const portName = ifNames[ifIdx.toString()] || `Port-${ifIdx}`;
            const isTrunk = trunkPorts.has(ifIdx.toString());

            entries.push({
                mac,
                switchId: device.id,
                switchName: device.name,
                switchIp: device.ip,
                port: portName,
                ifIndex: ifIdx,
                vlan: parseInt(vid),
                type: isTrunk ? 'trunk' : 'access'
            });
        }

        vlanSession.close();
    } catch (e) { /* VLAN query failed */ }
    return entries;
}

// Build full MAC cache from all devices
async function buildMacCache(devices) {
    if (macCacheBuilding) return;
    macCacheBuilding = true;
    const start = Date.now();
    console.log(`[MAC-CACHE] Building cache from ${devices.length} devices...`);

    try {
        // Scan all devices in parallel
        const allResults = await Promise.all(
            devices.filter(d => d.status === 'UP' && d.snmpCommunity)
                .map(d => scanDeviceMacTable(d))
        );

        const newCache = new Map();
        let totalEntries = 0;
        for (const deviceEntries of allResults) {
            for (const entry of deviceEntries) {
                totalEntries++;
                const existing = newCache.get(entry.mac) || [];
                const key = `${entry.switchId}-${entry.port}-${entry.vlan}`;
                if (!existing.find(e => `${e.switchId}-${e.port}-${e.vlan}` === key)) {
                    existing.push(entry);
                    newCache.set(entry.mac, existing);
                }
            }
        }

        macCache = newCache;
        macCacheTimestamp = Date.now();
        console.log(`[MAC-CACHE] Built in ${Date.now() - start}ms: ${newCache.size} unique MACs, ${totalEntries} total entries`);
    } catch (e) {
        console.error(`[MAC-CACHE] Build failed:`, e.message);
    }
    macCacheBuilding = false;
}

// Resolve IP to MAC via parallel ARP queries
async function resolveIpToMac(devices, ip) {
    // Check ARP cache first
    const cached = arpCache.get(ip);
    if (cached) return cached;

    const arpPromises = devices
        .filter(d => d.status === 'UP' && d.snmpCommunity)
        .map(device => new Promise(async (resolve) => {
            try {
                const session = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
                const arpData = await new Promise((res) => {
                    const r = [];
                    session.subtree('1.3.6.1.2.1.4.22.1.2', 20, (vbs) => {
                        for (const vb of vbs) r.push(vb);
                    }, () => res(r));
                });
                session.close();

                for (const vb of arpData) {
                    const entryIp = vb.oid.split('.').slice(-4).join('.');
                    if (entryIp === ip && Buffer.isBuffer(vb.value) && vb.value.length === 6) {
                        const mac = vb.value.toString('hex').toLowerCase();
                        arpCache.set(ip, mac);
                        resolve(mac);
                        return;
                    }
                }
                resolve(null);
            } catch (e) { resolve(null); }
        }));

    const results = await Promise.all(arpPromises);
    return results.find(r => r !== null) || null;
}

// Kısmi aramada dönecek azami satır (tek harf grubu çok MAC'e uyabilir)
const MAX_PARTIAL_RESULTS = 200;

async function searchMAC(devices, searchTerm, forceRefresh = false) {
    let searchMac = null;   // tam 12 haneli MAC
    let partialMac = null;  // kısmi arama (4-11 hane) — MAC'in herhangi bir yerinde geçer
    let searchIp = null;

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(searchTerm.trim())) {
        searchIp = searchTerm.trim();
    } else {
        const cleaned = searchTerm.replace(/[:\-.\s]/g, '').toLowerCase();
        if (!/^[0-9a-f]+$/.test(cleaned)) {
            return { error: 'Invalid MAC address format', results: [] };
        }
        if (cleaned.length === 12) searchMac = cleaned;
        else if (cleaned.length >= 4) partialMac = cleaned;
        else return { error: 'Enter a full IP, a full MAC, or at least 4 hex characters', results: [] };
    }

    // Step 1: Resolve IP → MAC (parallel)
    if (searchIp) {
        console.log(`[MAC-SEARCH] Resolving IP ${searchIp}...`);
        searchMac = await resolveIpToMac(devices, searchIp);
        if (!searchMac) {
            return { error: `IP ${searchIp} not found in ARP tables`, results: [], resolvedMac: null };
        }
        console.log(`[MAC-SEARCH] Resolved ${searchIp} → ${searchMac}`);
    }

    // Kısmi aramada tek bir "çözülmüş MAC" yok → null (istemci arama terimini gösterir)
    const formattedMac = searchMac ? searchMac.replace(/(.{2})/g, '$1:').slice(0, 17) : null;

    // Tam MAC → O(1) birebir; kısmi → önbellek anahtarlarında alt-dize taraması
    const lookup = () => {
        if (searchMac) return macCache.get(searchMac) || [];
        const out = [];
        for (const [mac, entries] of macCache) {
            if (mac.includes(partialMac)) {
                out.push(...entries);
                if (out.length >= MAX_PARTIAL_RESULTS) break;
            }
        }
        return out.slice(0, MAX_PARTIAL_RESULTS);
    };

    const sortResults = (arr) => [...arr].sort((a, b) => {
        if (a.type === 'access' && b.type === 'trunk') return -1;
        if (a.type === 'trunk' && b.type === 'access') return 1;
        return 0;
    });

    // Step 2: Check cache (skip if force refresh)
    const cacheAge = Date.now() - macCacheTimestamp;
    if (!forceRefresh && cacheAge < MAC_CACHE_TTL && macCache.size > 0) {
        console.log(`[MAC-SEARCH] Cache hit (age: ${Math.round(cacheAge / 1000)}s)`);
        const cached = lookup();
        return {
            results: sortResults(cached), resolvedMac: formattedMac,
            partial: !!partialMac,
            searchedDevices: devices.length, fromCache: true,
            cacheAge: Math.round(cacheAge / 1000)
        };
    }

    // Step 3: Build fresh cache
    console.log(`[MAC-SEARCH] ${forceRefresh ? 'Force refresh' : 'Cache miss'}, scanning...`);
    await buildMacCache(devices);

    const results = lookup();
    console.log(`[MAC-SEARCH] Found ${results.length} result(s) for ${formattedMac || `*${partialMac}*`}`);
    return {
        results: sortResults(results), resolvedMac: formattedMac,
        partial: !!partialMac,
        searchedDevices: devices.length, fromCache: false, cacheAge: 0
    };
}

// ========================================================================
// Detaylı envanter (Detailed List export) — cihazdan SNMP ile serial/model/
// version/manufacturer topla. ENTITY-MIB hem Cisco IOS/IOS-XE hem Allied
// Telesis'te çalışır. Parser'lar saf (I/O yok), gerçek çıktılarla doğrulandı.
// ========================================================================

// sysDescr → CSV'deki BÜYÜK HARFLİ üretici etiketi
function manufacturerFromSysDescr(sysDescr) {
    const d = String(sysDescr || '').toLowerCase();
    if (/allied\s*telesis|alliedware\s*plus|\baw\+/.test(d)) return 'ALLIED TELESIS';
    if (d.includes('cisco')) return 'CISCO';
    if (d.includes('huawei')) return 'HUAWEI';
    if (/arubaos|aruba/.test(d)) return 'ARUBA';
    if (/procurve|hewlett[- ]packard|\bhp\b/.test(d)) return 'HP';
    if (d.includes('juniper') || d.includes('junos')) return 'JUNIPER';
    if (d.includes('fortinet') || d.includes('fortigate')) return 'FORTINET';
    return '';
}

// sysDescr → image/yazılım sürümü. Cisco klasik IOS "15.2(8)E1", IOS-XE
// "17.06.04(CAT9K_IOSXE)" (image train eklenir), Allied Telesis veya bilinmiyorsa ''.
function imageVersionFromSysDescr(sysDescr) {
    const s = String(sysDescr || '');
    let m = s.match(/Version\s+(\d{1,2}\.\d{1,2}\(\d+[A-Za-z]?\)[0-9A-Za-z]*)/); // klasik IOS
    if (m) return m[1];
    m = s.match(/Version\s+(\d{1,2}\.\d{1,2}\.\d{1,2}[A-Za-z]?)/);               // IOS-XE
    if (m) {
        const ver = m[1];
        const t = s.match(/Software\s+\(([A-Za-z0-9_-]*IOSXE[A-Za-z0-9_-]*)\)/i);
        return t ? `${ver}(${t[1]})` : ver;
    }
    if (/allied\s*telesis|alliedware\s*plus|\baw\+/i.test(s)) {
        const a = s.match(/(?:AlliedWare Plus\b[^\n]*?|\bversion\s+|\bAW\+\s*v?)(main-\d{8}|\d+\.\d+\.\d+(?:-\d+\.\d+)?)/i);
        return a ? a[1] : '';
    }
    return '';
}

// ENTITY-MIB entPhysicalTable sütunları + sistem skalerleri
const ENT_CLASS  = '1.3.6.1.2.1.47.1.1.1.1.5';   // entPhysicalClass (chassis == 3)
const ENT_SW_REV = '1.3.6.1.2.1.47.1.1.1.1.10';  // entPhysicalSoftwareRev
const ENT_SERIAL = '1.3.6.1.2.1.47.1.1.1.1.11';  // entPhysicalSerialNum
const ENT_MODEL  = '1.3.6.1.2.1.47.1.1.1.1.13';  // entPhysicalModelName
const SYS_NAME   = '1.3.6.1.2.1.1.5.0';
const SYS_DESCR  = '1.3.6.1.2.1.1.1.0';
const SYS_OBJID  = '1.3.6.1.2.1.1.2.0';          // Allied Telesis kök: 1.3.6.1.4.1.207

function entIndex(colBase, oid) { return oid.slice(colBase.length + 1); }

// Tek cihazın envanter satırını döndür. ASLA throw etmez (havuz güvenliği).
async function inventoryDevice(device) {
    // Device Name domain sonekini taşımasın (SNMP sysName FQDN dönebilir) → ilk noktaya kadar
    const stripDomain = (n) => String(n || '').trim().split('.')[0];
    const row = { name: stripDomain(device.name), type: device.type || 'switch', manufacturer: '', model: device.model || '', serial: '', version: '', ip: device.ip, topologyPage: device.topologyPage || 'main' };
    if (!device.snmpCommunity) return row; // SNMP yok → sadece kayıtlı alanlar

    let session;
    try {
        session = snmp.createSession(device.ip, device.snmpCommunity, {
            port: device.snmpPort || 161, version: snmp.Version2c, timeout: 3000, retries: 0
        });
        const getScalar = (oids) => new Promise(r => session.get(oids, (e, vb) => r(e ? null : vb)));
        const getSubtree = (oid) => new Promise(r => {
            const o = [];
            session.subtree(oid, 20, (vbs) => { for (const vb of vbs) o.push(vb); }, () => r(o));
        });

        const base = await getScalar([SYS_NAME, SYS_DESCR, SYS_OBJID]);
        let sysDescr = '', sysObjId = '';
        if (base) {
            if (!snmp.isVarbindError(base[0])) row.name = stripDomain(base[0].value.toString()) || row.name;
            if (!snmp.isVarbindError(base[1])) sysDescr = base[1].value.toString();
            if (!snmp.isVarbindError(base[2])) sysObjId = base[2].value.toString();
        }

        const [cVbs, sVbs, mVbs, wVbs] = await Promise.all([
            getSubtree(ENT_CLASS), getSubtree(ENT_SERIAL), getSubtree(ENT_MODEL), getSubtree(ENT_SW_REV)
        ]);
        const clean = (v) => v.toString().replace(/\x00/g, '').trim();
        const ent = {};
        for (const vb of cVbs) { const i = entIndex(ENT_CLASS, vb.oid);  (ent[i] || (ent[i] = {})).cls = parseSnmpInt(vb.value); }
        for (const vb of sVbs) { const i = entIndex(ENT_SERIAL, vb.oid); (ent[i] || (ent[i] = {})).serial = clean(vb.value); }
        for (const vb of mVbs) { const i = entIndex(ENT_MODEL, vb.oid);  (ent[i] || (ent[i] = {})).model = clean(vb.value); }
        for (const vb of wVbs) { const i = entIndex(ENT_SW_REV, vb.oid); (ent[i] || (ent[i] = {})).sw = clean(vb.value); }

        const idxs = Object.keys(ent).sort((a, b) => Number(a) - Number(b));
        const pick = idxs.find(i => ent[i].cls === 3 && ent[i].serial)
            || idxs.find(i => ent[i].cls === 3)
            || idxs.find(i => ent[i].serial);
        const chassis = pick ? ent[pick] : {};

        row.serial = chassis.serial || '';
        row.model = chassis.model || device.model || '';

        // Version: temiz entPhysicalSoftwareRev tercih; yoksa sysDescr'den parse
        const swRev = (chassis.sw && chassis.sw.trim()) || idxs.map(i => ent[i].sw).find(sw => sw && sw.trim()) || '';
        row.version = swRev ? swRev.trim() : imageVersionFromSysDescr(sysDescr);

        row.manufacturer = manufacturerFromSysDescr(sysDescr)
            || (sysObjId.startsWith('1.3.6.1.4.1.207') ? 'ALLIED TELESIS' : '');
    } catch (e) {
        /* pool güvenliği: yut, boş alanlarla dön */
    } finally {
        if (session) { try { session.close(); } catch (_) { /* ignore */ } }
    }
    return row;
}

// Tüm cihazların envanteri — sınırlı eşzamanlılıkla (SNMP fan-out sınırı)
async function inventoryAll(devices, concurrency = 8) {
    const list = Array.isArray(devices) ? devices : [];
    const results = new Array(list.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
        for (;;) {
            const i = cursor++;
            if (i >= list.length) return;
            results[i] = await inventoryDevice(list[i]);
        }
    });
    await Promise.all(runners);
    return results;
}

// entPhysicalSoftwareRev (chassis == 3 öncelikli) + sysDescr yedeği → temiz sürüm string'i.
// getDeviceDetails (canlı) ve probeVersion (arka plan) burada birleşir → tek kaynak, tutarlı sonuç.
function pickVersion(entClassVbs, entSwVbs, sysDescr) {
    const clean = (v) => v.toString().replace(/\x00/g, '').trim();
    const ent = {};
    for (const vb of entClassVbs || []) { const i = entIndex(ENT_CLASS, vb.oid);  (ent[i] || (ent[i] = {})).cls = parseSnmpInt(vb.value); }
    for (const vb of entSwVbs || [])    { const i = entIndex(ENT_SW_REV, vb.oid); (ent[i] || (ent[i] = {})).sw = clean(vb.value); }
    const idxs = Object.keys(ent).sort((a, b) => Number(a) - Number(b));
    const pick = idxs.find(i => ent[i].cls === 3 && ent[i].sw) || idxs.find(i => ent[i].sw);
    const sw = pick ? ent[pick].sw : '';
    return (sw && sw.trim()) || imageVersionFromSysDescr(sysDescr) || '';
}

// entPhysicalSerialNum'dan chassis (entPhysicalClass==3) seri numarası; chassis
// yoksa ilk dolu seri. inventoryDevice ile aynı seçim mantığı → detay ve detaylı
// liste tutarlı olur.
function pickSerial(entClassVbs, entSerialVbs) {
    const clean = (v) => v.toString().replace(/\x00/g, '').trim();
    const ent = {};
    for (const vb of entClassVbs || [])  { const i = entIndex(ENT_CLASS, vb.oid);  (ent[i] || (ent[i] = {})).cls = parseSnmpInt(vb.value); }
    for (const vb of entSerialVbs || []) { const i = entIndex(ENT_SERIAL, vb.oid); (ent[i] || (ent[i] = {})).serial = clean(vb.value); }
    const idxs = Object.keys(ent).sort((a, b) => Number(a) - Number(b));
    const pick = idxs.find(i => ent[i].cls === 3 && ent[i].serial) || idxs.find(i => ent[i].serial);
    return pick ? ent[pick].serial : '';
}

// entPhysicalModelName'den chassis (entPhysicalClass==3) model adı; yoksa ilk dolu.
// Manuel (kayıttaki) model önceliklidir; bu yalnızca elle girilmediğinde kullanılır.
function pickModel(entClassVbs, entModelVbs) {
    const clean = (v) => v.toString().replace(/\x00/g, '').trim();
    const ent = {};
    for (const vb of entClassVbs || []) { const i = entIndex(ENT_CLASS, vb.oid); (ent[i] || (ent[i] = {})).cls = parseSnmpInt(vb.value); }
    for (const vb of entModelVbs || []) { const i = entIndex(ENT_MODEL, vb.oid); (ent[i] || (ent[i] = {})).model = clean(vb.value); }
    const idxs = Object.keys(ent).sort((a, b) => Number(a) - Number(b));
    const pick = idxs.find(i => ent[i].cls === 3 && ent[i].model) || idxs.find(i => ent[i].model);
    return pick ? ent[pick].model : '';
}

// Arka plan sürüm yenileme için hafif SNMP sorgusu (sysDescr + entPhysicalSoftwareRev).
// ASLA throw etmez (havuz güvenliği), oturumu her durumda kapatır.
async function probeVersion(device) {
    if (!device || !device.snmpCommunity) return '';
    let session;
    try {
        session = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
        const getScalar = (oids) => new Promise(r => session.get(oids, (e, vb) => r(e ? null : vb)));
        const getSubtree = (oid) => new Promise(r => {
            const o = [];
            session.subtree(oid, 20, (vbs) => { for (const vb of vbs) o.push(vb); }, () => r(o));
        });
        const base = await getScalar([SYS_DESCR]);
        if (!base) return ''; // SNMP yanıt vermiyor → subtree'lerde boşuna timeout bekleme
        const sysDescr = !snmp.isVarbindError(base[0]) ? base[0].value.toString() : '';
        const [cVbs, wVbs] = await Promise.all([getSubtree(ENT_CLASS), getSubtree(ENT_SW_REV)]);
        return pickVersion(cVbs, wVbs, sysDescr);
    } catch (e) {
        return '';
    } finally {
        if (session) { try { session.close(); } catch (_) { /* ignore */ } }
    }
}

// --- IP SLA (CISCO-RTTMON-MIB) ---
// Cisco'nun "show ip sla summary" Return Code'unu SNMP ile okur.
const RTTMON_SENSE  = '1.3.6.1.4.1.9.9.42.1.2.10.1.2'; // rttMonLatestRttOperSense (1=ok, 4=timeout, ...)
const RTTMON_RTT    = '1.3.6.1.4.1.9.9.42.1.2.10.1.1'; // rttMonLatestRttOperCompletionTime (ms)
const RTTMON_TAG    = '1.3.6.1.4.1.9.9.42.1.2.1.1.3';  // rttMonCtrlAdminTag (ad/etiket)
const RTTMON_TARGET = '1.3.6.1.4.1.9.9.42.1.2.2.1.2';  // rttMonEchoAdminTargetAddress
const SENSE_MAP = {
    1: 'ok', 2: 'disconnected', 3: 'overThreshold', 4: 'timeout', 5: 'busy',
    6: 'notConnected', 7: 'dropped', 8: 'sequenceError', 9: 'verifyError', 10: 'applicationSpecific'
};

// Cihazdaki tüm IP SLA operasyonlarının son durumunu döndürür.
// [{ id, tag, target, rtt, sense, status }]  — IP SLA yoksa/okunamıyorsa []
async function ipSlaStatus(device) {
    if (!device.snmpCommunity || device.status !== 'UP') return [];
    let session;
    try {
        session = createSnmpSession(device.ip, device.snmpCommunity, device.snmpPort, device.snmpVersion);
    } catch (e) {
        return [];
    }

    // { vbs, err } döndür — teşhis için subtree hatası da toplanır
    const getSubtree = (oid) => new Promise((resolve) => {
        const out = [];
        try {
            session.subtree(oid, 20, (vbs) => { for (const vb of vbs) out.push(vb); }, (err) => resolve({ vbs: out, err: err ? err.message : null }));
        } catch (e) { resolve({ vbs: out, err: e.message }); }
    });
    const indexOf = (vb, base) => vb.oid.slice(base.length + 1); // base'ten sonraki SLA index'i

    try {
        const [senseRes, rttRes, tagRes, targetRes] = await Promise.all([
            getSubtree(RTTMON_SENSE), getSubtree(RTTMON_RTT), getSubtree(RTTMON_TAG), getSubtree(RTTMON_TARGET)
        ]);
        const senseVbs = senseRes.vbs, rttVbs = rttRes.vbs, tagVbs = tagRes.vbs, targetVbs = targetRes.vbs;

        // Teşhis: sonuç boşsa hangi OID kaç kayıt döndü + SNMP hatası (IE4010 vb. kart gelmeme sorunu için)
        if (senseVbs.length === 0) {
            console.log(`[IP-SLA] ${device.name} (${device.ip}) model=${device.model || '?'} snmp=${device.snmpVersion || 'v2c'}: EMPTY — sense=0 rtt=${rttVbs.length} tag=${tagVbs.length} target=${targetVbs.length}` +
                (senseRes.err || tagRes.err ? ` | err(sense=${senseRes.err}, tag=${tagRes.err})` : ''));
        }

        const rttMap = {}, tagMap = {}, targetMap = {};
        for (const vb of rttVbs) rttMap[indexOf(vb, RTTMON_RTT)] = Number(vb.value);
        for (const vb of tagVbs) tagMap[indexOf(vb, RTTMON_TAG)] = vb.value != null ? vb.value.toString().trim() : '';
        for (const vb of targetVbs) {
            const k = indexOf(vb, RTTMON_TARGET);
            if (Buffer.isBuffer(vb.value) && vb.value.length === 4) {
                targetMap[k] = `${vb.value[0]}.${vb.value[1]}.${vb.value[2]}.${vb.value[3]}`;
            } else if (vb.value != null) {
                const s = vb.value.toString().trim();
                if (s) targetMap[k] = s;
            }
        }

        return senseVbs.map(vb => {
            const id = indexOf(vb, RTTMON_SENSE);
            const sense = Number(vb.value);
            return {
                id,
                tag: tagMap[id] || '',
                target: targetMap[id] || '',
                rtt: rttMap[id] != null && Number.isFinite(rttMap[id]) ? rttMap[id] : null,
                sense,
                status: SENSE_MAP[sense] || `code-${sense}`
            };
        }).sort((a, b) => Number(a.id) - Number(b.id));
    } catch (e) {
        return [];
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
}

module.exports = {
    getDeviceDetails, getVendorConfig, discoverNeighbors, searchMAC,
    manufacturerFromSysDescr, imageVersionFromSysDescr, inventoryDevice, inventoryAll,
    ipSlaStatus, probeVersion,
};
