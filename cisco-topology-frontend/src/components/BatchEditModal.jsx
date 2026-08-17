import { useState, useRef } from 'react';
import { showToast } from '../Toast';
import { t } from '../i18n';
import { useViewport } from '../hooks/useViewport';

// Çoklu cihaz toplu düzenleme — yalnızca doldurulan alanlar güncellenir (PUT /switches/batch)
export default function BatchEditModal({ deviceIds, topoTabs = [], authFetch, onClose, onDone }) {
  const [form, setForm] = useState({ sshUsername: '', sshPassword: '', snmpCommunity: '', tags: '', topologyPage: '', ipSlaEnabled: '', ipSlaOkLabel: '', ipSlaFailLabel: '' });
  const { isPhone, isShort, isTablet, isTouch } = useViewport();

  // responsive.css'teki .rw-sheet sorgusunun birebir esi: telefon VEYA kisa ekran.
  const sheet = isPhone || isShort;
  // Tablet ama alt sayfa degil (or. 1024x768 iPad yatay): 8 alanlik form ekrandan tasabilir.
  const midTablet = isTablet && !sheet;

  // Arka plana dokunarak kapatma: basma VE birakma ikisi de arka plana denk gelmeli.
  // Dokunmatikte tamamen kapali — yarim doldurulmus form kazara kaybolmasin, cikis (x) ile.
  const downOnBackdrop = useRef(false);
  const handleBackdropDown = (e) => { downOnBackdrop.current = e.target === e.currentTarget; };
  const handleBackdropClick = (e) => {
    const onBackdrop = downOnBackdrop.current && e.target === e.currentTarget;
    downOnBackdrop.current = false;
    if (onBackdrop && !isTouch) onClose();
  };

  const submit = async () => {
    const updates = {};
    if (form.sshUsername) updates.sshUsername = form.sshUsername;
    if (form.sshPassword) updates.sshPassword = form.sshPassword;
    if (form.snmpCommunity) updates.snmpCommunity = form.snmpCommunity;
    if (form.tags) updates.tags = form.tags.split(',').map(s => s.trim()).filter(Boolean);
    if (form.topologyPage) updates.topologyPage = form.topologyPage;
    if (form.ipSlaEnabled) updates.ipSlaEnabled = form.ipSlaEnabled === 'on';
    if (form.ipSlaOkLabel) updates.ipSlaOkLabel = form.ipSlaOkLabel;
    if (form.ipSlaFailLabel) updates.ipSlaFailLabel = form.ipSlaFailLabel;

    if (Object.keys(updates).length === 0) {
      showToast('No fields filled in', 'error');
      return;
    }
    try {
      const res = await authFetch('/switches/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: deviceIds, updates })
      });
      if (res && res.ok) {
        showToast(`${deviceIds.length} device(s) updated`, 'success');
        onDone && onDone();
        onClose();
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Batch update failed', 'error');
      }
    } catch {
      showToast('Batch update failed', 'error');
    }
  };

  const field = (label, key, type = 'text', extra = {}) => (
    <div>
      <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{label}</label>
      <input className="modern-input" type={type} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} {...extra} />
    </div>
  );

  // Dokunmatik klavye ipuclari: hostname/kullanici alanlarinda otomatik buyuk harf ve
  // duzeltme kapali, rozet etiketleri buyuk harf, son alan "go".
  const nameLike = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, enterKeyHint: 'next' };
  const badgeLike = { autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false };

  return (
    <div className="modal-overlay"
      onPointerDown={handleBackdropDown}
      onClick={handleBackdropClick}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      {/* Genislik masaustunde 460px kalir; responsive.css dar/kisa ekranda !important ile ezer. */}
      <div className="modal-content rw-sheet" style={{
        width: 460,
        maxHeight: midTablet ? 'calc(100dvh - 32px)' : undefined,
        overflowY: midTablet ? 'auto' : undefined,
      }}>
        <div className="rw-sheet-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: sheet ? 0 : 20 }}>
          <h2 style={{ margin: 0, fontSize: sheet ? undefined : '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>Batch Edit ({deviceIds.length} devices)</h2>
          {/* rw-sheet-close/rw-tap: 44x44 dokunma hedefi (masaustunde etkisiz). */}
          <button type="button" onClick={onClose} aria-label={t('cancel')} className="rw-sheet-close rw-tap"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', flexShrink: 0 }}>&times;</button>
        </div>

        <div className="rw-sheet-body">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0, marginBottom: 16 }}>Only filled fields will be updated. Leave blank to skip.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {field('SSH Username', 'sshUsername', 'text', { autoComplete: 'off', ...nameLike })}
            {field('SSH Password', 'sshPassword', 'password', { autoComplete: 'new-password', ...nameLike })}
            {field('SNMP Community', 'snmpCommunity', 'text', { autoComplete: 'off', ...nameLike })}
            {field('Tags (comma-separated)', 'tags', 'text', { placeholder: 'core, datacenter', ...nameLike })}
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>Topology Page</label>
              <select className="modern-input" value={form.topologyPage} onChange={e => setForm(p => ({ ...p, topologyPage: e.target.value }))}>
                <option value="">-- No change --</option>
                {topoTabs.map(tab => <option key={tab.id} value={tab.id}>{tab.name}</option>)}
              </select>
            </div>
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, marginTop: 2 }}>
              <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('ipSlaMonitoring')}</label>
              <select className="modern-input" value={form.ipSlaEnabled} onChange={e => setForm(p => ({ ...p, ipSlaEnabled: e.target.value }))}>
                <option value="">-- No change --</option>
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </div>
            {form.ipSlaEnabled !== 'off' && (
              <div className="grid-2col">
                {field(t('ipSlaOkLabel'), 'ipSlaOkLabel', 'text', { placeholder: 'MD', maxLength: 12, autoComplete: 'off', ...badgeLike, enterKeyHint: 'next' })}
                {field(t('ipSlaFailLabel'), 'ipSlaFailLabel', 'text', { placeholder: 'GSM', maxLength: 12, autoComplete: 'off', ...badgeLike, enterKeyHint: 'go' })}
              </div>
            )}
          </div>
        </div>

        {/* Alt sayfada yapisik alt bar: Apply Changes her zaman gorunur, telefonda tam genislik. */}
        <div className="rw-sheet-foot"
          style={sheet ? undefined : { display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" onClick={submit}>Apply Changes</button>
        </div>
      </div>
    </div>
  );
}
