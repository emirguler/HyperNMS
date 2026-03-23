import { t } from '../i18n';

export default function GeoMapPage() {
  return (
    <div className="list-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '4rem', marginBottom: 16, opacity: 0.3 }}>🌍</div>
        <h2 style={{ margin: '0 0 8px', color: 'var(--text-main)' }}>{t('geoMap')}</h2>
        <p style={{ fontSize: '0.9rem' }}>{t('geoMapWip')}</p>
      </div>
    </div>
  );
}
