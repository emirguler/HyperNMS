// SSH "show version" çıktısından cihaz kimliği çıkarımı (saf/yan etkisiz).
// Öncelik Cisco IOS/IOS-XE (IE-4000/IE-4010, C9200); diğer vendor'larda en iyi çaba.
const { getVendorConfig } = require('../services/snmpService');

// --- Çıktı normalizasyonu (regex'lerden ÖNCE) ---
function cleanSshOutput(raw) {
    return String(raw || '')
        .replace(/\x1B\][^\x07]*\x07/g, '')                 // OSC (başlık) dizileri
        .replace(/\x1B\[[0-9;?]*[ -\/]*[@-~]/g, '')          // CSI/ANSI
        .replace(/\x1B[=>]/g, '')
        .replace(/ *--+ *More *--+ *(\x08+ +\x08+)?/gi, '')  // paging kalıntısı
        .replace(/\r\n/g, '\n').replace(/\r/g, '').replace(/\x00/g, '');
}

// --- Vendor tespiti ---
// getVendorConfig() sysDescr için yazıldı; çok-KB'lık SSH metnini ham vermek yanlış
// eşleşme yapar (ör. "graphport" içeren Juniper çıktısı HP sanılır). Önce tek bir
// kesin token'a indirge.
function vendorHintFromSsh(text) {
    const t = String(text || '').slice(0, 4000).toLowerCase();
    if (/\bcisco\b|ios[- ]xe|nx-os|catalyst/.test(t)) return /nx-os|nexus/.test(t) ? 'cisco nx-os' : 'cisco ios';
    if (/\bhuawei\b|vrp \(r\)/.test(t)) return 'huawei';
    if (/arubaos-cx/.test(t)) return 'arubaos-cx';
    if (/\bjuniper\b|\bjunos\b/.test(t)) return 'juniper';   // procurve/hp satırından ÖNCE olmalı
    if (/procurve|arubaos-switch|hewlett[- ]packard|\baruba\b/.test(t)) return 'procurve';
    if (/fortigate|fortios|fortiswitch|\bfortinet\b/.test(t)) return 'fortinet';
    if (/\blinux\b|ubuntu|debian|centos|red hat/.test(t)) return 'linux';
    return '';
}

// --- Hostname: en güvenilir kaynak SSH prompt'u ---
const PROMPT_PATTERNS = [
    /^([A-Za-z0-9][A-Za-z0-9._-]{0,62})(?:\([^)]{1,40}\))?\s*[#>]\s*$/,              // Cisco/Aruba/ProCurve
    /^[<\[]([A-Za-z0-9][A-Za-z0-9._-]{0,62})(?:-[^\]>]{1,40})?[>\]]\s*$/,            // Huawei VRP
    /^[A-Za-z0-9._-]{1,32}@([A-Za-z0-9][A-Za-z0-9._-]{0,62})\s*[#>%]\s*$/,           // Juniper
    /^[A-Za-z0-9._-]{1,32}@([A-Za-z0-9][A-Za-z0-9.-]{0,62}):[^$#]*[$#]\s*$/,         // Linux
    /^\[[A-Za-z0-9._-]{1,32}@([A-Za-z0-9][A-Za-z0-9.-]{0,62})[^\]]*\]\s*[$#]\s*$/,   // Linux [user@host ~]#
];

function hostnameFromPrompt(clean) {
    const lines = String(clean || '').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) { // sondan başa: komut sonrası prompt en temizi
        const line = lines[i].trim();
        if (!line || line.length > 80) continue;
        for (const re of PROMPT_PATTERNS) {
            const m = line.match(re);
            if (m && !/^(more|username|password|login)$/i.test(m[1])) return m[1];
        }
    }
    return null;
}

const HOSTNAME_PATTERNS = [
    /^([A-Za-z0-9][A-Za-z0-9._-]{0,62})\s+uptime\s+is\s+/m, // Cisco IOS/IOS-XE (case-sensitive!)
    /^\s*Device name:\s*(\S+)/mi,                            // NX-OS
    /^\s*Hostname:\s*(\S+)/mi,                               // Juniper/Fortinet/Aruba CX
    /^\s*System Name\s*:\s*(\S+)/mi,                         // ProCurve
    /^\s*hostname\s+(\S+)\s*$/mi,                            // show run | i hostname
];

