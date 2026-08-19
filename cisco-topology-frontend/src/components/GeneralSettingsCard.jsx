import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import { showToast } from '../Toast';

// Genel (cihaz geneli) ayarlar — sistem geneli, admin ayarlar. Ayarlar hub'indaki
// "General" kartinin popup icerigi. Simdilik: kablolu baglanti comet animasyonu toggle'i.
export default function GeneralSettingsCard({ embedded }) {
  const { general, setGeneral } = useApp();
  const { authFetch, isAdmin } = useAuth();
  // isTouch = (hover: none). Hover olmayan cihazda title= ipucu HIC gorunmez,
  // bu yuzden "neden kapali" bilgisi satirin icine yazilir.
  const { isPhone, isShort, isTouch } = useViewport();
  const compact = isPhone || isShort;
  // Dokunmatikte SATIRIN TAMAMI hedef olsun: satir <label> olur, ic anahtar
  // <span>'e iner (ic ice <label> gecersiz HTML'dir).
  // Masaustunde (hover'li + genis + yuksek) ESKI yapi birebir korunur:
  // satir <div>, anahtar <label> — yoksa aciklama metnine tiklamak/secmek
  // ayari degistirirdi ki bu bir masaustu davranis degisikligidir.
  const rowAsLabel = isTouch || compact;
  const Row = rowAsLabel ? 'label' : 'div';
  const Switch = rowAsLabel ? 'span' : 'label';

  const cometOn = general.cometAnimation !== false;
  const wirelessOn = general.wirelessAnimation !== false;

  // System Name: metin alani — her tusta degil, odaktan cikinca/Enter'da kaydedilir.
  // general async yuklendigi icin degeri gelince yerel state senkronlanir.
  const [nameInput, setNameInput] = useState(general.systemName || '');
  useEffect(() => { setNameInput(general.systemName || ''); }, [general.systemName]);

  // Tek bir ayar alanini aninda uygula + kaydet; basarisiz olursa geri al.
  const save = async (patch) => {
    const prev = general;
    setGeneral(g => ({ ...g, ...patch })); // aninda uygula (animasyon canli acilir/kapanir)
    try {
      const res = await authFetch('/settings/general', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res && res.ok) {
        setGeneral(await res.json());
        showToast('Settings saved', 'success');
      } else {
        setGeneral(prev); // basarisiz -> geri al
        const e = await res.json().catch(() => ({}));
        showToast(e.error || 'Save failed', 'error');
      }
    } catch (e) {
      setGeneral(prev);
      showToast('Connection error', 'error');
    }
  };

  // System Name'i kaydet (degismediyse dokunma).
  const commitName = () => {
    const v = nameInput.trim().slice(0, 60);
    if (v === (general.systemName || '')) return;
    save({ systemName: v });
  };

  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 20 };

  return (
    <div style={embedded ? undefined : cardStyle}>
      <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Device-wide display &amp; behavior for the whole system. Applies to every user.
      </p>

      {/* Sistem adi — browser sekme basliginda gorunur. Metin alani oldugu icin
          toggle'lar gibi aninda degil, odak kaybinda / Enter'da kaydedilir. */}
      <div style={{ padding: '14px 0', borderTop: '1px solid var(--border-color)' }}>
        <label htmlFor="sys-name" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>System Name</label>
        <input id="sys-name" className="modern-input" style={{ width: '100%' }} value={nameInput} disabled={!isAdmin}
          onChange={e => setNameInput(e.target.value)} onBlur={commitName}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          maxLength={60} placeholder="e.g. İSU SCADA" autoComplete="off" spellCheck={false} />
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
          Shown in the browser tab — “NetPulse - {nameInput.trim() || 'System Name'}”. Leave empty for just “NetPulse”.
        </div>
        {isTouch && !isAdmin && <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: 4 }}>Locked — administrators only</div>}
      </div>

      {/* Kablolu comet animasyonu.
          Dokunmatikte satirin tamami <label> (bkz. rowAsLabel), masaustunde <div>. */}
      <Row style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', minHeight: compact ? 44 : undefined, borderTop: '1px solid var(--border-color)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>Wired link comet animation</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>
            The sliding light that travels along active wired connections. Turn off to reduce CPU on large maps.
          </div>
          {isTouch && !isAdmin && (
            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: 4 }}>Locked — administrators only</div>
          )}
        </div>
        <Switch className="toggle-switch" title={isAdmin ? '' : 'Administrators only'} style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={cometOn} disabled={!isAdmin} onChange={e => save({ cometAnimation: e.target.checked })} />
          <span className="toggle-slider" />
        </Switch>
      </Row>

      {/* Kablosuz (anten) animasyonu — ayni satir duzeni */}
      <Row style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', minHeight: compact ? 44 : undefined, borderTop: '1px solid var(--border-color)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>Wireless link animation</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>
            The flowing dashes on active antenna-to-antenna links. Turn off to reduce CPU on large maps.
          </div>
          {isTouch && !isAdmin && (
            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: 4 }}>Locked — administrators only</div>
          )}
        </div>
        <Switch className="toggle-switch" title={isAdmin ? '' : 'Administrators only'} style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={wirelessOn} disabled={!isAdmin} onChange={e => save({ wirelessAnimation: e.target.checked })} />
          <span className="toggle-slider" />
        </Switch>
      </Row>

      {!isAdmin && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
          Only administrators can change these settings.
        </div>
      )}
    </div>
  );
}
