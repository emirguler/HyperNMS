import { useState, useEffect } from 'react';
import './App.css';
import { t } from './i18n';
import { useViewport } from './hooks/useViewport';

function SwitchFormModal({ mode, initialValues, onCancel, onSave, topologyTabs }) {
  const isEdit = mode === 'edit';
  const { isPhone, isShort, isTablet, width } = useViewport();

  // responsive.css'teki .rw-sheet sorgusunun birebir esi: telefon VEYA kisa ekran.
  const sheet = isPhone || isShort;
  // Tablet ama alt sayfa degil (or. 1024x768 iPad yatay): 500px'lik modal
  // ekrandan uzun kalabiliyor, o araligi da kaydirilabilir yap.
  const midTablet = isTablet && !sheet;
  // .grid-2col GERCEKTEN tek kolona yalnizca su iki durumda duser:
  //   App.css      @media (max-width: 768px)                        -> 1fr
  //   responsive   @media (max-height: 500px)                       -> 1fr 1fr (768 kuralini EZER)
  //   responsive   @media (max-height: 500px) and (max-width: 600px)-> 1fr
  // Yani KISA AMA GENIS ekranda (or. 667x375 / 736x414 telefon yatay) grid iki
  // kolon KALIR; orada 'auto' vermek tam genislikli alanlari yariya dusururdu.
  const oneCol = isShort ? width <= 600 : isPhone;
  // Tek kolonlu gridde 'span 2' gizli bir ikinci kolon uydurup formu yamuk boluyordu.
  const span2 = oneCol ? 'auto' : 'span 2';

  const [values, setValues] = useState({
    name: '',
    ip: '',
    model: '',
    type: 'switch',
    sshUsername: '',
    sshPassword: '',
    healthIntervalSec: 60,
    snmpVersion: 'v2c',
    snmpPort: 161,
    snmpProtocol: 'udp',
    snmpCommunity: '',
    tags: '',
    topologyPage: 'main',
    ipSlaEnabled: true, // varsayılan açık
    ipSlaOkLabel: 'MD',   // IP SLA OK iken gösterilecek rozet
    ipSlaFailLabel: 'GSM', // IP SLA Timeout iken gösterilecek rozet
  });

  useEffect(() => {
    if (isEdit && initialValues) {
      setValues((prev) => ({
        ...prev,
        name: initialValues.name || initialValues.label || '',
        ip: initialValues.ip || '',
        model: initialValues.model || '',
        type: initialValues.type || 'switch',
        sshUsername: initialValues.sshUsername || '',
        sshPassword: '',
        snmpCommunity: initialValues.snmpCommunity || '',
        healthIntervalSec: initialValues.healthIntervalSec || 60,
        tags: (initialValues.tags || []).join(', '),
        topologyPage: initialValues.topologyPage || 'main',
        ipSlaEnabled: initialValues.ipSlaEnabled !== false, // tanımsız/eski cihaz → açık
        ipSlaOkLabel: initialValues.ipSlaOkLabel || 'MD',
        ipSlaFailLabel: initialValues.ipSlaFailLabel || 'GSM',
      }));
    }
  }, [initialValues, isEdit]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValues((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...values };
    if (isEdit && !payload.sshPassword) {
      delete payload.sshPassword;
    }
    // Tags string → array
    payload.tags = payload.tags ? payload.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    onSave(payload);
  };

  return (
    <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      {/* Genislik masaustunde 500px kalir; responsive.css dar/kisa ekranda !important ile ezer. */}
      <div className="modal-content rw-sheet" style={{
        width: '500px',
        maxHeight: midTablet ? 'calc(100dvh - 32px)' : undefined,
        overflowY: midTablet ? 'auto' : undefined,
      }}>
        <div className="rw-sheet-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: sheet ? 0 : '20px' }}>
          <h2 style={{ margin: 0, fontSize: sheet ? undefined : '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {isEdit ? t('editDevice') : t('addNewDevice')}
          </h2>
          {/* Tek cikis yolu bu buton: rw-sheet-close/rw-tap ile 44x44 dokunma hedefi. */}
          <button type="button" onClick={onCancel} aria-label={t('cancel')} className="rw-sheet-close rw-tap"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', flexShrink: 0 }}>&times;</button>
        </div>

        {/* Alt sayfada form, tek kaydirma bolgesini (body) ve yapisik alt bari tasiyan kolon olur. */}
        <form onSubmit={handleSubmit}
          style={sheet ? { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' } : undefined}>
          <div className="grid-2col rw-sheet-body">

            <div style={{ gridColumn: span2 }}>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('deviceName')}</label>
              <input className="modern-input" name="name" value={values.name} onChange={handleChange} required autoComplete="off"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('ipAddress')}</label>
              {/* inputMode=decimal: iOS'ta noktali sayi tusu, QWERTY degil. */}
              <input className="modern-input" name="ip" value={values.ip} onChange={handleChange} required autoComplete="off"
                inputMode="decimal" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('model')}</label>
              <input className="modern-input" name="model" value={values.model} onChange={handleChange} placeholder={t('modelPlaceholder')} autoComplete="off"
                autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('deviceType')}</label>
              <select className="modern-input" name="type" value={values.type} onChange={handleChange}>
                <option value="switch">Network Switch</option>
                <option value="router">Router</option>
                <option value="firewall">Firewall</option>
                <option value="server">Server</option>
                <option value="pc">PC</option>
                <option value="antenna">Antenna</option>
                <option value="cloud">Cloud / Internet</option>
              </select>
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('sshUser')}</label>
              <input className="modern-input" name="sshUsername" value={values.sshUsername} onChange={handleChange} autoComplete="off"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>
                {t('sshPassword')}
                {isEdit && (
                  <span style={{ marginLeft: 8, fontSize: '0.75rem', color: initialValues?.sshPasswordSet ? 'var(--success)' : 'var(--danger)' }}>
                    {initialValues?.sshPasswordSet ? '(Set)' : '(Not set)'}
                  </span>
                )}
              </label>
              <input className="modern-input" type="password" name="sshPassword" value={values.sshPassword} onChange={handleChange} placeholder={isEdit && initialValues?.sshPasswordSet ? 'Leave empty to keep current' : ''} autoComplete="new-password"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            </div>

            <div className="grid-2col" style={{ gridColumn: span2 }}>
               <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('snmpCommunity')}</label>
                  <input className="modern-input" name="snmpCommunity" value={values.snmpCommunity} onChange={handleChange}
                    autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
               </div>
               <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('checkInterval')}</label>
                  <input className="modern-input" type="number" name="healthIntervalSec" value={values.healthIntervalSec} onChange={handleChange}
                    inputMode="numeric" enterKeyHint="next" />
               </div>
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>Tags</label>
              <input className="modern-input" name="tags" value={values.tags} onChange={handleChange} placeholder="core, datacenter" autoComplete="off"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>Topology Page</label>
              <select className="modern-input" name="topologyPage" value={values.topologyPage} onChange={handleChange}>
                {(topologyTabs || [{ id: 'main', name: 'Main Topology' }]).map(tab => (
                  <option key={tab.id} value={tab.id}>{tab.name}</option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: span2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: sheet ? 12 : undefined, padding: '4px 0' }}>
              <div style={{ minWidth: 0 }}>
                <label className="input-label" style={{ display: 'block', color: 'var(--text-main)', fontWeight: 500 }}>{t('ipSlaMonitoring')}</label>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('ipSlaMonitoringHint')}</span>
              </div>
              <label className="toggle-switch" style={{ flexShrink: 0 }}>
                <input type="checkbox" name="ipSlaEnabled" checked={values.ipSlaEnabled} onChange={handleChange} />
                <span className="toggle-slider" />
              </label>
            </div>

            {values.ipSlaEnabled && (
              <div className="grid-2col" style={{ gridColumn: span2 }}>
                <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('ipSlaOkLabel')}</label>
                  <input className="modern-input" name="ipSlaOkLabel" value={values.ipSlaOkLabel} onChange={handleChange} placeholder="MD" maxLength={12} autoComplete="off"
                    autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
                </div>
                <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('ipSlaFailLabel')}</label>
                  <input className="modern-input" name="ipSlaFailLabel" value={values.ipSlaFailLabel} onChange={handleChange} placeholder="GSM" maxLength={12} autoComplete="off"
                    autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
                </div>
              </div>
            )}
          </div>

          {/* Alt sayfada yapisik alt bar: Save/Cancel her zaman gorunur, kaydirma gerektirmez. */}
          <div className="rw-sheet-foot"
            style={sheet ? undefined : { display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button type="button" onClick={onCancel} className="btn btn-ghost">{t('cancel')}</button>
            <button type="submit" className="btn btn-primary">{isEdit ? t('save') : t('add')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SwitchFormModal;
