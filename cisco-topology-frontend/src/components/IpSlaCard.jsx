import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

// Return Code → renk/etiket. ok/timeout ana durumlar; diğerleri uyarı (sarı).
const STATUS_META = {
  ok:      { color: 'var(--success)', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)', label: 'OK' },
  timeout: { color: 'var(--danger)',  bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', label: 'Timeout' },
};
const FALLBACK = { color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' };

export default function IpSlaCard({ deviceId }) {
  const { authFetch } = useAuth();
  const [slas, setSlas] = useState(null); // null = henüz yüklenmedi

  const fetchSla = useCallback(async () => {
    try {
      const res = await authFetch(`/switches/${deviceId}/ip-sla`);
      if (res && res.ok) {
        const data = await res.json();
        setSlas(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  }, [deviceId, authFetch]);

  useEffect(() => {
    fetchSla();
    const i = setInterval(fetchSla, 30000);
    return () => clearInterval(i);
  }, [fetchSla]);

  // IP SLA yapılandırılmamış cihazlarda kartı hiç gösterme → sayfa düzeni bozulmaz
  if (!slas || slas.length === 0) return null;

  return (
    <div className="chart-container no-float" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary)' }}>IP SLA</h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{slas.length} operation{slas.length > 1 ? 's' : ''}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="modern-table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 24 }}>ID</th>
              <th>Tag</th>
              <th>Target</th>
              <th>RTT</th>
              <th style={{ paddingRight: 24 }}>Return Code</th>
            </tr>
          </thead>
          <tbody>
            {slas.map(s => {
              const meta = STATUS_META[s.status] || FALLBACK;
              const label = STATUS_META[s.status] ? meta.label : s.status;
              return (
                <tr key={s.id}>
                  <td style={{ paddingLeft: 24, fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.id}</td>
                  <td style={{ fontSize: '0.85rem' }}>{s.tag || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{s.target || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.status === 'ok' && s.rtt != null ? `${s.rtt} ms` : '-'}</td>
                  <td style={{ paddingRight: 24 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color }} />
                      {label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
