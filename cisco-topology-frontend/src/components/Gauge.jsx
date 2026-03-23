export default function Gauge({ value, label, color }) {
  const radius = 35;
  const arcLength = Math.PI * radius;
  const strokeDashoffset = arcLength * (1 - value / 100);

  return (
    <div className="chart-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '10px' }}>
      <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase' }}>{label}</h4>
      <svg width="120" height="80" viewBox="0 0 100 60" style={{ overflow: 'visible' }}>
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arcLength} 1000`}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <g style={{ transformOrigin: '50px 50px', transform: `rotate(${(value * 1.8) - 90}deg)`, transition: 'transform 1s ease-out' }}>
          <path d="M 50 50 L 50 15" stroke="#fff" strokeWidth="2" />
          <circle cx="50" cy="50" r="4" fill="#fff" />
        </g>
      </svg>
      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '-10px', color }}>{value}%</div>
    </div>
  );
}
