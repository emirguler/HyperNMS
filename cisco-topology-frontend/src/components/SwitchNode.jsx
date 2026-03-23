import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';

// --- Profesyonel SVG İkonlar ---
const RouterIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="16" stroke="var(--primary)" strokeWidth="2" fill="rgba(56,189,248,0.08)" />
    <path d="M12 20h16M20 12v16M14 14l12 12M26 14L14 26" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    <circle cx="20" cy="20" r="4" fill="var(--primary)" />
  </svg>
);

const FirewallIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <rect x="6" y="8" width="28" height="24" rx="3" stroke="#ef4444" strokeWidth="2" fill="rgba(239,68,68,0.08)" />
    <rect x="6" y="8" width="28" height="8" rx="3" fill="rgba(239,68,68,0.15)" />
    <line x1="6" y1="20" x2="34" y2="20" stroke="#ef4444" strokeWidth="1.5" />
    <line x1="20" y1="8" x2="20" y2="32" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
  </svg>
);

const ServerIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
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

const SwitchSvgIcon = ({ status }) => (
  <svg width="48" height="28" viewBox="0 0 48 28" fill="none">
    <rect x="1" y="1" width="46" height="26" rx="4" stroke="var(--primary)" strokeWidth="1.5" fill="rgba(56,189,248,0.06)" />
    <rect x="4" y="5" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <rect x="12" y="5" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <rect x="20" y="5" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <rect x="28" y="5" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <rect x="36" y="5" width="6" height="3" rx="1" fill={status === 'UP' ? '#f59e0b' : '#64748b'} />
    <rect x="4" y="12" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <rect x="12" y="12" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <rect x="20" y="12" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <rect x="28" y="12" width="6" height="3" rx="1" fill={status === 'UP' ? '#34d399' : '#64748b'} />
    <circle cx="40" cy="20" r="3" fill="none" stroke={status === 'UP' ? '#34d399' : '#ef4444'} strokeWidth="1.5" />
    <circle cx="40" cy="20" r="1" fill={status === 'UP' ? '#34d399' : '#ef4444'} />
  </svg>
);

const PcIcon = () => (
  <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
    <rect x="4" y="4" width="28" height="20" rx="2" stroke="#64748b" strokeWidth="1.5" fill="rgba(100,116,139,0.08)" />
    <rect x="7" y="7" width="22" height="14" rx="1" fill="rgba(56,189,248,0.1)" />
    <line x1="18" y1="24" x2="18" y2="30" stroke="#64748b" strokeWidth="1.5" />
    <line x1="12" y1="30" x2="24" y2="30" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const CloudIcon = () => (
  <svg width="44" height="32" viewBox="0 0 44 32" fill="none">
    <path d="M12 26c-3.3 0-6-2.7-6-6 0-2.8 1.9-5.1 4.5-5.8C11.3 10.3 14.8 8 19 8c4.8 0 8.8 3.2 10 7.5 3.2.5 5.5 3.2 5.5 6.5 0 3.6-2.9 6.5-6.5 6.5H12z" stroke="#0ea5e9" strokeWidth="1.5" fill="rgba(14,165,233,0.08)" />
  </svg>
);

const ICON_MAP = {
  switch: SwitchSvgIcon,
  router: RouterIcon,
  firewall: FirewallIcon,
  server: ServerIcon,
  pc: PcIcon,
  cloud: CloudIcon,
};

// Latency badge rengi
function latencyColor(latency) {
  if (!latency || latency < 0) return 'var(--text-muted)';
  if (latency <= 20) return '#34d399';
  if (latency <= 80) return '#f59e0b';
  return '#ef4444';
}

function SwitchNode({ data }) {
  const [hovered, setHovered] = useState(false);
  const IconComponent = ICON_MAP[data.type] || ICON_MAP.switch;
  const isDown = data.status !== 'UP';

  return (
    <div
      className={`topology-node ${isDown ? 'down' : 'up'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: 170, height: 'auto', minHeight: 100, padding: '10px 8px 8px' }}
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--primary)', width: 10, height: 10 }} />

      {/* Pulse animasyonu (DOWN cihazlar) */}
      {isDown && <div className="node-pulse-ring" />}

      {/* Latency badge */}
      {data.latency != null && data.latency > 0 && (
        <div style={{
          position: 'absolute', top: -8, right: -8,
          background: latencyColor(data.latency), color: '#0f172a',
          fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px',
          borderRadius: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
          zIndex: 10
        }}>
          {data.latency}ms
        </div>
      )}

      {/* İkon */}
      <div className="node-icon" style={{ lineHeight: 0, display: 'flex', justifyContent: 'center' }}>
        <IconComponent status={data.status} />
      </div>

      {/* İsim ve IP */}
      <div className="node-label">{data.label}</div>
      <div className="node-ip">{data.ip}</div>

      {/* Mini CPU/RAM bar */}
      {data.cpu != null && data.cpu > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4, padding: '0 8px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginBottom: 1 }}>CPU</div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${data.cpu}%`, height: '100%', background: data.cpu > 80 ? '#ef4444' : 'var(--primary)', borderRadius: 2, transition: 'width 1s' }} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginBottom: 1 }}>RAM</div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${data.ram || 0}%`, height: '100%', background: (data.ram || 0) > 80 ? '#ef4444' : '#8b5cf6', borderRadius: 2, transition: 'width 1s' }} />
            </div>
          </div>
        </div>
      )}

      {/* Tag chip'leri */}
      {data.tags && data.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 4, justifyContent: 'center', padding: '0 4px' }}>
          {data.tags.slice(0, 3).map(tag => (
            <span key={tag} style={{
              background: 'rgba(99,102,241,0.2)', color: 'var(--primary)',
              padding: '1px 5px', borderRadius: 6, fontSize: '0.5rem', fontWeight: 600
            }}>{tag}</span>
          ))}
        </div>
      )}

      {/* Hover Tooltip */}
      {hovered && data.uptime && (
        <div className="node-tooltip">
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Vendor: <strong style={{ color: 'var(--text-main)' }}>{data.vendor || 'Unknown'}</strong></div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Uptime: <strong style={{ color: 'var(--text-main)' }}>{data.uptime}</strong></div>
          {data.cpu > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CPU: <strong style={{ color: data.cpu > 80 ? 'var(--danger)' : 'var(--text-main)' }}>{data.cpu}%</strong></div>}
          {data.ram > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>RAM: <strong style={{ color: data.ram > 80 ? 'var(--danger)' : 'var(--text-main)' }}>{data.ram}%</strong></div>}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--primary)', width: 10, height: 10 }} />
    </div>
  );
}

export default memo(SwitchNode);
