import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function MacSearchPage() {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim() || query.trim().length < 5) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await authFetch('/mac-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() })
      });
      if (res && res.ok) {
        const data = await res.json();
        if (data.error && data.results?.length === 0) {
          setError(data.error);
        } else {
          setResult(data);
        }
      } else {
        const d = await res?.json().catch(() => ({}));
        setError(d?.error || 'Search failed');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="list-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 40, marginTop: 20 }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 8 }}>
          MAC Address Search
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Find which switch port a device is connected to by IP or MAC address
        </p>
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, marginBottom: 30, maxWidth: 600, margin: '0 auto 30px' }}>
        <input
          className="modern-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Enter IP (10.41.0.50) or MAC (aa:bb:cc:dd:ee:ff)"
          style={{ flex: 1, fontSize: '1rem', padding: '12px 16px' }}
          autoFocus
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={loading || query.trim().length < 5}
          style={{ padding: '12px 24px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
          <p>Scanning switch MAC tables via SNMP...</p>
          <p style={{ fontSize: '0.8rem' }}>This may take 10-30 seconds depending on the number of devices and VLANs</p>
        </div>
      )}

      {error && !loading && (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </div>
      )}

      {result && !loading && (
        <div>
          {result.resolvedMac && (
            <div style={{ marginBottom: 16, padding: '10px 16px', background: 'rgba(99,102,241,0.1)', borderRadius: 8, border: '1px solid rgba(99,102,241,0.2)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>MAC Address: </span>
              <span style={{ color: 'var(--primary)', fontFamily: 'monospace', fontWeight: 600 }}>{result.resolvedMac}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 16 }}>Searched {result.searchedDevices} device(s)</span>
            </div>
          )}

          {result.results.length > 0 ? (
            <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Switch</th>
                    <th>IP</th>
                    <th>Port</th>
                    <th>VLAN</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r, i) => (
                    <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${r.switchId}`)}>
                      <td style={{ fontWeight: 600 }}>{r.switchName}</td>
                      <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.switchIp}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--primary)' }}>{r.port}</td>
                      <td>
                        <span style={{
                          background: 'rgba(99,102,241,0.15)', color: 'var(--primary)',
                          padding: '2px 10px', borderRadius: 12, fontSize: '0.8rem'
                        }}>
                          {r.vlan}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          background: r.type === 'access' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                          color: r.type === 'access' ? 'var(--success)' : '#f59e0b',
                          padding: '2px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 500
                        }}>
                          {r.type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔍</div>
              <p>MAC address not found in any switch MAC table</p>
              <p style={{ fontSize: '0.8rem' }}>The device may be offline or on a different network segment</p>
            </div>
          )}
        </div>
      )}

      {!loading && !result && !error && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <p>Supported formats:</p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            {['10.41.0.50', 'aa:bb:cc:dd:ee:ff', 'aabb.ccdd.eeff', 'AA-BB-CC-DD-EE-FF'].map(f => (
              <code key={f} style={{ background: 'var(--bg-panel)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-color)' }}>{f}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
