import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

// Active Directory / LDAP oturum acma ayarlari (Settings modali icinde).
// bindPassword asla geri gonderilmez; "kayitli" ise placeholder gosterilir.
export default function AdSettingsCard({ cardStyle, embedded }) {
  const { authFetch } = useAuth();
  // "dar govde" = telefon VEYA kisa ekran; responsive.css'teki
  // (max-width:768px),(max-height:500px) sorgusuyla birebir ayni.
  const { isPhone, isShort } = useViewport();
  const compact = isPhone || isShort;
  const [form, setForm] = useState({
    enabled: false, url: '', domain: '', baseDN: '', bindDN: '', bindPassword: '', tlsRejectUnauthorized: true,
  });
  const [bindPasswordSet, setBindPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testUser, setTestUser] = useState('');
  const [testPass, setTestPass] = useState('');
  const [testResult, setTestResult] = useState(null); // { ok, message }

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/settings/ad');
        if (res && res.ok) {
          const d = await res.json();
          setForm({
            enabled: !!d.enabled, url: d.url || '', domain: d.domain || '', baseDN: d.baseDN || '',
            bindDN: d.bindDN || '', bindPassword: '', tlsRejectUnauthorized: d.tlsRejectUnauthorized !== false,
          });
          setBindPasswordSet(!!d.bindPasswordSet);
        }
      } catch (e) { /* ignore */ } finally { setLoading(false); }
    })();
  }, [authFetch]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await authFetch('/settings/ad', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await res.json().catch(() => ({}));
      if (res && res.ok) { showToast('AD settings saved', 'success'); setBindPasswordSet(!!d.bindPasswordSet); set('bindPassword', ''); }
      else showToast(d.error || 'Save failed', 'error');
    } catch (e) { showToast('Connection error', 'error'); } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await authFetch('/settings/ad/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, testUsername: testUser, testPassword: testPass }),
      });
      const d = await res.json().catch(() => ({}));
      setTestResult((res && res.ok && d.ok) ? { ok: true, message: d.message || 'Success' } : { ok: false, message: d.error || 'Test failed' });
    } catch (e) { setTestResult({ ok: false, message: 'Connection error' }); } finally { setTesting(false); }
  };

  // Dar govdede 11.5px buyuk-harf + harf araligi hem okunmaz hem genislik yiyor:
  // 13px tabani, normal yazim.
  const lbl = compact
    ? { display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: 4 }
    : { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
  // Tum AD alanlari teknik metin: otomatik buyuk harf / duzeltme / yazim denetimi kapali.
  const field = (label, key, opts = {}) => (
    <div>
      <label style={lbl}>{label}</label>
      <input className="modern-input" style={{ width: '100%' }} value={form[key]} onChange={e => set(key, e.target.value)} autoComplete="off"
        autoCapitalize="none" autoCorrect="off" spellCheck={false} {...opts} />
    </div>
  );

  return (
    <div style={embedded ? undefined : cardStyle}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: '1.4rem' }}>🪪</span>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Active Directory (LDAP)</h3>
          </div>
        </div>
      )}
      <p style={{ margin: embedded ? '0 0 16px' : '0 0 12px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Let AD users sign in with their AD password. Only AD users you created here can log in.
      </p>

      {loading ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>…</div>
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, minHeight: compact ? 44 : undefined, fontSize: '0.88rem', color: 'var(--text-main)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
            Enable AD login
          </label>

          {/* grid-2col: App.css <=768px'te tek kolona iner (inline grid yapamazdi). */}
          <div className="grid-2col" style={{ gap: 10, marginBottom: 10 }}>
            {field('LDAP URL', 'url', { placeholder: 'ldaps://dc.isu.gov.tr:636', inputMode: 'url' })}
            {field('Domain (UPN suffix)', 'domain', { placeholder: 'isu.gov.tr' })}
          </div>
          {field('Base DN (for search)', 'baseDN', { placeholder: 'DC=isu,DC=gov,DC=tr' })}
          <div style={{ height: 10 }} />
          <p style={{ fontSize: compact ? '13px' : '0.72rem', color: 'var(--text-dim)', margin: '2px 0 8px' }}>
            Optional service account — set it to search by sAMAccountName; otherwise users bind directly as username@domain.
          </p>
          <div className="grid-2col" style={{ gap: 10, marginBottom: 10 }}>
            {field('Bind DN (service account)', 'bindDN', { placeholder: 'CN=svc-nms,OU=...,DC=...' })}
            <div>
              <label style={lbl}>Bind password</label>
              <input className="modern-input" style={{ width: '100%' }} type="password" value={form.bindPassword}
                onChange={e => set('bindPassword', e.target.value)} autoComplete="new-password"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder={bindPasswordSet ? '•••••••• (unchanged)' : ''} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, minHeight: compact ? 44 : undefined, fontSize: compact ? '0.85rem' : '0.82rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.tlsRejectUnauthorized} onChange={e => set('tlsRejectUnauthorized', e.target.checked)} />
            Verify TLS certificate (uncheck for self-signed ldaps)
          </label>

          {/* Test */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12, marginTop: 4 }}>
            <label style={lbl}>Test with an AD user (optional)</label>
            {/* 311px'lik telefon govdesinde "1fr 1fr auto" her alani ~110px'e dusuruyordu. */}
            <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
              <input className="modern-input" placeholder="username" value={testUser} onChange={e => setTestUser(e.target.value)} autoComplete="off"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <input className="modern-input" type="password" placeholder="password" value={testPass} onChange={e => setTestPass(e.target.value)} autoComplete="new-password"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" />
              <button className="btn btn-ghost" onClick={test} disabled={testing || !form.url} style={{ whiteSpace: 'nowrap', width: isPhone ? '100%' : undefined }}>
                {testing ? 'Testing…' : 'Test'}
              </button>
            </div>
            {testResult && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: '0.82rem',
                background: testResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                border: `1px solid ${testResult.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                color: testResult.ok ? 'var(--success)' : 'var(--danger)' }}>
                {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
              </div>
            )}
          </div>

          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ width: '100%', marginTop: 14 }}>
            {saving ? 'Saving…' : 'Save AD Settings'}
          </button>
        </>
      )}
    </div>
  );
}
