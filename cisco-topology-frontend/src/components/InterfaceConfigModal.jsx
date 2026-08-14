import { useState, useEffect } from 'react';
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
  const [allowedVlans, setAllowedVlans] = useState([]); // string id'ler
  const [save, setSave] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState(null); // { ok, text }

  const loadOutput = () => {
    setOutLoading(true); setOutErr('');
    authFetch(`/switches/${deviceId}/interface-config?name=${encodeURIComponent(name)}`)
      .then(r => (r && r.ok ? r.json() : (r ? r.json().then(d => Promise.reject(d)) : Promise.reject({}))))
      .then(d => setOutput(d.output || ''))
      .catch(d => setOutErr((d && d.error) || t('ifaceLoadFail')))
      .finally(() => setOutLoading(false));
  };

  useEffect(() => {
    loadOutput();
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
    else { body.nativeVlan = nativeVlan || undefined; body.allowedVlans = allowedVlans.map(Number); }
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

  // VLAN tek seçim: liste varsa dropdown, yoksa sayı girişi
  const VlanPick = ({ value, onChange }) => (
    vlans.length ? (
      <select className="modern-input" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {vlans.map(v => <option key={v.id} value={String(v.id)}>{v.id} — {v.name}</option>)}
      </select>
    ) : (
      <input className="modern-input" style={{ width: '100%' }} type="number" min="1" max="4094"
        value={value} onChange={e => onChange(e.target.value)} placeholder="VLAN id" />
    )
  );

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
              <button className="btn btn-ghost btn-sm" onClick={loadOutput} disabled={outLoading} style={{ fontSize: '0.72rem', padding: '3px 10px' }}>↻</button>
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
                <VlanPick value={accessVlan} onChange={setAccessVlan} />
              </>
            ) : (
              <>
                <label style={label}>{t('ifaceNativeVlan')}</label>
                <VlanPick value={nativeVlan} onChange={setNativeVlan} />

                <label style={label}>{t('ifaceAllowedVlans')}</label>
                {vlans.length ? (
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 10px', maxHeight: 168, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))', gap: '5px 12px' }}>
                    {vlans.map(v => {
                      const vid = String(v.id);
                      const checked = allowedVlans.includes(vid);
                      return (
                        <label key={v.id} title={`${v.id} — ${v.name}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer', color: 'var(--text-main)' }}>
                          <input type="checkbox" checked={checked}
                            onChange={e => setAllowedVlans(prev => e.target.checked ? [...prev, vid] : prev.filter(x => x !== vid))} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.id} — {v.name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input className="modern-input" style={{ width: '100%' }}
                    value={allowedVlans.join(',')}
                    onChange={e => setAllowedVlans(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="10,20,30" />
                )}
                <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 4 }}>{t('ifaceAllowedHint')}</div>
              </>
            )}

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
