import { useState, useRef } from 'react';
import { showToast } from '../Toast';
import { t } from '../i18n';
import { useViewport } from '../hooks/useViewport';

// Çoklu cihaz toplu düzenleme — yalnızca doldurulan alanlar güncellenir (PUT /switches/batch).
// Bir alanı BOŞALTMAK ayrı bir iş: boş kutu "değiştirme" demek olduğu için silme
// her alanın kendi "clear" kutusuyla, açıkça istenir.
export default function BatchEditModal({ deviceIds, topoTabs = [], authFetch, onClose, onDone }) {
  const [form, setForm] = useState({
    model: '', sshUsername: '', sshPassword: '', snmpCommunity: '', tags: '',
    topologyPage: '', ipSlaEnabled: '', ipSlaOkLabel: '', ipSlaFailLabel: '',
    // Bilerek boşaltma bayrakları
    clearModel: false, clearSshUsername: false, clearSshPassword: false,
    clearSnmpCommunity: false, clearTags: false,
  });
  const { isPhone, isShort, isTablet, isTouch } = useViewport();

  // responsive.css'teki .rw-sheet sorgusunun birebir esi: telefon VEYA kisa ekran.
  const sheet = isPhone || isShort;
  // Dokunmatikte kucuk rem yazilar okunmuyor; kucuk etiketleri px ile buyur.
  const compactText = isPhone || isTouch;
  // Tablet ama alt sayfa degil (or. 1024x768 iPad yatay): form ekrandan tasabilir.
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
    // Sadece bosluk yazmak "dolu" sayilmaz: sunucu trim'ledikten sonra alani
    // sessizce silerdi. Bosaltmak isteniyorsa clear kutusu isaretlenir.
    const text = (k) => form[k].trim();
    const put = (key, clearKey, empty = '') => {
      if (form[clearKey]) updates[key] = empty;
      else if (text(key)) updates[key] = text(key);
    };
    put('model', 'clearModel');
    put('sshUsername', 'clearSshUsername');
    // Parolada trim YOK: bosluk gecerli karakter olabilir.
    if (form.clearSshPassword) updates.sshPassword = '';
    else if (form.sshPassword) updates.sshPassword = form.sshPassword;
    put('snmpCommunity', 'clearSnmpCommunity');
    if (form.clearTags) updates.tags = [];
    else if (text('tags')) updates.tags = form.tags.split(',').map(s => s.trim()).filter(Boolean);
    if (form.topologyPage) updates.topologyPage = form.topologyPage;
    if (form.ipSlaEnabled) updates.ipSlaEnabled = form.ipSlaEnabled === 'on';
    if (text('ipSlaOkLabel')) updates.ipSlaOkLabel = text('ipSlaOkLabel');
    if (text('ipSlaFailLabel')) updates.ipSlaFailLabel = text('ipSlaFailLabel');

    if (Object.keys(updates).length === 0) {
      showToast('Nothing to apply yet. Fill in a field or tick a clear box.', 'error');
      return;
    }
    try {
      const res = await authFetch('/switches/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: deviceIds, updates })
      });
      if (res && res.ok) {
        showToast(`${deviceIds.length} ${deviceIds.length === 1 ? 'device' : 'devices'} updated`, 'success');
        onDone && onDone();
        onClose();
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || t('operationFailed'), 'error');
      }
    } catch {
      showToast(t('netError'), 'error');
    }
  };

  // Dokunmatik klavye ipuclari: hostname/kullanici alanlarinda otomatik buyuk harf ve
  // duzeltme kapali, rozet etiketleri buyuk harf, son alan "go".
  const nameLike = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, enterKeyHint: 'next' };
  const badgeLike = { autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false };

  const labelStyle = { display: 'block', marginBottom: 6, color: 'var(--text-muted)' };
  // "clear" kutusu metin kutusunun SAGINDA, ayni satirda durur: alanin ustunde
  // ayri bir satir olarak durdugunda hangi alana ait oldugu okunmuyordu. Satir
  // yuksekligini input belirledigi icin dolgu, satiri buyutmeden dokunma alanini
  // genisletir (input dokunmatikte 44px, kutu dolgusuyla ~41px).
  const clearToggle = {
    display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer',
    fontSize: compactText ? '12px' : '0.72rem', color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 0.4, padding: isTouch ? '11px 4px' : '8px 2px',
  };
  const hintStyle = {
    margin: '6px 0 0', fontSize: compactText ? '12px' : '0.72rem',
    color: 'var(--text-dim)', lineHeight: 1.5,
  };

  // Bosaltilabilir metin alani: etiket + sagda clear kutusu + input (+ isaretliyken not).
  // Kutu isaretlenince yazili deger de temizlenir: gizli durum kalmasin, ne
  // gonderilecegi ekranda gorunsun.
  const clearableField = (label, key, clearKey, extra = {}, hint = null) => {
    const cleared = form[clearKey];
    const id = 'batch-' + key;
    const aria = t(clearKey === 'clearModel' ? 'batchClearModel'
      : clearKey === 'clearSshUsername' ? 'batchClearSshUser'
        : clearKey === 'clearSshPassword' ? 'batchClearSshPass'
          : clearKey === 'clearSnmpCommunity' ? 'batchClearSnmp' : 'batchClearTags');
    return (
      <div>
        <label className="input-label" htmlFor={id} style={labelStyle}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* minWidth:0 sart: .modern-input width:100% tasiyor, flex kutusunda
              kucululmesine izin verilmezse "clear" kutusunu satirdan tasirir. */}
          <input id={id} className="modern-input" style={{ flex: 1, minWidth: 0 }}
            value={form[key]} disabled={cleared}
            onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} {...extra} />
          <label style={clearToggle} title={aria}>
            <input type="checkbox" checked={cleared} aria-label={aria}
              onChange={e => setForm(p => ({ ...p, [clearKey]: e.target.checked, [key]: e.target.checked ? '' : p[key] }))} />
            {t('batchClear')}
          </label>
        </div>
        {cleared && hint && <p style={hintStyle}>{hint}</p>}
      </div>
    );
  };

  // Bosaltilamayan duz alan (IP SLA rozet etiketleri)
  const field = (label, key, type = 'text', extra = {}) => (
    <div>
      <label className="input-label" style={labelStyle}>{label}</label>
      <input className="modern-input" type={type} value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} {...extra} />
    </div>
  );

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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0, marginBottom: 16 }}>
            Whatever you leave blank stays as it is. To empty a field on every selected device, tick its <em>clear</em> box.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Model once: tek cihaz formundaki sira (ad/IP/model/tip -> kimlik bilgileri).
                Buyuk harf ipucu ve 200 karakter siniri tek cihaz formuyla ayni. */}
            {clearableField(t('model'), 'model', 'clearModel', {
              placeholder: t('modelPlaceholder'), maxLength: 200, autoComplete: 'off',
              ...badgeLike, enterKeyHint: 'next',
            }, t('batchClearModelHint'))}
            {clearableField('SSH Username', 'sshUsername', 'clearSshUsername', { autoComplete: 'off', ...nameLike })}
            {clearableField('SSH Password', 'sshPassword', 'clearSshPassword', { type: 'password', autoComplete: 'new-password', ...nameLike })}
            {/* SSH notu ikilinin tamamina ait: kullanici ya da parola bosaldiginda bir kez gosterilir. */}
            {(form.clearSshUsername || form.clearSshPassword) && (
              <p style={{ ...hintStyle, marginTop: -6 }}>{t('batchClearSshHint')}</p>
            )}
            {clearableField('SNMP Community', 'snmpCommunity', 'clearSnmpCommunity',
              { autoComplete: 'off', ...nameLike }, t('batchClearSnmpHint'))}
            {clearableField('Tags (comma-separated)', 'tags', 'clearTags',
              { placeholder: 'core, datacenter', ...nameLike })}
            <div>
              <label className="input-label" style={labelStyle}>Topology Page</label>
              <select className="modern-input" value={form.topologyPage} onChange={e => setForm(p => ({ ...p, topologyPage: e.target.value }))}>
                <option value="">-- No change --</option>
                {topoTabs.map(tab => <option key={tab.id} value={tab.id}>{tab.name}</option>)}
              </select>
            </div>
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, marginTop: 2 }}>
              <label className="input-label" style={labelStyle}>{t('ipSlaMonitoring')}</label>
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
