import { useState, useEffect, useCallback, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

/* ============================================================================
   IKI ASAMALI DOGRULAMA (TOTP) — Settings > Security

   QR, otpauth:// URI'sinden ISTEMCIDE uretilir; secret sunucudan tek seferlik
   alinip ekranda kalir, hicbir yere gonderilmez. Duo Mobile, Google/Microsoft
   Authenticator ve Authy ayni QR'i okur.
   ========================================================================== */

/** otpauth URI -> SVG. Modul kapsaminda: her render'da yeniden mount olmasin. */
function QrSvg({ text, size = 190 }) {
  const path = useMemo(() => {
    // Tip 0 = otomatik boyut, 'M' = orta hata duzeltme (kamera icin fazlasiyla yeterli)
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { d, n };
  }, [text]);

  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${path.n + 2} ${path.n + 2}`}
      style={{ background: '#fff', borderRadius: 8, display: 'block' }} aria-label="QR code">
      <path d={path.d} fill="#000" />
    </svg>
  );
}

const codeInputStyle = { letterSpacing: '0.25em', fontFamily: 'monospace', textAlign: 'center' };

export default function TwoFactorCard() {
  const { authFetch, isAdmin } = useAuth();
  const { isTouch, isPhone } = useViewport();

  const [status, setStatus] = useState(null);
  const [enforce, setEnforce] = useState(false);
  const [setup, setSetup] = useState(null);      // { secret, uri }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);      // kurtarma kodlari — BIR KEZ gosterilir
  const [showSecret, setShowSecret] = useState(false);

  const load = useCallback(async () => {
    const r = await authFetch('/2fa/status');
    if (r && r.ok) setStatus(await r.json());
    if (isAdmin) {
      const s = await authFetch('/settings/security');
      if (s && s.ok) setEnforce((await s.json()).enforceAdmin2fa === true);
    }
  }, [authFetch, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const call = async (path, body) => {
    setBusy(true);
    try {
      const r = await authFetch(path, { method: 'POST', body: JSON.stringify(body || {}) });
      const d = r ? await r.json().catch(() => ({})) : {};
      if (!r || !r.ok) { showToast(d.error || 'Operation failed', 'error'); return null; }
      return d;
    } finally { setBusy(false); }
  };

  const start = async () => {
    const d = await call('/2fa/setup');
    if (d) { setSetup(d); setCode(''); setCodes(null); }
  };

  const enable = async (e) => {
    e.preventDefault();
    const d = await call('/2fa/enable', { code });
    if (d) {
      setCodes(d.recoveryCodes);
      setSetup(null);
      setCode('');
      showToast('Two-factor authentication enabled', 'success');
      load();
    }
  };

  const disable = async () => {
    const d = await call('/2fa/disable', { code });
    if (d) { setCode(''); showToast('Two-factor authentication disabled', 'success'); load(); }
  };

  const regenerate = async () => {
    const d = await call('/2fa/recovery', { code });
    if (d) { setCodes(d.recoveryCodes); setCode(''); showToast('New recovery codes generated', 'success'); load(); }
  };

  const toggleEnforce = async (on) => {
    const r = await authFetch('/settings/security', { method: 'PUT', body: JSON.stringify({ enforceAdmin2fa: on }) });
    if (r && r.ok) { setEnforce(on); load(); }
    else showToast('Could not update policy', 'error');
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

  if (!status) return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>;

  const label = { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* --- Kurtarma kodlari: yalnizca uretildikleri anda gorunur --- */}
      {codes && (
        <div style={{ border: '1px solid var(--warning)', background: 'rgba(245,158,11,0.08)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>Save these recovery codes now</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            They are shown <strong>only once</strong> — the server keeps hashes, not the codes.
            Each works a single time. Without them, losing your phone locks you out of this system.
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: isPhone ? '1fr 1fr' : 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 6, fontFamily: 'monospace', fontSize: '0.85rem', marginBottom: 10,
          }}>
            {codes.map(c => <span key={c} style={{ background: 'rgba(0,0,0,0.25)', padding: '6px 8px', borderRadius: 6, textAlign: 'center' }}>{c}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={copyCodes}>Copy</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCodes(null)}>I have saved them</button>
          </div>
        </div>
      )}

      {/* --- Durum + eylemler --- */}
      {!status.enabled && !setup && (
        <div>
          <div style={{ marginBottom: 10, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Two-factor is <strong style={{ color: 'var(--danger)' }}>off</strong> for your account.
            Once enabled, signing in asks for a 6-digit code from your authenticator app —
            Duo Mobile, Google Authenticator, Microsoft Authenticator and Authy all work.
          </div>
          <button className="btn btn-primary" onClick={start} disabled={busy}>Set up two-factor</button>
        </div>
      )}

      {/* --- Kurulum: QR + dogrulama --- */}
      {setup && (
        <form onSubmit={enable}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <QrSvg text={setup.uri} size={isPhone ? 170 : 190} />
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                Scan this with your authenticator app, then enter the code it shows to confirm.
              </div>
              <label style={label}>Can’t scan? Enter this key manually</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
                <code style={{
                  flex: 1, minWidth: 0, fontSize: '0.8rem', background: 'rgba(0,0,0,0.25)',
                  padding: '8px 10px', borderRadius: 6, overflowWrap: 'anywhere',
                }}>{showSecret ? setup.secret : '•'.repeat(32)}</code>
                <button type="button" className="btn btn-ghost btn-sm rw-tap" onClick={() => setShowSecret(v => !v)}>
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
              <label style={label} htmlFor="tfa-code">Code from the app</label>
              <input id="tfa-code" className="modern-input" value={code} onChange={e => setCode(e.target.value)}
                placeholder="000000" inputMode="numeric" autoComplete="one-time-code"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
                autoFocus={!isTouch} style={codeInputStyle} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>Verify & enable</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
              </div>
            </div>
          </div>
        </form>
      )}

      {status.enabled && (
        <div>
          <div style={{ marginBottom: 12, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Two-factor is <strong style={{ color: 'var(--success)' }}>on</strong> for your account.
            {' '}<strong>{status.recoveryRemaining}</strong> recovery code{status.recoveryRemaining === 1 ? '' : 's'} left.
          </div>
          <label style={label} htmlFor="tfa-confirm">Current code (or a recovery code)</label>
          <input id="tfa-confirm" className="modern-input" value={code} onChange={e => setCode(e.target.value)}
            placeholder="000000" inputMode="numeric" autoComplete="one-time-code"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            style={{ ...codeInputStyle, maxWidth: 220 }} />
          <div className="rw-actions" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={regenerate} disabled={busy || !code.trim()}>New recovery codes</button>
            {/* Politika adminler icin zorunlu kildiysa kapatma dugmesi anlamsiz */}
            {!(status.enforced && isAdmin) && (
              <button className="btn btn-danger" onClick={disable} disabled={busy || !code.trim()}>Turn off</button>
            )}
          </div>
          {status.enforced && isAdmin && (
            <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: 8 }}>
              Policy requires two-factor for administrators, so it cannot be turned off.
            </div>
          )}
        </div>
      )}

      {/* --- Politika (yalnizca admin) --- */}
      {isAdmin && (
        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          borderTop: '1px solid var(--border-color)', paddingTop: 14,
          minHeight: isTouch ? 44 : undefined, cursor: 'pointer',
        }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Require two-factor for all administrators
            </span>
            <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Administrators without it are prompted to set it up at sign-in.
            </span>
          </span>
          <span className="toggle-switch" style={{ flexShrink: 0 }}>
            <input type="checkbox" checked={enforce} onChange={e => toggleEnforce(e.target.checked)} />
            <span className="toggle-slider" />
          </span>
        </label>
      )}
    </div>
  );
}
