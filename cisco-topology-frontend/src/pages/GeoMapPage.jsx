import { t } from '../i18n';
import { useViewport } from '../hooks/useViewport';

export default function GeoMapPage() {
  const { isPhone, isShort } = useViewport();
  const compact = isPhone || isShort;

  return (
    // Harita kabı: dar gövdede responsive.css .app-container > main > * öğesine flex:1
    // verdiği için height:100% tek başına çökmesin diye minHeight ile destekleniyor.
    // Gerçek harita geldiğinde konteyner ölçüsü buradan gelmeli — 100vh DEĞİL, çünkü
    // navbar + sekme chrome'u zaten viewport'un bir kısmını yiyor.
    <div
      className="list-container"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%',
        minHeight: compact ? '50vh' : undefined,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', maxWidth: '100%', minWidth: 0 }}>
        <div style={{ fontSize: compact ? '2.6rem' : '4rem', marginBottom: compact ? 10 : 16, opacity: 0.3 }}>🌍</div>
        <h2 style={{ margin: '0 0 8px', color: 'var(--text-main)', fontSize: isShort ? '1.2rem' : undefined }}>{t('geoMap')}</h2>
        {/* margin sıfırlaması yalnızca dar gövdede: masaüstünde <p>'nin varsayılan
            alt boşluğu blogu birkaç piksel yukarı itiyordu, o görünüm korunmalı */}
        <p style={{ fontSize: '0.9rem', ...(compact ? { margin: 0 } : null) }}>{t('geoMapWip')}</p>
      </div>
    </div>
  );
}