// --- Model ---
const MODEL_PATTERNS = [
    /^\s*Model\s+[Nn]umber\s*:\s*(\S+)/m,                                        // IOS-XE (en kesin)
    /^\s*cisco\s+([A-Za-z0-9][A-Za-z0-9\/+._-]*)\s+\([^)]*\)\s+processor/mi,     // IOS "cisco IE-4010-4S24P (PowerPC) processor"
    /^\s*cisco\s+(.+?)\s+[Cc]hassis/m,                                           // NX-OS
    /^\*?\s*\d{1,2}\s+\d{1,3}\s+([A-Za-z0-9][A-Za-z0-9\/+._-]{3,})\s+\d+\.\S+\s+\S+/m, // IOS-XE stack tablosu
    /^\s*cisco\s+([A-Za-z0-9][A-Za-z0-9\/+._-]*)\s+\(/mi,                        // genel IOS
    /^HUAWEI\s+(\S+)\s+.*uptime\s+is/mi,
    /Version\s+[\d.]+\s+\(([A-Za-z0-9-]+)\s+V\d{3}R\d{3}/,                       // Huawei aile
    /^Model:\s*(\S+)/mi,                                                         // Juniper
    /^Version:\s*([A-Za-z0-9-]+)\s+v\d/mi,                                       // Fortinet
    /^\s*Product\s+Name\s*:\s*(.+?)\s*$/mi,                                      // Aruba CX
    /^\s*Chassis:\s*(\S+)/mi,                                                    // ProCurve
    /^Cisco IOS(?: XE)? Software.*?,\s*([A-Za-z0-9]+)\s+Software\s*\(/mi,        // son çare: aile
];

// --- Model → uygulamanın geçerli tipleri (validation.js validTypes) ---
// Sıra kritik: firewall → antenna → router → switch → server
const TYPE_RULES = [
    [/^(ASA5|ASA[0-9]|FPR-?[0-9]|FTD)/i, 'firewall'],
    [/^(FG[TA]?-?[0-9]|FWF-?[0-9]|FortiGate)/i, 'firewall'],
    [/^(SRX|vSRX)/i, 'firewall'],
    [/^(USG[0-9]|Eudemon)/i, 'firewall'],
    [/^PA-[0-9]/i, 'firewall'],
    [/firepower|adaptive security appliance/i, 'firewall'],

    [/^AIR-(CAP|AP|LAP|SAP)/i, 'antenna'],
    [/^(AP|IAP)-?[0-9]/i, 'antenna'],
    [/^(UAP|UBNT|NanoStation|NanoBeam|LiteBeam|PowerBeam|Rocket|AirFiber|AirGrid)/i, 'antenna'],
    [/^(SXT|LHG|LDF|QRT|mANT|DISC|Groove|BaseBox|NetBox|wAP|cAP|Metal)/i, 'antenna'],
    [/access point|wireless bridge/i, 'antenna'],

    // Router kuralları switch'ten ÖNCE: C8xxx router, C9xxx switch; IR-1101 router, IE-4010 switch
    [/^(ISR[0-9]?|ASR[0-9]|CSR[0-9]|C8[0-9]{3}|C11[0-9]{2}|C89[0-9]|C88[0-9]|IR-?[0-9]|CGR-?[0-9]|RV[0-9]{3})/i, 'router'],
    [/^CISCO[0-9]{3,4}/i, 'router'],
    [/^(AR[0-9]|NE[0-9]|ATN[0-9])/i, 'router'],
    [/^(MX[0-9]|PTX[0-9]|ACX[0-9]|vMX)/i, 'router'],
    [/integrated services router|aggregation services router/i, 'router'],

    [/^(WS-C|C9[0-9]{3}|C10[0-9]{2}|C2960|C3560|C3750|IE-?[0-9]|ME-?[0-9]|N[3579]K|Nexus|SG[0-9]{3}|CBS[0-9]{3})/i, 'switch'],
    [/^(S[0-9]{4}|CE[0-9]{4})/i, 'switch'],
    [/^(EX[0-9]|QFX[0-9])/i, 'switch'],
    [/^(J[0-9]{4}[A-Z]|JL[0-9]{3}[A-Z])/i, 'switch'],
    [/^(FS-?[0-9]|FortiSwitch)/i, 'switch'],
    [/catalyst|procurve|routing switch|ethernet switch/i, 'switch'],

    [/^(UCS|PowerEdge|ProLiant|ThinkSystem|PRIMERGY)/i, 'server'],
    [/linux|ubuntu|debian|centos|red hat|windows server/i, 'server'],
];

function mapModelToType(model, vendor) {
    const s = String(model || '').trim();
    if (s) for (const [re, type] of TYPE_RULES) if (re.test(s)) return type;
    if (vendor === 'Linux Server') return 'server';
    if (vendor === 'Fortinet') return 'firewall';
    return 'switch'; // emin değilsek varsayılan
}

// Fabrika ayarındaki cihazlar "Switch#"/"Router#" prompt'u verir — her cihaz aynı ada
// çakışır; düşük güven olarak işaretle (çağıran taraf IP'ye düşebilsin).
const DEFAULT_HOSTNAMES = /^(switch|router)$/i;

function identifyFromSsh(raw, ctx = {}) {
    const clean = cleanSshOutput(raw);
    const vendor = getVendorConfig(vendorHintFromSsh(clean) || clean).vendor;

    let name = hostnameFromPrompt(clean);
    let src = name ? 'prompt' : null;
    if (!name) {
        for (const re of HOSTNAME_PATTERNS) {
            const m = clean.match(re);
            if (m) { name = m[1]; src = 'text'; break; }
        }
    }
    const isDefaultName = name && DEFAULT_HOSTNAMES.test(name);
    if (!name || isDefaultName) {
        name = ctx.snmpHostname || ctx.ip || name || '';
        src = ctx.snmpHostname ? 'snmp' : 'ip';
    }

    let model = null;
    for (const re of MODEL_PATTERNS) {
        const m = clean.match(re);
        if (m) { model = m[1].trim().slice(0, 200); break; } // validation.js model max 200
    }

    return {
        name,
        model,
        type: mapModelToType(model, vendor),
        vendor,
        confidence: model && src === 'prompt' ? 'high' : model ? 'medium' : 'low',
    };
}

module.exports = {
    cleanSshOutput, vendorHintFromSsh, hostnameFromPrompt,
    mapModelToType, identifyFromSsh,
};
