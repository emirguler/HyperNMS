import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { t } from '../i18n';

// Lisans blokeliyken (süresi dolmuş / yanlış kurulum) Dashboard dışı sayfalarda bu
// popup gösterilir; sayfa render EDİLMEZ. Navbar (⚙️ Ayarlar) açık kalır → admin
// buradan Ayarlar > Lisans ile yeni anahtarı girer.
export default function LicenseExpiredOverlay() {
  const navigate = useNavigate();
  const { license } = useApp();
  const status = license?.status;
  const title = status === 'wrong_install' ? t('licOvWrongTitle')
    : status === 'demo_expired' ? t('licOvDemoTitle')
    : t('licOvExpiredTitle');
  const message = status === 'wrong_install' ? t('licOvWrongMsg')
    : status === 'demo_expired' ? t('licOvDemoMsg')
    : t('licOvExpiredMsg');

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      background: 'rgba(2,6,20,0.72)', backdropFilter: 'blur(3px)',
    }}>
      <div style={{
        maxWidth: 440, width: '100%', textAlign: 'center',
        background: 'var(--bg-panel, #111a2e)', border: '1px solid var(--border-color)',
        borderRadius: 16, padding: '32px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: '2.4rem', lineHeight: 1, marginBottom: 12 }}>🔒</div>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.25rem', color: 'var(--text-main)' }}>{title}</h2>
        <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>{t('licBackToDashboard')}</button>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('licRenewHint')}</div>
        </div>
      </div>
    </div>
  );
}
