import { useViewport } from '../hooks/useViewport';

// Yay yolu iki durumda da (yukleniyor / normal) ayni.
const ARC_PATH = 'M 10 50 A 40 40 0 0 1 90 50';

export default function Gauge({ value, label, color, loading, compact: compactProp }) {
  const { isPhone, isShort } = useViewport();
  // Dar govde: telefon VEYA kisa ekran (ya da ebeveyn yan-yana dizdiyse).
  // Masaustunde ucu de false -> asagidaki tum olculer eski degerlerine birebir esit.
  const compact = Boolean(compactProp) || isPhone || isShort;

  const radius = 35;
  const arcLength = Math.PI * radius;
  const strokeDashoffset = arcLength * (1 - value / 100);

  // MASAUSTU DEGERLERI AYNEN KORUNUR; sadece dar govdede akiskan olcuye geciyoruz.
  const wrapStyle = compact
    ? { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '12px 8px', minWidth: 0 }
    : { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '10px' };

  const labelStyle = compact
    ? { margin: '0 0 6px 0', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' }
    : { margin: '0 0 10px 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase' };

  // Dar govdede width/height ozniteligi YOK: kart genisligini doldurur, orani viewBox verir.
  // Masaustunde 120x80 sabit kalir (viewBox 100x60 -> 4px ust/alt mektup kutusu dahil).
  const svgProps = compact
    ? { style: { width: '100%', maxWidth: 140, height: 'auto', overflow: 'visible' } }
    : { width: '120', height: '80', style: { overflow: 'visible' } };

  // height:auto'da mektup kutusu kalmadigi icin negatif margin bir tik daha buyuk.
  const valueMarginTop = compact ? '-11px' : '-10px';

  // SNMP verisi henüz gelmedi: 0% göstermek yerine "yükleniyor" izlenimi ver (yanıltıcı olmasın).
  if (loading) {
    return (
      <div className="chart-container" style={wrapStyle}>
        <h4 style={labelStyle}>{label}</h4>
        <svg viewBox="0 0 100 60" {...svgProps}>
          <path d={ARC_PATH} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="10" strokeLinecap="round" />
        </svg>
        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: valueMarginTop, color: 'var(--text-muted)', opacity: 0.6 }}>…</div>
      </div>
    );
  }

  return (
    <div className="chart-container" style={wrapStyle}>
      <h4 style={labelStyle}>{label}</h4>
      <svg viewBox="0 0 100 60" {...svgProps}>
        <path d={ARC_PATH} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="10" strokeLinecap="round" />
        <path
          d={ARC_PATH}
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
      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: valueMarginTop, color }}>{value}%</div>
    </div>
  );
}
