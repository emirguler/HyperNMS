import { useState, useEffect } from 'react';
import './App.css';
import { t } from './i18n';

function UserFormModal({ mode, initialValues, onCancel, onSave }) {
  const isEdit = mode === 'edit';

  const [values, setValues] = useState({
    username: '',
    password: '',
    role: 'User',
    allowedCommands: '', // textarea: her satıra bir komut
  });

  useEffect(() => {
    if (isEdit && initialValues) {
      setValues({
        username: initialValues.username || '',
        password: '',
        role: initialValues.role || 'User',
        allowedCommands: (initialValues.allowedCommands || []).join('\n'),
      });
    }
  }, [initialValues, isEdit]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Komut metnini diziye çevir; Administrator için gönderme (tam kontrol)
    const allowedCommands = values.role === 'User'
      ? values.allowedCommands.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    onSave({ ...values, allowedCommands });
  };

  return (
    <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="modal-content" style={{ width: '400px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#f1f5f9' }}>
            {isEdit ? t('editUser') : t('newUserTitle')}
          </h2>
          <button onClick={onCancel} className="btn btn-ghost" style={{ fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>{t('usernameCol')}</label>
              <input
                className="modern-input"
                name="username"
                value={values.username}
                onChange={handleChange}
                placeholder={t('usernamePlaceholder')}
                required
                disabled={isEdit && values.username === 'admin'}
              />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>
                {isEdit ? t('newPasswordHint') : t('passwordLabel')}
              </label>
              <input
                className="modern-input"
                type="password"
                name="password"
                value={values.password}
                onChange={handleChange}
                placeholder="******"
                required={!isEdit}
              />
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>{t('roleLabel')}</label>
              <select
                className="modern-input"
                name="role"
                value={values.role}
                onChange={handleChange}
                style={{ cursor: 'pointer' }}
              >
                <option value="User">{t('roleUser')}</option>
                <option value="Administrator">{t('roleAdmin')}</option>
              </select>
            </div>

            {values.role === 'User' && (
              <div>
                <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>{t('allowedCommandsLabel')}</label>
                <textarea
                  className="modern-input"
                  name="allowedCommands"
                  value={values.allowedCommands}
                  onChange={handleChange}
                  rows={5}
                  placeholder={"show version\nshow ip interface brief\nshow running-config"}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical' }}
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('allowedCommandsHint')}</div>
              </div>
            )}

          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button type="button" onClick={onCancel} className="btn btn-ghost">{t('cancel')}</button>
            <button type="submit" className="btn btn-primary">{isEdit ? t('update') : t('create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UserFormModal;
