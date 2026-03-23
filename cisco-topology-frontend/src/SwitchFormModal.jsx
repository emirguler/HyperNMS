import { useState, useEffect } from 'react';
import './App.css';
import { t } from './i18n';

function SwitchFormModal({ mode, initialValues, onCancel, onSave }) {
  const isEdit = mode === 'edit';

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
      }));
    }
  }, [initialValues, isEdit]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
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
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: '500px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {isEdit ? t('editDevice') : t('addNewDevice')}
          </h2>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

            <div style={{ gridColumn: 'span 2' }}>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('deviceName')}</label>
              <input className="modern-input" name="name" value={values.name} onChange={handleChange} required autoComplete="off" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('ipAddress')}</label>
              <input className="modern-input" name="ip" value={values.ip} onChange={handleChange} required autoComplete="off" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('model')}</label>
              <input className="modern-input" name="model" value={values.model} onChange={handleChange} placeholder={t('modelPlaceholder')} autoComplete="off" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('deviceType')}</label>
              <select className="modern-input" name="type" value={values.type} onChange={handleChange}>
                <option value="switch">Network Switch</option>
                <option value="router">Router</option>
                <option value="firewall">Firewall</option>
                <option value="server">Server</option>
                <option value="pc">PC</option>
                <option value="cloud">Cloud / Internet</option>
              </select>
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('sshUser')}</label>
              <input className="modern-input" name="sshUsername" value={values.sshUsername} onChange={handleChange} autoComplete="off" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('sshPassword')}</label>
              <input className="modern-input" type="password" name="sshPassword" value={values.sshPassword} onChange={handleChange} placeholder={isEdit ? t('sshPasswordHint') : ''} autoComplete="new-password" />
            </div>

            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
               <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('snmpCommunity')}</label>
                  <input className="modern-input" name="snmpCommunity" value={values.snmpCommunity} onChange={handleChange} />
               </div>
               <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('checkInterval')}</label>
                  <input className="modern-input" type="number" name="healthIntervalSec" value={values.healthIntervalSec} onChange={handleChange} />
               </div>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>Tags</label>
              <input className="modern-input" name="tags" value={values.tags} onChange={handleChange} placeholder="core, datacenter, floor-2 (comma separated)" autoComplete="off" />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button type="button" onClick={onCancel} className="btn btn-ghost">{t('cancel')}</button>
            <button type="submit" className="btn btn-primary">{isEdit ? t('save') : t('add')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SwitchFormModal;
