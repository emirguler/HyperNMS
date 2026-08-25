import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { showToast } from '../Toast';
import { t } from '../i18n';

// Durum -> renk (etiket i18n'den)
const STATUS_COLOR = {
  demo:          { color: 'var(--primary)',   bg: 'rgba(56,189,248,0.15)', bd: 'rgba(56,189,248,0.4)' },
  demo_expired:  { color: 'var(--danger)',    bg: 'rgba(239,68,68,0.15)',  bd: 'rgba(239,68,68,0.4)' },
  valid:         { color: 'var(--success)',   bg: 'rgba(34,197,94,0.15)',  bd: 'rgba(34,197,94,0.4)' },
  expired:       { color: 'var(--danger)',    bg: 'rgba(239,68,68,0.15)',  bd: 'rgba(239,68,68,0.4)' },
  wrong_install: { color: 'var(--danger)',    bg: 'rgba(239,68,68,0.15)',  bd: 'rgba(239,68,68,0.4)' },
  invalid:       { color: 'var(--warning)',   bg: 'rgba(245,158,11,0.15)', bd: 'rgba(245,158,11,0.4)' },
  none:          { color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)', bd: 'var(--border-color)' },
};
const STATUS_LABEL = {
  demo: 'licStDemo', demo_expired: 'licStDemoExpired', valid: 'licStValid', expired: 'licStExpired',
  wrong_install: 'licStWrongInstall', invalid: 'licStInvalid', none: 'licStNone',
};

const fmtDate = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } };
const lblStyle = { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' };

export default function LicenseCard() {
  const { authFetch } = useAuth();
  const { license, fetchLicense } = useApp();
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);

  const st = license || { status: 'none', installId: '—' };
  const meta = STATUS_COLOR[st.status] || STATUS_COLOR.none;
  const statusLabel = t(STATUS_LABEL[st.status] || 'licStNone');

  const copyInstallId = async () => {
    try { await navigator.clipboard.writeText(st.installId || ''); showToast(t('licInstallCopied'), 'success'); }
    catch { showToast(t('licCopyFail'), 'error'); }
  };

  const apply = async () => {
    const key = keyInput.trim();
    if (!key) { showToast(t('licKeyRequired'), 'error'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/license', { method: 'PUT', body: JSON.stringify({ key }) });
      const data = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { showToast(t('licApplied'), 'success'); setKeyInput(''); fetchLicense(); }
      else showToast(data.error || t('licApplyFail'), 'error');
    } catch { showToast(t('licApplyFail'), 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <span style={lblStyle}>{t('licStatus')}</span>
        <span className="status-badge" style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.bd}` }}>{statusLabel}</span>
      </div>

      {st.isDemo && (
        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: st.status === 'demo_expired' ? 'var(--danger)' : 'var(--text-main)' }}>
            {st.status === 'demo_expired' ? t('licStDemoExpired') : `${t('licDemoDash')} ${st.demoDaysLeft} ${t('licDaysLeftWord')}`}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {(st.demoDays || 30)} {t('licDayTrial')}
          </div>
        </div>
      )}

      {(st.status === 'valid' || st.status === 'expired') && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px' }}>
          <div><span style={lblStyle}>{t('licCustomer')}</span><div style={{ color: 'var(--text-main)' }}>{st.customer || '—'}</div></div>
          <div><span style={lblStyle}>{t('licEdition')}</span><div style={{ color: 'var(--text-main)' }}>{st.edition || '—'}</div></div>
          <div><span style={lblStyle}>{t('licExpiry')}</span><div style={{ color: 'var(--text-main)' }}>{st.expiresAt ? fmtDate(st.expiresAt) : t('licPerpetual')}</div></div>
          <div><span style={lblStyle}>{t('licRemaining')}</span>
            <div style={{ color: st.status === 'expired' ? 'var(--danger)' : (st.daysLeft != null && st.daysLeft <= (st.warnDays || 15) ? 'var(--warning)' : 'var(--text-main)') }}>
              {st.status === 'expired' ? t('licExpiredWord') : (st.daysLeft == null ? t('licPerpetual') : `${st.daysLeft} ${t('licDaysWord')}`)}
            </div>
          </div>
        </div>
      )}

      <div>
        <span style={lblStyle}>{t('licInstallId')}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="modern-input" readOnly value={st.installId || '—'} style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: '0.8rem' }} onFocus={e => e.target.select()} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyInstallId} style={{ flexShrink: 0 }}>{t('licCopy')}</button>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('licInstallIdHint')}</div>
      </div>

      <div>
        <span style={lblStyle}>{t('licKeyLabel')}</span>
        <textarea className="modern-input" value={keyInput} onChange={e => setKeyInput(e.target.value)}
          placeholder="NLIC1...." rows={4} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          style={{ fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical' }} />
        <button type="button" className="btn btn-primary" onClick={apply} disabled={saving} style={{ marginTop: 10 }}>
          {saving ? t('licApplying') : t('licApply')}
        </button>
      </div>
    </div>
  );
}
