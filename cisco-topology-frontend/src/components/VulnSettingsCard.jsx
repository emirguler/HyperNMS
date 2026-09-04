import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';
import { t } from '../i18n';

// Zafiyet senkron ayarlari (Settings → Vulnerability sync): Cisco PSIRT openVuln
// API kimligi + gunluk zamanlama + host bazli baglanti testi. AdSettingsCard deseni.
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function VulnSettingsCard() {
  const { authFetch } = useAuth();
  const { isPhone, isShort } = useViewport();
  const compact = isPhone || isShort;
  const [form, setForm] = useState({ clientId: '', clientSecret: '', autoSync: false, syncHour: 4 });
  const [secretSet, setSecretSet] = useState(false);
  const [hosts, setHosts] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState(null); // [{host, ok, message}]

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/settings/vuln');
        if (res && res.ok) {
          const d = await res.json();
          setForm({ clientId: d.clientId || '', clientSecret: '', autoSync: !!d.autoSync, syncHour: d.syncHour ?? 4 });
          setSecretSet(!!d.clientSecretSet); setHosts(d.hosts || []); setLastSync(d.lastSync || null);
        }
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [authFetch]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await authFetch('/settings/vuln', { method: 'PUT', body: JSON.stringify(form) });
      const d = await res.json().catch(() => ({}));
      if (res && res.ok) { showToast(t('vulnSetSaved'), 'success'); setSecretSet(!!d.clientSecretSet); set('clientSecret', ''); }
      else showToast(d.error || t('operationFailed'), 'error');
    } catch { showToast(t('operationFailed'), 'error'); } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setResults(null);
    try {
      const res = await authFetch('/settings/vuln/test', { method: 'POST', body: JSON.stringify({ clientId: form.clientId, clientSecret: form.clientSecret }) });
      const d = await res.json().catch(() => ({}));
      if (res && res.ok) setResults(d.results || []);
      else setResults([{ host: '—', ok: false, message: d.error || t('operationFailed') }]);
    } catch { setResults([{ host: '—', ok: false, message: t('operationFailed') }]); } finally { setTesting(false); }
  };

  const lbl = compact
    ? { display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: 4 }
    : { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('vulnSetIntro')}</p>

      {loading ? <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>…</div> : (
        <>
          <div className="grid-2col" style={{ gap: 10, marginBottom: 10 }}>
            <div>
              <label style={lbl}>Client ID (Key)</label>
              <input className="modern-input" style={{ width: '100%', fontFamily: 'monospace' }} value={form.clientId} onChange={e => set('clientId', e.target.value)}
                autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
            <div>
              <label style={lbl}>Client Secret</label>
              <input className="modern-input" style={{ width: '100%', fontFamily: 'monospace' }} type="password" value={form.clientSecret} onChange={e => set('clientSecret', e.target.value)}
                autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder={secretSet ? '•••••••• (unchanged)' : ''} />
            </div>
          </div>
          <p style={{ fontSize: compact ? '13px' : '0.72rem', color: 'var(--text-dim)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {t('vulnSetWhere')} <span style={{ fontFamily: 'monospace' }}>apiconsole.cisco.com</span> → Register a New App → <em>Cisco PSIRT openVuln API</em>.
          </p>

          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem', color: 'var(--text-main)', cursor: 'pointer', minHeight: compact ? 44 : undefined }}>
              <input type="checkbox" checked={form.autoSync} onChange={e => set('autoSync', e.target.checked)} /> {t('vulnSetAuto')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {t('vulnSetHour')}
              <select className="modern-input" value={form.syncHour} onChange={e => set('syncHour', parseInt(e.target.value, 10))} style={{ width: 90 }} disabled={!form.autoSync}>
                {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
          </div>

          {/* Egress ipucu + baglanti testi */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: compact ? '13px' : '0.72rem', color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
              {t('vulnSetHosts')}: {hosts.map(h => <code key={h} style={{ marginRight: 6, fontSize: '0.78rem' }}>{h}</code>)}
            </div>
            <button className="btn btn-ghost" onClick={test} disabled={testing || !form.clientId || (!form.clientSecret && !secretSet)} style={{ width: isPhone ? '100%' : undefined }}>
              {testing ? t('vulnSetTesting') : t('vulnSetTest')}
            </button>
            {results && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 11px', borderRadius: 8, fontSize: '0.8rem',
                    background: r.ok ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)', border: `1px solid ${r.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    color: r.ok ? 'var(--success)' : 'var(--danger)' }}>
                    <span style={{ flexShrink: 0 }}>{r.ok ? '✓' : '✕'}</span>
                    <span style={{ fontFamily: 'monospace', flexShrink: 0, minWidth: 120 }}>{r.host}</span>
                    <span style={{ color: 'var(--text-main)', overflowWrap: 'anywhere' }}>{r.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {lastSync && (
            <div style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {t('vulnLastSync')}: {new Date(lastSync.at).toLocaleString()} · {lastSync.ok ? `✓ ${lastSync.stats ? `${lastSync.stats.advisories} ${t('vulnAdvisories').toLowerCase()}, ${lastSync.stats.versions} ${t('vulnVersions').toLowerCase()}` : ''}` : `✕ ${lastSync.error}`}
              {lastSync.warnings && lastSync.warnings.length > 0 && <div style={{ color: 'var(--warning)', marginTop: 4 }}>{lastSync.warnings.join(' · ')}</div>}
            </div>
          )}

          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ width: '100%', marginTop: 14 }}>
            {saving ? t('licApplying') : t('vulnSetSave')}
          </button>
        </>
      )}
    </div>
  );
}
