import { useState, useEffect } from 'react';
import './App.css';
import { t } from './i18n';
import { useViewport } from './hooks/useViewport';

function UserFormModal({ mode, initialValues, topoPages = [], onCancel, onSave }) {
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
    fullSsh: false,   // Operator'e ham SSH klavye erisimi - varsayilan KAPALI
    authType: 'local', // 'local' | 'ad'
    allowedCommands: '', // textarea: her satıra bir komut
    allowedTopoPages: null, // null = tüm topoloji sayfaları (kısıtsız); dizi = yalnızca bu id'ler
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
        // Okunmazsa setValues tum nesneyi degistirdigi icin undefined kalir ve
        // admin baska bir alani duzeltmek icin formu acip kaydettiginde fullSsh
        // sessizce KAPANIRDI.
        fullSsh: initialValues.fullSsh === true,
        // Dizi = kısıtlı; null/undefined = tüm sayfalar.
        allowedTopoPages: Array.isArray(initialValues.allowedTopoPages) ? initialValues.allowedTopoPages : null,
      });
    }
  }, [initialValues, isEdit]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  // --- Görebileceği topoloji sayfaları (checkbox) ---
  // null = tümü (kısıtsız). Dizi = yalnızca seçili id'ler. Administrator her zaman tümü.
  const pageIds = (topoPages || []).map(p => p.id);
  const restricted = Array.isArray(values.allowedTopoPages);
  const allPagesSelected = !restricted || (pageIds.length > 0 && pageIds.every(id => values.allowedTopoPages.includes(id)));
  const isPageChecked = (id) => !restricted || values.allowedTopoPages.includes(id);
  const togglePage = (id) => setValues(prev => {
    const base = Array.isArray(prev.allowedTopoPages) ? [...prev.allowedTopoPages] : [...pageIds];
    const next = base.includes(id) ? base.filter(x => x !== id) : [...base, id];
    return { ...prev, allowedTopoPages: next };
  });
  const setAllPages = (all) => setValues(prev => ({ ...prev, allowedTopoPages: all ? null : [] }));

  const handleSubmit = (e) => {
    e.preventDefault();
    // Komut metnini diziye çevir; yalnızca Operator için anlamlı
    // (Administrator = tam kontrol, Viewer = SSH kapalı)
    const allowedCommands = (values.role === 'Operator' && !values.fullSsh)
      ? values.allowedCommands.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    // fullSsh yalnizca Operator icin anlamli; diger rollerde her zaman false gonder
    const fullSsh = values.role === 'Operator' && values.fullSsh === true;
    // Görebileceği sayfalar: admin → null (tümü). Tümü seçiliyse → null (yeni sayfalar da dahil).
    // Aksi halde seçili id dizisi.
    let allowedTopoPages;
    if (values.role === 'Administrator' || !restricted || (pageIds.length > 0 && pageIds.every(id => values.allowedTopoPages.includes(id)))) {
      allowedTopoPages = null;
    } else {
      allowedTopoPages = values.allowedTopoPages;
    }
    const payload = { username: values.username, role: values.role, authType: values.authType, allowedCommands, fullSsh, allowedTopoPages };
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

            {/* Görebileceği topoloji sayfaları — Administrator her sayfayı görür, gösterme.
                İşaretlenmeyen sayfalar bu kullanıcıdan gizlenir (harita, cihaz listesi, panel). */}
            {values.role !== 'Administrator' && pageIds.length > 0 && (
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 8, color: '#94a3b8' }}>{t('topoAccessLabel')}</label>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, maxHeight: 190, overflowY: 'auto' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isTouch ? '11px 12px' : '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}>
                    <input type="checkbox" checked={allPagesSelected} onChange={e => setAllPages(e.target.checked)} style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>{t('topoAccessAll')}</span>
                  </label>
                  {topoPages.map(p => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isTouch ? '11px 12px' : '8px 12px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={isPageChecked(p.id)} onChange={() => togglePage(p.id)} style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
                      <span className="rw-truncate" style={{ fontSize: '0.85rem', color: 'var(--text-main)', minWidth: 0 }}>{p.name}</span>
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('topoAccessHint')}</div>
              </div>
            )}

            {values.role === 'Operator' && (
              // Tum satir tiklanabilir (44px): dokunmatikte 44x24'luk slider'i
              // hedeflemek zor. Masaustunde gorunum degismiyor.
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: isTouch ? 44 : undefined, cursor: 'pointer' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>{t('fullSshLabel')}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: values.fullSsh ? 'var(--warning)' : 'var(--text-muted)', marginTop: 2 }}>
                    {values.fullSsh ? t('fullSshOnHint') : t('fullSshOffHint')}
                  </span>
                </span>
                <span className="toggle-switch" style={{ flexShrink: 0 }}>
                  <input type="checkbox" name="fullSsh" checked={values.fullSsh}
                    onChange={e => setValues(p => ({ ...p, fullSsh: e.target.checked }))} />
                  <span className="toggle-slider" />
                </span>
              </label>
            )}

            {/* fullSsh acikken komut whitelist'i anlamsiz: kullanici zaten her
                komutu yazabiliyor. Kutuyu gostermek yanlis bir guvenlik hissi verirdi. */}
            {values.role === 'Operator' && !values.fullSsh && (
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
