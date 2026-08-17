import { useState, useEffect, useCallback, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

/* ============================================================================
   ZORUNLU 2FA KURULUMU — engelleyici kapi (ForcePasswordChange deseni)

   "admin" bu hesap icin 2FA'yi zorunlu kildiginda gosterilir. Kullanici, QR'i
   okutup dogru kodu girene VE kurtarma kodlarini kaydettigini onaylayana kadar
   uygulamayi kullanamaz. Ekran girisTEN SONRA gelir (oturum acilmistir), tipki
   mustChangePassword gibi.
   ========================================================================== */

/** otpauth URI -> SVG QR. Modul kapsaminda (her render'da remount olmasin). */
function QrSvg({ text, size = 190 }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [text]);
  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${path.n + 2} ${path.n + 2}`}
      style={{ background: '#fff', borderRadius: 8, display: 'block', margin: '0 auto' }} aria-label="QR code">
      <path d={path.d} fill="#000" />
    </svg>
  );
}

export default function ForceTwoFactorSetup({ onComplete }) {
  const { authFetch, logout } = useAuth();
  const { isPhone, isTouch } = useViewport();

  const [setup, setSetup] = useState(null);   // { secret, uri }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);   // kurtarma kodlari — kaydedilene kadar bekletir
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Ekran acilinca secret'i uret (henuz aktiflestirmez)
  const begin = useCallback(async () => {
    setError('');
    const r = await authFetch('/2fa/setup', { method: 'POST' });
    const d = r ? await r.json().catch(() => ({})) : {};
    if (r && r.ok) setSetup(d);
    else setError((d && d.error) || 'Could not start setup');
  }, [authFetch]);

  useEffect(() => { begin(); }, [begin]);

  const enable = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await authFetch('/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
      const d = r ? await r.json().catch(() => ({})) : {};
      if (r && r.ok) { setCodes(d.recoveryCodes); setCode(''); }
      else setError((d && d.error) || 'Invalid code');
    } finally { setBusy(false); }
  };

  const copyCodes = () => {
    const text = (codes || []).join('\n');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(() => {});
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (err) { /* ignore */ }
      ta.remove();
    }
    showToast('Recovery codes copied', 'success');
  };

  const finish = () => { showToast('Two-factor enabled', 'success'); onComplete(); };

  const label = { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 'min(460px, 100%)' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div className="rw-hide-short" style={{
            width: 48, height: 48, borderRadius: 12, background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '1.4rem', margin: '0 auto 14px',
          }}>🔐</div>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 700 }}>Two-Factor Setup Required</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            An administrator requires two-factor authentication on your account.
          </p>
        </div>

        {error && (
          <div className="login-error" style={{ marginBottom: 14 }}>
            <span style={{ marginRight: 8 }}>✕</span>{error}
          </div>
        )}

        {/* --- Adim 2: kurtarma kodlari (aktiflestikten sonra) --- */}
        {codes ? (
          <div>
            <div style={{ border: '1px solid var(--warning)', background: 'rgba(245,158,11,0.08)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>Save these recovery codes</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                Shown <strong>only once</strong>, each works a single time. Without them, losing your phone
                locks you out — and only the admin can reset it.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr 1fr' : 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {codes.map(c => <span key={c} style={{ background: 'rgba(0,0,0,0.25)', padding: '6px 8px', borderRadius: 6, textAlign: 'center' }}>{c}</span>)}
              </div>
            </div>
            <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 10 }} onClick={copyCodes}>Copy codes</button>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={finish}>I have saved them — continue</button>
          </div>
        ) : setup ? (
          /* --- Adim 1: QR + kod --- */
          <form onSubmit={enable}>
            <QrSvg text={setup.uri} size={isPhone ? 160 : 180} />
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5, textAlign: 'center', margin: '12px 0' }}>
              Scan with Duo Mobile, Google Authenticator, Microsoft Authenticator or Authy, then enter the code.
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
              <code style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: 6, overflowWrap: 'anywhere' }}>
                {showSecret ? setup.secret : '•'.repeat(24)}
              </code>
              <button type="button" className="btn btn-ghost btn-sm rw-tap" onClick={() => setShowSecret(v => !v)}>{showSecret ? 'Hide' : 'Key'}</button>
            </div>
            <label style={label} htmlFor="f2fa-code">Code from the app</label>
            <input id="f2fa-code" className="modern-input" value={code} onChange={e => setCode(e.target.value)}
              placeholder="000000" inputMode="numeric" autoComplete="one-time-code"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
              autoFocus={!isTouch} style={{ letterSpacing: '0.25em', fontFamily: 'monospace', textAlign: 'center' }} />
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} disabled={busy || !code.trim()}>
              {busy ? 'Verifying…' : 'Verify & enable'}
            </button>
          </form>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Preparing…</div>
        )}

        {/* Kapiya kisilip kalmasin: cikis her zaman mumkun */}
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 14 }} onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
