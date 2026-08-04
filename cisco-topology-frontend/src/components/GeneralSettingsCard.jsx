import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../Toast';

// Genel (cihaz geneli) ayarlar — sistem geneli, admin ayarlar. Ayarlar hub'indaki
// "General" kartinin popup icerigi. Simdilik: kablolu baglanti comet animasyonu toggle'i.
export default function GeneralSettingsCard({ embedded }) {
  const { general, setGeneral } = useApp();
  const { authFetch, isAdmin } = useAuth();

  const cometOn = general.cometAnimation !== false;

  const setComet = async (on) => {
    const prev = general;
    setGeneral(g => ({ ...g, cometAnimation: on })); // aninda uygula (comet canli acilir/kapanir)
    try {
      const res = await authFetch('/settings/general', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cometAnimation: on }),
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

  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 20 };

  return (
    <div style={embedded ? undefined : cardStyle}>
      <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Device-wide display &amp; behavior for the whole system. Applies to every user.
      </p>

      {/* Comet animasyonu */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>Wired link comet animation</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>
            The sliding light that travels along active wired connections on the topology map.
          </div>
        </div>
        <label className="toggle-switch" title={isAdmin ? '' : 'Administrators only'} style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={cometOn} disabled={!isAdmin} onChange={e => setComet(e.target.checked)} />
          <span className="toggle-slider" />
        </label>
      </div>

      {!isAdmin && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
          Only administrators can change these settings.
        </div>
      )}
    </div>
  );
}
