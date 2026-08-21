import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { useViewport } from '../hooks/useViewport';

// Cihaz tipine göre şekil rengi (r, g, b)
const TYPE_COLOR = {
  switch: '56, 189, 248',   // mavi
  router: '56, 189, 248',   // mavi
  firewall: '239, 68, 68',  // kırmızı
  server: '168, 85, 247',   // mor
  pc: '100, 116, 139',      // gri
  cloud: '14, 165, 233',    // açık mavi
  antenna: '245, 158, 11',  // turuncu
};

// Cihaz şekli SADECE iki türde: antenna (yuvarlak) ve diğer her tip switch gibi
// dikdörtgen ('rect'). Cloud dahil özel kutu yok — yalnız ikon tipe göre değişir.
const TYPE_SHAPE = {
  antenna: 'circle',
};

const ICON_SIZE = 16;

// --- Professional SVG Icons ---
const RouterIcon = ({ size = ICON_SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="16" stroke="var(--primary)" strokeWidth="2" fill="rgba(56,189,248,0.08)" />
    <path d="M12 20h16M20 12v16M14 14l12 12M26 14L14 26" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    <circle cx="20" cy="20" r="4" fill="var(--primary)" />
  </svg>
);

const FirewallIcon = ({ size = ICON_SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect x="6" y="8" width="28" height="24" rx="3" stroke="#ef4444" strokeWidth="2" fill="rgba(239,68,68,0.08)" />
    <rect x="6" y="8" width="28" height="8" rx="3" fill="rgba(239,68,68,0.15)" />
    <line x1="6" y1="20" x2="34" y2="20" stroke="#ef4444" strokeWidth="1.5" />
    <line x1="20" y1="8" x2="20" y2="32" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
  </svg>
);

const ServerIcon = ({ size = ICON_SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect x="8" y="6" width="24" height="10" rx="2" stroke="#a855f7" strokeWidth="1.5" fill="rgba(168,85,247,0.08)" />
    <rect x="8" y="18" width="24" height="10" rx="2" stroke="#a855f7" strokeWidth="1.5" fill="rgba(168,85,247,0.08)" />
    <circle cx="13" cy="11" r="1.5" fill="#34d399" />
    <circle cx="13" cy="23" r="1.5" fill="#34d399" />
    <rect x="24" y="9" width="5" height="4" rx="1" fill="rgba(168,85,247,0.3)" />
    <rect x="24" y="21" width="5" height="4" rx="1" fill="rgba(168,85,247,0.3)" />
    <line x1="20" y1="30" x2="20" y2="36" stroke="#a855f7" strokeWidth="1.5" />
    <line x1="14" y1="36" x2="26" y2="36" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SwitchSvgIcon = ({ status, size = ICON_SIZE }) => (
  <svg width={size * 2.2} height={size * 0.62} viewBox="0 0 50 14" fill="none">
    <rect width="50" height="14" rx="2" fill="var(--bg-dark)" stroke="var(--primary)" strokeWidth="1.5" />
    <circle cx="8" cy="7" r="1.5" fill={status === 'UP' ? 'var(--success)' : '#64748b'} />
    <circle cx="15" cy="7" r="1.5" fill={status === 'UP' ? 'var(--success)' : '#64748b'} />
    <circle cx="22" cy="7" r="1.5" fill={status === 'UP' ? 'var(--success)' : '#64748b'} />
    <circle cx="29" cy="7" r="1.5" fill={status === 'UP' ? 'var(--success)' : '#64748b'} />
    <circle cx="36" cy="7" r="1.5" fill={status === 'UP' ? 'var(--success)' : '#64748b'} />
    <rect x="42" y="4.5" width="5" height="5" rx="0.5" fill="#f59e0b" />
  </svg>
);

const PcIcon = ({ size = ICON_SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
    <rect x="4" y="4" width="28" height="20" rx="2" stroke="#64748b" strokeWidth="1.5" fill="rgba(100,116,139,0.08)" />
    <rect x="7" y="7" width="22" height="14" rx="1" fill="rgba(56,189,248,0.1)" />
    <line x1="18" y1="24" x2="18" y2="30" stroke="#64748b" strokeWidth="1.5" />
    <line x1="12" y1="30" x2="24" y2="30" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const CloudIcon = ({ size = ICON_SIZE }) => (
  <svg width={size * 1.3} height={size} viewBox="0 0 44 32" fill="none">
    <path d="M12 26c-3.3 0-6-2.7-6-6 0-2.8 1.9-5.1 4.5-5.8C11.3 10.3 14.8 8 19 8c4.8 0 8.8 3.2 10 7.5 3.2.5 5.5 3.2 5.5 6.5 0 3.6-2.9 6.5-6.5 6.5H12z" stroke="#0ea5e9" strokeWidth="1.5" fill="rgba(14,165,233,0.08)" />
  </svg>
);

const AntennaIcon = ({ size = ICON_SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <path d="M20 16v18" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M13 34h14" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="20" cy="15" r="3" fill="#f59e0b" />
    <path d="M12 12a11 11 0 0 1 16 0" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
    <path d="M7 7a18 18 0 0 1 26 0" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
  </svg>
);

const ICON_MAP = {
  switch: SwitchSvgIcon,
  router: RouterIcon,
  firewall: FirewallIcon,
  server: ServerIcon,
  pc: PcIcon,
  cloud: CloudIcon,
  antenna: AntennaIcon,
};

// Dokunmatikte 6px'lik tutamaci parmakla yakalamak imkansiz; 12px'e cikiyor.
// (Tutamaklar reactflow'un kendi CSS'inde pointer-events:none; yalnizca nodesConnectable
//  acikken .connectionindicator sinifiyla tiklanabilir hale gelirler - kilitliyken
//  buyumeleri dokunuslari calmaz.)
const handleStyle = (rgb, touch) => ({
  background: `rgb(${rgb})`,
  width: touch ? 12 : 6,
  height: touch ? 12 : 6,
  border: '1px solid var(--bg-dark)'
});

function SwitchNode({ data }) {
  const [hovered, setHovered] = useState(false);
  // hover:none -> hover ile ACILAN icerik hicbir zaman gorunmez; IP kalici olmali
  const { isTouch } = useViewport();
  const IconComponent = ICON_MAP[data.type] || ICON_MAP.switch;
  const rgb = TYPE_COLOR[data.type] || TYPE_COLOR.switch;
  const shape = TYPE_SHAPE[data.type] || 'rect';
  const isDown = data.status !== 'UP';
  const isAntenna = data.type === 'antenna';

  return (
    <div
      className="topology-node"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Cihaz şekli: tip rengine göre dikdörtgen / yuvarlak / elips */}
      <div
        className={`node-shape ${shape}`}
        style={{
          borderColor: isDown ? 'var(--danger)' : `rgba(${rgb}, 0.9)`,
          borderStyle: isDown ? 'dashed' : 'solid', // renk dışı ipucu (renk körlüğü için)
          background: `linear-gradient(160deg, rgba(${rgb}, ${isDown ? 0.06 : 0.18}), rgba(${rgb}, 0.04)), var(--node-bg)`,
          boxShadow: isDown
            ? '0 0 10px rgba(239,68,68,0.35), 0 4px 12px rgba(0,0,0,0.3)'
            : `0 0 10px rgba(${rgb}, 0.22), 0 4px 12px rgba(0,0,0,0.3)`,
          opacity: isDown ? 0.75 : 1,
          // NOT: dokunma hedefi burada BUYUTULMEZ. Sekli 40px yapmak .topology-node'un
          // (flex column) kutusunu buyutuyor, konumlar sabit oldugu icin dugumler
          // birbirine giriyordu; ayrica inline stil .zoom-minimal'in 24px'e kucultmesini
          // eziyordu. Hedef artik responsive.css'te .node-shape::after ile buyutuluyor:
          // position:absolute oldugu icin akis disidir, duzeni hic etkilemez.
        }}
      >
        <Handle type="source" position={Position.Top} id="top" style={handleStyle(rgb, isTouch)} />
        <Handle type="source" position={Position.Left} id="left" style={handleStyle(rgb, isTouch)} />
        <Handle type="source" position={Position.Right} id="right" style={handleStyle(rgb, isTouch)} />
        <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle(rgb, isTouch)} />

        <span className="node-icon">
          {/* Sekil masaustuyle ayni 26px oldugu icin ikon da ayni: 18px 23px'lik ic
              bosluga sigmiyordu. */}
          <IconComponent status={data.status} size={isAntenna ? 12 : ICON_SIZE} />
        </span>
      </div>

      {/* Hostname — şeklin dışında, altında. Antende HİÇ gösterilmez (masaüstü de böyle):
          dokunmatikte açılmıştı ama .topology-node bir flex column olduğu için uzun AP
          adları düğüm kutusunu genişletip komşularının üstüne biniyordu. */}
      {!isAntenna && <div className="node-label">{data.label}</div>}

      {/* IP — masaüstünde hover'da (antenler dahil, değişmedi).
          Dokunmatikte hover yok, o yüzden kalıcı; ama YALNIZCA switch'lerde. Antende
          şekil dışında hiçbir şey çizilmez, yakınlaşınca kalabalık yapan buydu. */}
      {(isTouch ? !isAntenna : hovered) && data.ip && (
        <div className="node-ip-hover" style={{ color: `rgb(${rgb})` }}>{data.ip}</div>
      )}
    </div>
  );
}

// Yalnızca gerçekten render edilen alanlar değişince yeniden çiz (data kimliği değişse bile)
export default memo(SwitchNode, (p, n) => {
  const a = p.data, b = n.data;
  return a.label === b.label && a.ip === b.ip && a.status === b.status && a.type === b.type;
});
