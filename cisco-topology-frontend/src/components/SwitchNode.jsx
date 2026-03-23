import { Handle, Position } from 'reactflow';

const SwitchIcon = () => (
  <svg width="50" height="14" viewBox="0 0 50 14" style={{ marginBottom: 5, filter: 'drop-shadow(0 0 4px var(--primary))' }}>
    <rect width="50" height="14" rx="2" fill="var(--bg-dark)" stroke="var(--primary)" strokeWidth="1.5" />
    <circle cx="8" cy="7" r="1.5" fill="var(--success)" />
    <circle cx="15" cy="7" r="1.5" fill="var(--success)" />
    <circle cx="22" cy="7" r="1.5" fill="var(--success)" />
    <circle cx="29" cy="7" r="1.5" fill="var(--success)" />
    <circle cx="36" cy="7" r="1.5" fill="var(--success)" />
    <rect x="42" y="4.5" width="5" height="5" rx="0.5" fill="#f59e0b" />
  </svg>
);

const ICONS = {
  router: '🌐',
  firewall: '🛡️',
  server: '🗄️',
  pc: '💻',
  cloud: '☁️'
};

export default function SwitchNode({ data }) {
  return (
    <div className={`topology-node ${data.status === 'UP' ? 'up' : 'down'}`}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--primary)', width: 10, height: 10 }} />
      <div className="node-icon" style={{ lineHeight: 0 }}>
        {data.type === 'switch' ? <SwitchIcon /> : (ICONS[data.type] || '❓')}
      </div>
      <div className="node-label">{data.label}</div>
      <div className="node-ip">{data.ip}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--primary)', width: 10, height: 10 }} />
    </div>
  );
}
