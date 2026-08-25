import { useState } from 'react';
import { normalizeServerInput, probeServer, setServerUrl, setAuthToken, getServerUrl } from './state';
import { applyServerBase } from '../config';
import { t } from '../i18n';

// Mobil uygulamanin ilk acilis ekrani: sunucu adresi.
//
// APK her musteride ayni oldugu icin sunucu adresi derleme aninda gomulemez.
// Adres bir kez girilir, cihazda saklanir; sonraki aciliMslarda dogrudan giris
// ekrani gelir. Ayarlar > "Sunucuyu degistir" ile buraya geri donulebilir.
const labelStyle = {
  display: 'block', marginBottom: 6,
  fontSize: '0.75rem', fontWeight: 600,
  color: 'var(--text-muted)', letterSpacing: '0.3px',
};

export default function ServerSetup({ onDone, onCancel }) {
  const [value, setValue] = useState(getServerUrl() || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const normalized = normalizeServerInput(value);
    if (!normalized) { setError(t('srvInvalid')); return; }
    setError('');
    setBusy(true);
    try {
      const url = await probeServer(normalized);
      if (!url) { setError(t('srvUnreachable')); return; }
      // Sunucu degisti: eski sunucunun token'i burada gecersizdir.
      if (url !== getServerUrl()) await setAuthToken('');
      await setServerUrl(url);
      applyServerBase();
      onDone(url);
    } catch {
      setError(t('srvUnreachable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-orb rw-hide-short" />
      <div className="login-card">
        <div style={{ marginBottom: 24 }}>
          <img src="/app-icon.png" alt="NetPulse"
            style={{ width: 68, height: 68, marginBottom: 8, filter: 'drop-shadow(0 0 14px var(--primary))' }} />
          <h1 style={{ margin: '0 0 6px', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.5px' }}>
            {t('srvTitle')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
            {t('srvSubtitle')}
          </p>
        </div>

        <form onSubmit={submit} style={{ textAlign: 'left' }}>
          {error && (
            <div className="login-error">
              <span style={{ marginRight: 8, flexShrink: 0 }}>✕</span>{error}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label htmlFor="srv-addr" style={labelStyle}>{t('srvAddress')}</label>
            <input
              id="srv-addr"
              className="modern-input"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={t('srvPlaceholder')}
              /* url klavyesi: '/' ve '.' dogrudan erisilebilir, otomatik
                 duzeltme/buyuk harf kapali — adres bozulmasin. */
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              {t('srvHint')}
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}
            style={{ width: '100%', minHeight: 48 }}>
            {busy ? t('srvConnecting') : t('srvConnect')}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}
              style={{ width: '100%', marginTop: 10, minHeight: 44 }}>
              {t('cancel')}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
