import { t } from '../i18n';

// Ping/Trace için tek yuvarlak play/stop butonu: boşta ▶ (başlat), çalışırken ■ (durdur, kırmızı).
// Net SVG ikonlar (emoji render sorunları olmadan), gölge + basınca hafif küçülme.
export default function PlayStopButton({ running, onStart, onStop, disabled = false }) {
  const off = !running && disabled; // boştayken geçersiz IP → pasif (çalışırken hep aktif = durdurulabilir)
  return (
    <button
      type="button"
      className="playstop-btn"
      onClick={running ? onStop : onStart}
      disabled={off}
      title={running ? t('stopBtn') : t('startBtn')}
      aria-label={running ? t('stopBtn') : t('startBtn')}
      style={{
        width: 40, height: 40, flexShrink: 0, borderRadius: '50%', border: 'none', padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.4 : 1,
        background: running ? 'var(--danger)' : 'var(--primary)',
        boxShadow: running ? '0 3px 12px rgba(239,68,68,0.45)' : '0 3px 12px rgba(56,189,248,0.40)',
        transition: 'transform .12s ease, background .15s ease, box-shadow .15s ease',
      }}
      onMouseDown={e => { if (!off) e.currentTarget.style.transform = 'scale(0.9)'; }}
      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {running ? (
        // durdur: yuvarlatılmış kare
        <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect width="12" height="12" rx="2.5" />
        </svg>
      ) : (
        // başlat: sağa bakan üçgen (optik ortalama için hafif sağa kaydırıldı)
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ marginLeft: 2 }}>
          <path d="M5 3l8 5-8 5z" />
        </svg>
      )}
    </button>
  );
}
