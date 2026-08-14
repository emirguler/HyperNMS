import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';

// Cihaz detayı → fiziksel arayüz satırındaki "Config" butonu bunu açar.
// Sol: arayüzün mevcut ayarları (show running-config interface <name>).
// Sağ: mode (access/trunk) + VLAN seçimleriyle yeni ayar uygula. Hem user hem admin.
export default function InterfaceConfigModal({ deviceId, iface, onClose }) {
  const { authFetch } = useAuth();
  const name = iface?.name || '';

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

  const label = { fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6, marginTop: 14 };

  return (
    <div className="modal-overlay" onClick={() => onClose()} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" style={{ width: 780, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {t('ifaceConfigTitle')} — <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{name}</span>
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {/* SOL: mevcut ayarlar */}
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('ifaceCurrentCfg')}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => loadOutput(true)} disabled={outLoading}
                title={t('ifaceRefreshRevert')} style={{ fontSize: '0.72rem', padding: '3px 10px' }}>↻</button>
            </div>
            <pre style={{
              margin: 0, background: '#000', color: '#e5e7eb', border: '1px solid var(--border-color)', borderRadius: 8,
              padding: 12, fontSize: '0.78rem', fontFamily: 'monospace', minHeight: 220, maxHeight: 340, overflow: 'auto', whiteSpace: 'pre-wrap'
            }}>
              {outLoading ? `⏳ ${t('loading')}...` : (outErr ? `✕ ${outErr}` : (output || '—'))}
            </pre>
          </div>

          {/* SAĞ: yeni ayar */}
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
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
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 10px', maxHeight: 168, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))', gap: '5px 12px' }}>
                    {vlans.map(v => {
                      const vid = String(v.id);
                      const checked = allowedAll || allowedVlans.includes(vid);
                      return (
                        <label key={v.id} title={`${v.id} — ${v.name}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer', color: 'var(--text-main)' }}>
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
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.id} — {v.name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input className="modern-input" style={{ width: '100%' }}
                    value={allowedVlans.join(',')}
                    onChange={e => { setAllowedAll(false); setAllowedVlans(e.target.value.split(',').map(s => s.trim()).filter(Boolean)); }}
                    placeholder="10,20,30" />
                )}
                <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 4 }}>{t('ifaceAllowedHint')}</div>
              </>
            )}

            {/* Power inline (auto/never) ve Shutdown — mod'dan bağımsız, toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{t('ifacePowerInline')}</div>
                <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{powerAuto ? 'auto' : 'never'}</div>
              </div>
              <label className="toggle-switch" style={{ flexShrink: 0 }}>
                <input type="checkbox" checked={powerAuto} onChange={e => setPowerAuto(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{t('ifaceShutdown')}</div>
                <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: shut ? 'var(--danger)' : '#facc15' }}>{shut ? 'shutdown' : 'no shutdown'}</div>
              </div>
              {/* Sağ/açık = no shutdown (sarı), sol/kapalı = shutdown (kırmızı) → checked = !shut */}
              <label className="toggle-switch toggle-shutdown" style={{ flexShrink: 0 }}>
                <input type="checkbox" checked={!shut} onChange={e => setShut(!e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />
              {t('ifaceSaveStartup')}
            </label>

            <button className="btn btn-primary" onClick={apply} disabled={applying}
              style={{ width: '100%', marginTop: 16 }}>
              {applying ? `⏳ ${t('ifaceApplying')}` : t('ifaceApply')}
            </button>

            {applyMsg && (
              <div style={{
                marginTop: 12, padding: '9px 12px', borderRadius: 8, fontSize: '0.8rem',
                background: applyMsg.ok ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                border: `1px solid ${applyMsg.ok ? 'rgba(52,211,153,0.35)' : 'rgba(239,68,68,0.35)'}`,
                color: applyMsg.ok ? 'var(--success)' : 'var(--danger)'
              }}>
                {applyMsg.ok ? '✓' : '✕'} {applyMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>
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
