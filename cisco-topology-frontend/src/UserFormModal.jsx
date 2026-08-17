import { useState, useEffect } from 'react';
import './App.css';
import { t } from './i18n';
import { useViewport } from './hooks/useViewport';

function UserFormModal({ mode, initialValues, onCancel, onSave }) {
  const isEdit = mode === 'edit';
  const { isPhone, isShort, isTablet, isTouch } = useViewport();

  // responsive.css'teki .rw-sheet sorgusunun birebir esi: telefon VEYA kisa ekran.
  const sheet = isPhone || isShort;
  // Tablet ama alt sayfa degil (or. 1024x768 iPad yatay): Operator secilince
  // 5 satirlik textarea modali ekrandan tasiriyor -> kaydirilabilir kalsin.
  const midTablet = isTablet && !sheet;

  const [values, setValues] = useState({
    username: '',
    password: '',
    role: 'Viewer',   // varsayilan en dusuk yetki
    authType: 'local', // 'local' | 'ad'
    allowedCommands: '', // textarea: her satıra bir komut
  });

  useEffect(() => {
    if (isEdit && initialValues) {
      setValues({
        username: initialValues.username || '',
        password: '',
        // Eski kayitlarda 'User' = bugunun Operator'u
        role: initialValues.role === 'User' ? 'Operator' : (initialValues.role || 'Viewer'),
        authType: initialValues.authType || 'local',
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
    // Komut metnini diziye çevir; yalnızca Operator için anlamlı
    // (Administrator = tam kontrol, Viewer = SSH kapalı)
    const allowedCommands = values.role === 'Operator'
      ? values.allowedCommands.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    const payload = { username: values.username, role: values.role, authType: values.authType, allowedCommands };
    // AD kullanicisinda yerel sifre yok — yalnizca local'de gonder
    if (values.authType === 'local') payload.password = values.password;
    onSave(payload);
  };

  return (
    <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      {/* Genislik masaustunde 400px kalir; responsive.css dar/kisa ekranda !important ile ezer. */}
      <div className="modal-content rw-sheet" style={{
        width: '400px',
        maxHeight: midTablet ? 'calc(100dvh - 32px)' : undefined,
        overflowY: midTablet ? 'auto' : undefined,
      }}>
        <div className="rw-sheet-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: sheet ? 0 : '20px' }}>
          <h2 style={{ margin: 0, fontSize: sheet ? undefined : '1.25rem', fontWeight: 600, color: '#f1f5f9' }}>
            {isEdit ? t('editUser') : t('newUserTitle')}
          </h2>
          {/* rw-tap: dokunmatikte 44x44 tabanini garantiler (masaustunde etkisiz). */}
          <button type="button" onClick={onCancel} aria-label={t('cancel')} className="btn btn-ghost rw-tap"
            style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>&times;</button>
        </div>

        {/* Alt sayfada form, tek kaydirma bolgesini (body) ve yapisik alt bari tasiyan kolon olur. */}
        <form onSubmit={handleSubmit}
          style={sheet ? { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' } : undefined}>
          <div className="rw-sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>{t('authTypeLabel')}</label>
              <select
                className="modern-input"
                name="authType"
                value={values.authType}
                onChange={handleChange}
                style={{ cursor: 'pointer' }}
                disabled={isEdit && values.username === 'admin'}
              >
                <option value="local">{t('authTypeLocal')}</option>
                <option value="ad">{t('authTypeAd')}</option>
              </select>
            </div>

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>{t('usernameCol')}</label>
              <input
                className="modern-input"
                name="username"
                value={values.username}
                onChange={handleChange}
                placeholder={values.authType === 'ad' ? 'sAMAccountName' : t('usernamePlaceholder')}
                required
                disabled={isEdit && values.username === 'admin'}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
              />
            </div>

            {values.authType === 'local' ? (
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
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                />
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', background: 'rgba(99,102,241,0.08)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 12px' }}>
                {t('adUserHint')}
              </div>
            )}

            <div>
              <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>{t('roleLabel')}</label>
              <select
                className="modern-input"
                name="role"
                value={values.role}
                onChange={handleChange}
                style={{ cursor: 'pointer' }}
              >
                <option value="Viewer">{t('roleViewer')}</option>
                <option value="Operator">{t('roleOperator')}</option>
                <option value="Administrator">{t('roleAdmin')}</option>
              </select>
              {(values.role === 'Viewer' || values.role === 'Operator') && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                  {values.role === 'Viewer' ? t('roleViewerHint') : t('roleOperatorHint')}
                </div>
              )}
            </div>

            {values.role === 'Operator' && (
              <div>
                <label className="input-label" style={{display:'block', marginBottom:8, color:'#94a3b8'}}>{t('allowedCommandsLabel')}</label>
                {/* Kisa ekranda 5 satirlik komut kutusu tum govdeyi yiyor -> 3 satir.
                    resize tutamagi yalnizca fare ile kullanilabilir, dokunmatikte kapatildi. */}
                <textarea
                  className="modern-input"
                  name="allowedCommands"
                  value={values.allowedCommands}
                  onChange={handleChange}
                  rows={isShort ? 3 : 5}
                  placeholder={"show version\nshow ip interface brief\nshow running-config"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="enter"
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem', resize: isTouch ? 'none' : 'vertical' }}
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('allowedCommandsHint')}</div>
              </div>
            )}

          </div>

          {/* Alt sayfada yapisik alt bar: Create/Update her zaman gorunur. */}
          <div className="rw-sheet-foot"
            style={sheet ? undefined : { display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button type="button" onClick={onCancel} className="btn btn-ghost">{t('cancel')}</button>
            <button type="submit" className="btn btn-primary">{isEdit ? t('update') : t('create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UserFormModal;
