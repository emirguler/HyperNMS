import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { showToast } from '../Toast';

// Durum -> gorsel etiket/renk
const STATUS_META = {
  demo:          { label: 'Demo',                 color: 'var(--primary)', bg: 'rgba(56,189,248,0.15)', bd: 'rgba(56,189,248,0.4)' },
  demo_expired:  { label: 'Demo süresi doldu',    color: 'var(--danger)',  bg: 'rgba(239,68,68,0.15)', bd: 'rgba(239,68,68,0.4)' },
  valid:         { label: 'Geçerli',              color: 'var(--success)', bg: 'rgba(34,197,94,0.15)', bd: 'rgba(34,197,94,0.4)' },
  expired:       { label: 'Süresi doldu',         color: 'var(--danger)',  bg: 'rgba(239,68,68,0.15)', bd: 'rgba(239,68,68,0.4)' },
  wrong_install: { label: 'Bu kuruluma ait değil', color: 'var(--danger)',  bg: 'rgba(239,68,68,0.15)', bd: 'rgba(239,68,68,0.4)' },
  invalid:       { label: 'Geçersiz lisans',       color: 'var(--warning)', bg: 'rgba(245,158,11,0.15)', bd: 'rgba(245,158,11,0.4)' },
  none:          { label: 'Lisans girilmemiş',     color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)', bd: 'var(--border-color)' },
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
};

const lblStyle = { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' };

export default function LicenseCard() {
  const { authFetch } = useAuth();
  const { license, fetchLicense } = useApp();
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);

  const st = license || { status: 'none', installId: '—' };
  const meta = STATUS_META[st.status] || STATUS_META.none;

  const copyInstallId = async () => {
    try { await navigator.clipboard.writeText(st.installId || ''); showToast('Kurulum kimliği kopyalandı', 'success'); }
    catch { showToast('Kopyalanamadı — elle seçip kopyalayın', 'error'); }
  };

  const apply = async () => {
    const key = keyInput.trim();
    if (!key) { showToast('Lisans anahtarı girin', 'error'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/license', { method: 'PUT', body: JSON.stringify({ key }) });
      const data = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { showToast('Lisans uygulandı', 'success'); setKeyInput(''); fetchLicense(); }
      else showToast(data.error || 'Lisans uygulanamadı', 'error');
    } catch { showToast('Lisans uygulanamadı', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Durum */}
      <div>
        <span style={lblStyle}>Durum</span>
        <span className="status-badge" style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.bd}` }}>{meta.label}</span>
      </div>

      {/* Demo bilgisi (lisans girilmemişken) */}
      {st.isDemo && (
        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: st.status === 'demo_expired' ? 'var(--danger)' : 'var(--text-main)' }}>
            {st.status === 'demo_expired' ? 'Demo süresi doldu' : `Demo sürümü — ${st.demoDaysLeft} gün kaldı`}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {st.demoDays || 30} günlük deneme. Tam sürüm için aşağıya lisans anahtarını yapıştırıp Uygula'ya basın.
          </div>
        </div>
      )}

      {/* Lisans detaylari (varsa) */}
      {(st.status === 'valid' || st.status === 'expired') && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px' }}>
          <div><span style={lblStyle}>Müşteri</span><div style={{ color: 'var(--text-main)' }}>{st.customer || '—'}</div></div>
          <div><span style={lblStyle}>Sürüm</span><div style={{ color: 'var(--text-main)' }}>{st.edition || '—'}</div></div>
          <div><span style={lblStyle}>Bitiş</span><div style={{ color: 'var(--text-main)' }}>{st.expiresAt ? fmtDate(st.expiresAt) : 'Süresiz'}</div></div>
          <div><span style={lblStyle}>Kalan</span>
            <div style={{ color: st.status === 'expired' ? 'var(--danger)' : (st.daysLeft != null && st.daysLeft <= (st.warnDays || 15) ? 'var(--warning)' : 'var(--text-main)') }}>
              {st.status === 'expired' ? 'Doldu' : (st.daysLeft == null ? 'Süresiz' : `${st.daysLeft} gün`)}
            </div>
          </div>
        </div>
      )}

      {/* Kurulum kimligi */}
      <div>
        <span style={lblStyle}>Kurulum kimliği</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="modern-input" readOnly value={st.installId || '—'} style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: '0.8rem' }} onFocus={e => e.target.select()} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyInstallId} style={{ flexShrink: 0 }}>Kopyala</button>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
          Kuruluma bağlı lisans için bu kimliği üreticiye gönderin.
        </div>
      </div>

      {/* Yeni lisans uygula */}
      <div>
        <span style={lblStyle}>Lisans anahtarı</span>
        <textarea className="modern-input" value={keyInput} onChange={e => setKeyInput(e.target.value)}
          placeholder="NLIC1...." rows={4} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          style={{ fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical' }} />
        <button type="button" className="btn btn-primary" onClick={apply} disabled={saving} style={{ marginTop: 10 }}>
          {saving ? 'Uygulanıyor…' : 'Uygula'}
        </button>
      </div>
    </div>
  );
}
