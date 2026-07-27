import { useState, useEffect } from 'react';
import './App.css';
import { t } from './i18n';

function SwitchFormModal({ mode, initialValues, onCancel, onSave, topologyTabs }) {
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
    topologyPage: 'main',
    ipSlaEnabled: true, // varsayılan açık
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
      <div className="modal-content" style={{ width: '500px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {isEdit ? t('editDevice') : t('addNewDevice')}
          </h2>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid-2col">

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
                <option value="antenna">Antenna</option>
                <option value="cloud">Cloud / Internet</option>
              </select>
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('sshUser')}</label>
              <input className="modern-input" name="sshUsername" value={values.sshUsername} onChange={handleChange} autoComplete="off" />
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
              <input className="modern-input" type="password" name="sshPassword" value={values.sshPassword} onChange={handleChange} placeholder={isEdit && initialValues?.sshPasswordSet ? 'Leave empty to keep current' : ''} autoComplete="new-password" />
            </div>

            <div className="grid-2col" style={{ gridColumn: 'span 2' }}>
               <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('snmpCommunity')}</label>
                  <input className="modern-input" name="snmpCommunity" value={values.snmpCommunity} onChange={handleChange} />
               </div>
               <div>
                  <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>{t('checkInterval')}</label>
                  <input className="modern-input" type="number" name="healthIntervalSec" value={values.healthIntervalSec} onChange={handleChange} />
               </div>
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>Tags</label>
              <input className="modern-input" name="tags" value={values.tags} onChange={handleChange} placeholder="core, datacenter" autoComplete="off" />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'var(--text-muted)'}}>Topology Page</label>
              <select className="modern-input" name="topologyPage" value={values.topologyPage} onChange={handleChange}>
                {(topologyTabs || [{ id: 'main', name: 'Main Topology' }]).map(tab => (
                  <option key={tab.id} value={tab.id}>{tab.name}</option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <div>
                <label className="input-label" style={{ display: 'block', color: 'var(--text-main)', fontWeight: 500 }}>{t('ipSlaMonitoring')}</label>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('ipSlaMonitoringHint')}</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" name="ipSlaEnabled" checked={values.ipSlaEnabled} onChange={handleChange} />
                <span className="toggle-slider" />
              </label>
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
