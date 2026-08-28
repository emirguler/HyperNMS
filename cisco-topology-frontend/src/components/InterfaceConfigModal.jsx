import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';
import { useViewport } from '../hooks/useViewport';

// Cihaz detayı → fiziksel arayüz satırındaki "Config" butonu bunu açar.
// Sol: arayüzün mevcut ayarları (show running-config interface <name>).
// Sağ: mode (access/trunk) + VLAN seçimleriyle yeni ayar uygula. Hem user hem admin.
export default function InterfaceConfigModal({ deviceId, iface, onClose }) {
  const { authFetch, isAdmin } = useAuth();
  const { isPhone, isShort, isTablet, isTouch } = useViewport();
  const name = iface?.name || '';

  // responsive.css'teki .rw-sheet sorgusunun birebir esi: telefon VEYA kisa ekran.
  const sheet = isPhone || isShort;
  // Kolonlari YALNIZCA telefonda yigiyoruz. Telefon YATAY (812x375) genis ama alcak:
  // orada iki kolon dogru cevap, yigmak formu 2 ekran boyu uzatirdi.
  const stack = isPhone;
  // Tablet ama alt sayfa degil (or. 1024x768 iPad yatay): 780px'lik modal
  // 768px yuksekligindeki ekrandan uzun kaliyordu, kaydirilabilir olsun.
  const midTablet = isTablet && !sheet;
  // VLAN etiketi: 1024x768 ve 820x1180 iPad alt sayfa esigine GIRMIYOR, ama orada da
  // hover yok -> title= hic gorunmez. Kirpilmis "1234 — VOICE-B..." okunamaz kalirdi,
  // bu yuzden kolon genisligi + satir sarma dokunmatigin TAMAMINDA aciliyor.
  const vlanTouch = sheet || isTouch;

  const [output, setOutput] = useState('');
  const [outLoading, setOutLoading] = useState(true);
  const [outErr, setOutErr] = useState('');
  const [vlans, setVlans] = useState([]);

  const initialMode = (iface?.trunkVlans && iface.trunkVlans.length) ? 'trunk' : 'access';
  const [mode, setMode] = useState(initialMode);
  const [accessVlan, setAccessVlan] = useState(iface?.vlan && /^\d+$/.test(String(iface.vlan)) ? String(iface.vlan) : '');
  const [nativeVlan, setNativeVlan] = useState('');
  const [allowedVlans, setAllowedVlans] = useState([]); // string id'ler (açık liste)
  const [allowedAll, setAllowedAll] = useState(false);  // true = allowed satırı yok → tüm VLAN'lar izinli
  const [powerAuto, setPowerAuto] = useState(true); // Power inline: true=auto, false=never
  const [shut, setShut] = useState(false);          // true=shutdown, false=no shutdown
  const initPowerRef = useRef(true);                // ilk (mevcut) PoE değeri — yalnızca değişince gönderilir
  const [save, setSave] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState(null); // { ok, text }

  // Arka plana dokunarak kapatma: basma VE birakma ikisi de arka plana denk gelmeli,
  // ve dokunmatikte hic calismasin — yarim doldurulmus ayar kazara kaybolmasin.
  const downOnBackdrop = useRef(false);
  const handleBackdropDown = (e) => { downOnBackdrop.current = e.target === e.currentTarget; };
  const handleBackdropClick = (e) => {
    const onBackdrop = downOnBackdrop.current && e.target === e.currentTarget;
    downOnBackdrop.current = false;
    if (onBackdrop && !isTouch) onClose();
  };

  const loadOutput = (fillForm = false) => {
    setOutLoading(true); setOutErr('');
    authFetch(`/switches/${deviceId}/interface-config?name=${encodeURIComponent(name)}`)
      .then(r => (r && r.ok ? r.json() : (r ? r.json().then(d => Promise.reject(d)) : Promise.reject({}))))
      .then(d => {
        const text = d.output || '';
        setOutput(text);
        if (fillForm) { // formu cihazın mevcut ayarlarıyla doldur (yalnızca ilk açılışta)
          const p = parseInterfaceConfig(text);
          setMode(p.mode || ((p.nativeVlan || p.allowedVlans.length) ? 'trunk' : 'access'));
          setAccessVlan(p.accessVlan || '');
          setNativeVlan(p.nativeVlan || '');
          setAllowedVlans(p.allowedVlans || []);
          setAllowedAll(!p.allowedExplicit); // allowed satırı yoksa → tüm VLAN'lar seçili gelsin
          const auto = p.power !== 'never';
          setPowerAuto(auto); initPowerRef.current = auto;
          setShut(!!p.shutdown);
        }
      })
      .catch(d => setOutErr((d && d.error) || t('ifaceLoadFail')))
      .finally(() => setOutLoading(false));
  };

  useEffect(() => {
    loadOutput(true); // ilk açılış: mevcut ayarları forma otomatik getir
    authFetch(`/switches/${deviceId}/vlans`)
      .then(r => (r && r.ok ? r.json() : null))
      .then(d => setVlans((d && d.vlans) || []))
      .catch(() => { /* VLAN çekilemezse sayı girişine düşer */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    setApplying(true); setApplyMsg(null);
    const body = { name, mode, save };
    if (mode === 'access') body.accessVlan = accessVlan || undefined;
    else {
      body.nativeVlan = nativeVlan || undefined;
      if (!allowedAll) body.allowedVlans = allowedVlans.map(Number); // allowedAll = mevcut "hepsi izinli"ye dokunma
    }
    body.shutdown = shut; // admin durumu her zaman gönderilir (zararsız)
    if (powerAuto !== initPowerRef.current) body.powerInline = powerAuto ? 'auto' : 'never'; // yalnızca değiştiyse
    authFetch(`/switches/${deviceId}/interface-config`, { method: 'POST', body: JSON.stringify(body) })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) { setApplyMsg({ ok: true, text: t('ifaceApplied') }); loadOutput(); }
        else setApplyMsg({ ok: false, text: d.error || t('ifaceApplyFail') });
      })
      .catch(() => setApplyMsg({ ok: false, text: t('ifaceApplyFail') }))
      .finally(() => setApplying(false));
  };

  const label = { fontSize: sheet ? '0.85rem' : '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6, marginTop: 14 };

  // Telefonda iki kolon tam genislige duser; masaustunde 320px tabanli esnek kolonlar.
  const colStyle = stack ? { flex: '1 1 100%', minWidth: 0 } : { flex: '1 1 320px', minWidth: 280 };

  // Apply butonu ve sonuc mesaji: masaustunde sag kolonun altinda, alt sayfada
  // yapisik alt barda duruyor. Ikisi de ayni JSX'ten uretiliyor.
  const applyBtn = (
    <button className="btn btn-primary" onClick={apply} disabled={applying}
      style={{ width: '100%', marginTop: sheet ? 0 : 16 }}>
      {applying ? `⏳ ${t('ifaceApplying')}` : t('ifaceApply')}
    </button>
  );
  const applyMsgBox = applyMsg ? (
    <div style={{
      marginTop: sheet ? 0 : 12, padding: '9px 12px', borderRadius: 8, fontSize: '0.8rem',
      background: applyMsg.ok ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
      border: `1px solid ${applyMsg.ok ? 'rgba(52,211,153,0.35)' : 'rgba(239,68,68,0.35)'}`,
      color: applyMsg.ok ? 'var(--success)' : 'var(--danger)'
    }}>
      {applyMsg.ok ? '✓' : '✕'} {applyMsg.text}
    </div>
  ) : null;

  const currentCfg = (
    <CurrentConfig compact={sheet} touch={isTouch} outLoading={outLoading} outErr={outErr}
      output={output} onReload={() => loadOutput(true)} />
  );

  return (
    <div className="modal-overlay"
      onPointerDown={handleBackdropDown}
      onClick={handleBackdropClick}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      {/* Genislik masaustunde 780px kalir; responsive.css dar/kisa ekranda !important ile ezer. */}
      <div className="modal-content rw-sheet" style={{
        width: 780,
        maxWidth: '95vw',
        maxHeight: midTablet ? 'calc(100dvh - 32px)' : undefined,
        overflowY: midTablet ? 'auto' : undefined,
      }}>
        <div className="rw-sheet-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: sheet ? 0 : 18 }}>
          {/* Alt sayfada baslik tek satira kirpiliyor (.rw-sheet-head > :first-child).
              O yuzden orada ONCE arayuz adi geliyor: kirpilan yari genel etiket olsun. */}
          <h2 style={{ margin: 0, fontSize: sheet ? undefined : '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {sheet ? (
              <><span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{name}</span> — {t('ifaceConfigTitle')}</>
            ) : (
              <>{t('ifaceConfigTitle')} — <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{name}</span></>
            )}
          </h2>
          {/* rw-sheet-close/rw-tap: 44x44 dokunma hedefi (masaustunde etkisiz). */}
          <button type="button" onClick={onClose} aria-label={t('cancel')} className="rw-sheet-close rw-tap"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', flexShrink: 0 }}>&times;</button>
        </div>

        <div className="rw-sheet-body">
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {/* SOL: mevcut ayarlar. Telefonda order:2 ile forma yer acar ve
                kapali bir aciklama kutusunun ardina cekilir — Mode -> VLAN -> Apply
                hicbir sey kaydirmadan ulasilabilir olsun diye. */}
            <div style={{ ...colStyle, order: stack ? 2 : undefined }}>
              {stack ? (
                <details style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '0 10px', background: 'rgba(255,255,255,0.02)' }}>
                  <summary style={{ minHeight: 44, padding: '12px 2px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', cursor: 'pointer', lineHeight: 1.4 }}>
                    Current config
                  </summary>
                  <div style={{ paddingBottom: 12 }}>{currentCfg}</div>
                </details>
              ) : currentCfg}

              {/* Mevcut ayarların ALTINDA: hızlı-eylem butonları + sabit Clear Config */}
              <InterfaceActions deviceId={deviceId} ifaceName={name} isAdmin={isAdmin}
                isTouch={isTouch} compact={sheet} save={save} />
            </div>

            {/* SAĞ: yeni ayar */}
            <div style={{ ...colStyle, order: stack ? 1 : undefined }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('ifaceNewCfg')}</span>

              <label style={label}>{t('ifaceMode')}</label>
              <select className="modern-input" style={{ width: '100%' }} value={mode} onChange={e => setMode(e.target.value)}>
                <option value="access">Access</option>
                <option value="trunk">Trunk</option>
              </select>

              {mode === 'access' ? (
                <>
                  <label style={label}>{t('ifaceAccessVlan')}</label>
                  <VlanPick vlans={vlans} value={accessVlan} onChange={setAccessVlan} />
                </>
              ) : (
                <>
                  <label style={label}>{t('ifaceNativeVlan')}</label>
                  <VlanPick vlans={vlans} value={nativeVlan} onChange={setNativeVlan} />

                  <label style={label}>{t('ifaceAllowedVlans')}</label>
                  {vlans.length ? (
                    // Alt sayfada ic ice sabit yukseklikli kaydirici OLMAZ: liste akar,
                    // tek kaydirma bolgesi .rw-sheet-body kalir. Satirlar 44px.
                    <div style={{
                      border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 10px',
                      maxHeight: sheet ? 'none' : 168, overflowY: sheet ? 'visible' : 'auto', display: 'grid',
                      gridTemplateColumns: vlanTouch ? 'repeat(auto-fill, minmax(150px, 1fr))' : 'repeat(auto-fill, minmax(115px, 1fr))',
                      gap: sheet ? '2px 12px' : '5px 12px'
                    }}>
                      {vlans.map(v => {
                        const vid = String(v.id);
                        const checked = allowedAll || allowedVlans.includes(vid);
                        return (
                          <label key={v.id} title={`${v.id} — ${v.name}`}
                            style={sheet
                              ? { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '2px 2px', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-main)' }
                              : { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer', color: 'var(--text-main)' }}>
                            <input type="checkbox" checked={checked}
                              onChange={e => {
                                if (allowedAll) { // "hepsi izinli"den açık listeye geç: tıklanan hariç hepsi işaretli kalır
                                  const all = vlans.map(x => String(x.id));
                                  setAllowedAll(false);
                                  setAllowedVlans(e.target.checked ? all : all.filter(x => x !== vid));
                                } else {
                                  setAllowedVlans(prev => e.target.checked ? [...prev, vid] : prev.filter(x => x !== vid));
                                }
                              }} />
                            {/* Dokunmatikte title gorunmez: alt sayfada etiket kirpilmaz, sarilir. */}
                            <span style={vlanTouch
                              ? { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25 }
                              : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.id} — {v.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input className="modern-input" style={{ width: '100%' }}
                      value={allowedVlans.join(',')}
                      onChange={e => { setAllowedAll(false); setAllowedVlans(e.target.value.split(',').map(s => s.trim()).filter(Boolean)); }}
                      inputMode="numeric" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      placeholder="10,20,30" />
                  )}
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 4 }}>{t('ifaceAllowedHint')}</div>
                </>
              )}

              {/* Power inline (auto/never) ve Shutdown — mod'dan bağımsız, toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{t('ifacePowerInline')}</div>
                  <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{powerAuto ? 'auto' : 'never'}</div>
                </div>
                <label className="toggle-switch" style={{ flexShrink: 0 }}>
                  <input type="checkbox" checked={powerAuto} onChange={e => setPowerAuto(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{t('ifaceShutdown')}</div>
                  <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: shut ? 'var(--danger)' : '#facc15' }}>{shut ? 'shutdown' : 'no shutdown'}</div>
                </div>
                {/* Sağ/açık = no shutdown (sarı), sol/kapalı = shutdown (kırmızı) → checked = !shut */}
                <label className="toggle-switch toggle-shutdown" style={{ flexShrink: 0 }}>
                  <input type="checkbox" checked={!shut} onChange={e => setShut(!e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', minHeight: isTouch ? 44 : undefined }}>
                <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />
                {t('ifaceSaveStartup')}
              </label>

              {!sheet && applyBtn}
              {!sheet && applyMsgBox}
            </div>
          </div>
        </div>

        {/* Alt sayfada Apply yapisik alt barda: VLAN listesi ne kadar uzarsa uzasin ulasilabilir. */}
        {sheet && (
          <div className="rw-sheet-foot">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {applyMsgBox}
              {applyBtn}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Sol sutunun icerigi: "show running-config interface" ciktisi + yenile butonu.
// MODUL SEVIYESINDE tanimli — bilesenin govdesinde tanimlanirsa her render'da yeni
// bilesen tipi olur ve <pre> her guncellemede remount olup kaydirmasi sifirlanirdi.
function CurrentConfig({ compact, touch, outLoading, outErr, output, onReload }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('ifaceCurrentCfg')}</span>
        <button className="btn btn-sm" onClick={onReload} disabled={outLoading}
          title={t('ifaceRefreshRevert')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: touch ? '0.85rem' : '0.72rem', fontWeight: 600,
            padding: '4px 11px', color: 'var(--primary)', background: 'rgba(59,130,246,0.12)',
            border: '1px solid var(--primary)', borderRadius: 6, flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {t('ifaceReload')}
        </button>
      </div>
      {/* title= dokunmatikte hic gorunmez; "yenilemek duzenlemelerini geri alir"
          uyarisi orada gorunur metne cevrilir. */}
      {touch && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.35 }}>
          {t('ifaceRefreshRevert')}
        </div>
      )}
      <pre style={{
        margin: 0, background: '#000', color: '#e5e7eb', border: '1px solid var(--border-color)', borderRadius: 8,
        padding: 12, fontSize: '0.78rem', fontFamily: 'monospace',
        minHeight: compact ? 0 : 220, maxHeight: compact ? '38dvh' : 340, overflow: 'auto', whiteSpace: 'pre-wrap'
      }}>
        {outLoading ? `⏳ ${t('loading')}...` : (outErr ? `✕ ${outErr}` : (output || '—'))}
      </pre>
    </>
  );
}

// Arayüz hızlı-eylem butonları: "Current config"in ALTINDA. Seçili arayüz üzerinde
// tek tıkla config komutu çalıştırır. Sabit "Clear Config" (default interface X) her
// zaman vardır ve DÜZENLENEMEZ; iki adımlı onayla çalışır. Diğer butonlar sistem geneli
// (settings) saklanır: yalnızca admin düzenler (+ ile ekler/siler), herkes çalıştırır.
// Komut tanımları sunucuda id ile tutulduğundan istemci keyfi komut enjekte edemez.
function InterfaceActions({ deviceId, ifaceName, isAdmin, isTouch, compact, save }) {
  const { authFetch } = useAuth();
  const [buttons, setButtons] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);      // [{ id, label, cmdText }]
  const [runId, setRunId] = useState(null);    // çalışan buton id'si | 'clear' | null
  const [msg, setMsg] = useState(null);        // { ok, text }
  const [confirmClear, setConfirmClear] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    authFetch('/settings/interface-buttons')
      .then(r => (r && r.ok ? r.json() : null))
      .then(d => { if (alive && d && Array.isArray(d.buttons)) setButtons(d.buttons); })
      .catch(() => { /* buton çekilemezse yalnızca Clear Config kalır */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (payload, id) => {
    setRunId(id); setMsg(null); setConfirmClear(false);
    try {
      const res = await authFetch(`/switches/${deviceId}/interface-command`,
        { method: 'POST', body: JSON.stringify({ name: ifaceName, save, ...payload }) });
      const d = res ? await res.json().catch(() => ({})) : {};
      setMsg(res && res.ok ? { ok: true, text: t('ifaceActionDone') } : { ok: false, text: d.error || t('ifaceActionFail') });
    } catch { setMsg({ ok: false, text: t('ifaceActionFail') }); }
    finally { setRunId(null); }
  };

  const startEdit = () => {
    setDraft(buttons.map(b => ({ id: b.id, label: b.label, cmdText: (b.commands || []).join('\n') })));
    setMsg(null); setEditing(true);
  };
  const addDraft = () => setDraft(d => [...d, { id: '', label: '', cmdText: '' }]);
  const delDraft = (i) => setDraft(d => d.filter((_, x) => x !== i));
  const setField = (i, k, v) => setDraft(d => d.map((row, x) => (x === i ? { ...row, [k]: v } : row)));

  const saveButtons = async () => {
    const payload = draft
      .map(r => ({ id: r.id || undefined, label: r.label.trim(), commands: r.cmdText.split('\n').map(s => s.trim()).filter(Boolean) }))
      .filter(r => r.label && r.commands.length);
    setSaving(true); setMsg(null);
    try {
      const res = await authFetch('/settings/interface-buttons', { method: 'PUT', body: JSON.stringify({ buttons: payload }) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { setButtons(d.buttons || []); setEditing(false); setMsg({ ok: true, text: t('ifaceButtonsSaved') }); }
      else setMsg({ ok: false, text: d.error || t('ifaceButtonsSaveFail') });
    } catch { setMsg({ ok: false, text: t('ifaceButtonsSaveFail') }); }
    finally { setSaving(false); }
  };

  const pill = {
    fontSize: compact ? '0.85rem' : '0.8rem', padding: compact ? '9px 14px' : '7px 12px',
    borderRadius: 8, border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)',
    color: 'var(--text-main)', cursor: 'pointer', minHeight: isTouch ? 44 : undefined,
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('ifaceActions')}</span>
        {isAdmin && (
          <button type="button" onClick={startEdit}
            style={{ fontSize: '0.72rem', fontWeight: 600, padding: '4px 11px', color: 'var(--primary)',
              background: 'rgba(59,130,246,0.12)', border: '1px solid var(--primary)', borderRadius: 6, cursor: 'pointer' }}>
            {t('ifaceEdit')}
          </button>
        )}
      </div>

      {/* Butonlar her zaman burada; düzenleme ayrı bir POPUP'ta yapılır. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {buttons.map(b => (
          <button key={b.id} type="button" onClick={() => run({ buttonId: b.id }, b.id)} disabled={runId != null}
            title={(b.commands || []).join(' / ')} style={pill}>
            {runId === b.id ? t('ifaceRunning') : b.label}
          </button>
        ))}
        {!buttons.length && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', alignSelf: 'center' }}>
            {isAdmin ? t('ifaceNoButtonsAdmin') : t('ifaceNoButtons')}
          </span>
        )}
        {/* Sabit Clear Config — DÜZENLENEMEZ; kazara tıklamaya karşı iki adımlı onay. */}
        {confirmClear ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button type="button" onClick={() => run({ action: 'clear' }, 'clear')} disabled={runId != null}
              style={{ ...pill, color: '#fff', background: 'var(--danger)', border: '1px solid var(--danger)' }}>
              {runId === 'clear' ? t('ifaceRunning') : t('ifaceConfirm')}
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} style={pill}>{t('cancel')}</button>
          </span>
        ) : (
          <button type="button" onClick={() => { setConfirmClear(true); setMsg(null); }} disabled={runId != null}
            title={t('ifaceClearConfirm')}
            style={{ ...pill, color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.08)' }}>
            {t('ifaceClearConfig')}
          </button>
        )}
      </div>

      {confirmClear && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 6 }}>{t('ifaceClearConfirm')}</div>
      )}
      {msg && !editing && (
        <div style={{
          marginTop: 10, padding: '8px 11px', borderRadius: 8, fontSize: '0.78rem',
          background: msg.ok ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${msg.ok ? 'rgba(52,211,153,0.35)' : 'rgba(239,68,68,0.35)'}`,
          color: msg.ok ? 'var(--success)' : 'var(--danger)',
        }}>
          {msg.ok ? '✓' : '✕'} {msg.text}
        </div>
      )}

      {/* DÜZENLEME POPUP'ı (admin). Etiket + komut kutuları burada; kaydedince kapanır.
          Escape/backdrop yalnızca bu popup'ı kapatır (parent modalı DEĞİL) — bu yüzden
          hem onClick hem onKeyDown'da stopPropagation var. */}
      {editing && (
        <div className="modal-overlay" style={{ zIndex: 2200 }}
          onClick={(e) => { e.stopPropagation(); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}>
          <div className={compact ? 'modal-content rw-sheet' : 'modal-content'}
            style={{ width: 520, maxWidth: '95vw', maxHeight: '88dvh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}>
            <div className={compact ? 'rw-sheet-head' : undefined}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 0 : 16, gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: compact ? '1rem' : '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('ifaceActions')}</h2>
              <button type="button" onClick={() => setEditing(false)} aria-label={t('cancel')}
                className={compact ? 'rw-sheet-close rw-tap' : 'rw-tap'}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer', flexShrink: 0 }}>&times;</button>
            </div>

            <div className={compact ? 'rw-sheet-body' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {draft.map((row, i) => (
                <div key={i} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 10, background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <input className="modern-input ifbtn-field" value={row.label} onChange={e => setField(i, 'label', e.target.value)}
                      placeholder={t('ifaceBtnLabel')} maxLength={40} style={{ flex: 1, minWidth: 0 }} />
                    <button type="button" className="rw-tap" onClick={() => delDraft(i)} aria-label="Delete"
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '1.3rem', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>&times;</button>
                  </div>
                  <textarea className="modern-input ifbtn-field" value={row.cmdText} onChange={e => setField(i, 'cmdText', e.target.value)}
                    placeholder={t('ifaceBtnCommands')} rows={2} spellCheck={false} autoCapitalize="none" autoCorrect="off"
                    style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', resize: 'vertical' }} />
                </div>
              ))}
              {!draft.length && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center', padding: '10px 0' }}>{t('ifaceNoButtons')}</div>
              )}
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>{t('ifaceBtnCommandsHint')}</div>
            </div>

            <div className={compact ? 'rw-sheet-foot' : undefined} style={{ marginTop: compact ? 0 : 14 }}>
              {msg && (
                <div style={{
                  marginBottom: 10, padding: '8px 11px', borderRadius: 8, fontSize: '0.78rem',
                  background: msg.ok ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${msg.ok ? 'rgba(52,211,153,0.35)' : 'rgba(239,68,68,0.35)'}`,
                  color: msg.ok ? 'var(--success)' : 'var(--danger)',
                }}>{msg.ok ? '✓' : '✕'} {msg.text}</div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addDraft} style={{ minHeight: isTouch ? 44 : undefined }}>+ {t('ifaceAddButton')}</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={saveButtons} disabled={saving} style={{ minHeight: isTouch ? 44 : undefined, marginLeft: 'auto' }}>
                  {saving ? t('ifaceSavingButtons') : t('ifaceSaveButtons')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// VLAN tek seçim: liste varsa dropdown, yoksa sayı girişi. MODÜL SEVİYESİNDE tanımlı —
// bileşenin içinde tanımlanırsa her render'da yeni bileşen tipi olur, React <select>'i
// remount eder ve açık native dropdown seçim yapılmadan kapanırdı.
function VlanPick({ vlans, value, onChange }) {
  return vlans.length ? (
    <select className="modern-input" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">—</option>
      {vlans.map(v => <option key={v.id} value={String(v.id)}>{v.id} — {v.name}</option>)}
    </select>
  ) : (
    <input className="modern-input" style={{ width: '100%' }} type="number" min="1" max="4094"
      inputMode="numeric" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      value={value} onChange={e => onChange(e.target.value)} placeholder="VLAN id" />
  );
}

// "10,20,30-33" gibi VLAN listesini id kümesine aç (checkbox'ları işaretlemek için)
function expandVlanSpec(spec) {
  const ids = new Set();
  for (const part of String(spec || '').split(',')) {
    const p = part.trim();
    const range = p.match(/^(\d+)-(\d+)$/);
    if (range) {
      let a = +range[1], b = +range[2];
      if (a > b) { const tmp = a; a = b; b = tmp; }
      for (let i = a; i <= b && ids.size < 4096; i++) ids.add(i);
    } else if (/^\d+$/.test(p)) ids.add(+p);
  }
  return [...ids].sort((x, y) => x - y);
}

// "show running-config interface" çıktısından mevcut ayarları çıkar → formu otomatik doldur.
// allowed vlan birden çok satıra ("... allowed vlan add ...") yayılabilir → birleştirilir.
function parseInterfaceConfig(text) {
  const out = { mode: null, accessVlan: '', nativeVlan: '', allowedVlans: [], allowedExplicit: false, power: 'auto', shutdown: false };
  let allowedSpec = '';
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    let m;
    if (/^switchport mode access\b/i.test(l)) out.mode = 'access';
    else if (/^switchport mode trunk\b/i.test(l)) out.mode = 'trunk';
    else if ((m = l.match(/^switchport access vlan\s+(\d+)/i))) out.accessVlan = m[1];
    else if ((m = l.match(/^switchport trunk native vlan\s+(\d+)/i))) out.nativeVlan = m[1];
    else if (/^switchport trunk allowed vlan\s+none\b/i.test(l)) out.allowedExplicit = true; // hiçbiri
    else if ((m = l.match(/^switchport trunk allowed vlan\s+(?:add\s+)?([\d,\-]+)/i))) { out.allowedExplicit = true; allowedSpec += (allowedSpec ? ',' : '') + m[1]; }
    else if (/^power inline never\b/i.test(l)) out.power = 'never';
    else if (/^power inline auto\b/i.test(l)) out.power = 'auto';
    else if (/^shutdown$/i.test(l)) out.shutdown = true; // "no shutdown" varsayılan → run'da görünmez
  }
  out.allowedVlans = expandVlanSpec(allowedSpec).map(String);
  return out;
}
