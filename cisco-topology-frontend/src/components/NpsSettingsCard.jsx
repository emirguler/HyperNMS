import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

// NPS (Linux FreeRADIUS) SSH ayarlari — Settings modali icinde.
// Sifre asla geri gonderilmez; "kayitli" ise placeholder gosterilir.
export default function NpsSettingsCard() {
  const { authFetch } = useAuth();
  // "dar govde" = telefon VEYA kisa ekran; AD kartiyla ayni esik.
  const { isPhone, isShort } = useViewport();
  const compact = isPhone || isShort;

  const [form, setForm] = useState({ host: '', port: 22, username: '', password: '' });
  const [passwordSet, setPasswordSet] = useState(false);
  const [usersFile, setUsersFile] = useState('/etc/freeradius/3.0/users');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, message }

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/nps/config');
        if (res && res.ok) {
          const d = await res.json();
          setForm({ host: d.host || '', port: d.port || 22, username: d.username || '', password: '' });
          setPasswordSet(!!d.passwordSet);
          if (d.usersFile) setUsersFile(d.usersFile);
        }
      } catch (e) { /* ignore */ } finally { setLoading(false); }
    })();
  }, [authFetch]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await authFetch('/nps/config', { method: 'PUT', body: JSON.stringify(form) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { showToast('NPS settings saved', 'success'); setPasswordSet(!!d.passwordSet); set('password', ''); }
      else showToast(d.error || 'Save failed', 'error');
    } catch (e) { showToast('Connection error', 'error'); } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await authFetch('/nps/config/test', { method: 'POST', body: JSON.stringify(form) });
      const d = res ? await res.json().catch(() => ({})) : {};
      setTestResult((res && res.ok && d.ok) ? { ok: true, message: d.message || 'Connected' } : { ok: false, message: d.error || 'Test failed' });
    } catch (e) { setTestResult({ ok: false, message: 'Connection error' }); } finally { setTesting(false); }
  };

  const lbl = compact
    ? { display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: 4 }
    : { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        SSH access to your Linux NPS / FreeRADIUS server. Used by the <strong>NPS</strong> page to read and edit{' '}
        <code style={{ fontSize: '0.78rem' }}>{usersFile}</code> and to restart the service. The password is stored encrypted and never leaves the server.
      </p>

      {loading ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>…</div>
      ) : (
        <>
          {/* grid: App.css <=768px'te tek kolona iner */}
          <div className="grid-2col" style={{ gap: 10, marginBottom: 10 }}>
            <div style={{ gridColumn: isPhone ? undefined : '1 / 2' }}>
              <label style={lbl}>Host (IP or name)</label>
              <input className="modern-input" style={{ width: '100%' }} value={form.host} onChange={e => set('host', e.target.value)}
                placeholder="192.168.54.1" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" />
            </div>
            <div>
              <label style={lbl}>SSH port</label>
              <input className="modern-input" style={{ width: '100%' }} type="number" min="1" max="65535" value={form.port}
                onChange={e => set('port', e.target.value)} placeholder="22" />
            </div>
          </div>
          <div className="grid-2col" style={{ gap: 10, marginBottom: 10 }}>
            <div>
              <label style={lbl}>Username</label>
              <input className="modern-input" style={{ width: '100%' }} value={form.username} onChange={e => set('username', e.target.value)}
                placeholder="root" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
            <div>
              <label style={lbl}>Password</label>
              <input className="modern-input" style={{ width: '100%' }} type="password" value={form.password}
                onChange={e => set('password', e.target.value)} autoComplete="new-password"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder={passwordSet ? '•••••••• (unchanged)' : ''} />
            </div>
          </div>
          <p style={{ fontSize: compact ? '13px' : '0.72rem', color: 'var(--text-dim)', margin: '2px 0 8px' }}>
            The SSH user must be able to read/write the users file and run <code>service freeradius restart</code> (usually <code>root</code>).
          </p>

          {/* Test */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12, marginTop: 4 }}>
            <button className="btn btn-ghost" onClick={test} disabled={testing || !form.host || !form.username}
              style={{ width: isPhone ? '100%' : undefined }}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
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
            {saving ? 'Saving…' : 'Save NPS Settings'}
          </button>
        </>
      )}
    </div>
  );
}
