import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../Toast';
import { t } from '../i18n';
import { API_BASE } from '../config';

export default function DeviceListPage({ onEdit }) {
  const { rawDevices, fetchData } = useApp();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const filteredDevices = useMemo(() => {
    let list = [...rawDevices];
    if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d => d.name?.toLowerCase().includes(q) || d.ip?.toLowerCase().includes(q) || d.type?.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let valA = a[sortConfig.key] ?? '';
      let valB = b[sortConfig.key] ?? '';
      if (sortConfig.key === 'latency') { valA = Number(valA); valB = Number(valB); }
      else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
      if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [rawDevices, searchQuery, sortConfig, statusFilter]);

  const handleSort = (key) => setSortConfig(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  const sortIcon = (key) => sortConfig.key === key ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`${API_BASE}/switches/${deleteTarget.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) showToast(`"${deleteTarget.name}" ${t('deleted')}`, 'success');
    else { const d = await res.json().catch(() => ({})); showToast(d.error || t('deleteFailed'), 'error'); }
    setDeleteTarget(null);
    fetchData();
  };

  const handleExportCSV = async () => {
    try {
      const res = await fetch(`${API_BASE}/switches/export/csv`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'devices.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV exported', 'success');
      }
    } catch { showToast('Export failed', 'error'); }
  };

  return (
    <div className="list-container">
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <input className="modern-input" placeholder={t('searchPlaceholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ paddingLeft: 40 }} />
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '1rem', pointerEvents: 'none' }}>🔍</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ label: t('all'), value: 'all' }, { label: 'UP', value: 'UP' }, { label: 'DOWN', value: 'DOWN' }].map(f => (
            <button key={f.value} className={`nav-btn ${statusFilter === f.value ? 'active' : ''}`}
              style={{ fontSize: '0.8rem', padding: '8px 14px', border: '1px solid var(--border-color)' }}
              onClick={() => setStatusFilter(f.value)}>{f.label}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleExportCSV} title="Export CSV">📥 CSV</button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{filteredDevices.length} / {rawDevices.length} {t('deviceCount')}</span>
      </div>

      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="modern-table">
          <thead>
            <tr>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('status')}>Status{sortIcon('status')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Name{sortIcon('name')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('ip')}>IP Address{sortIcon('ip')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('type')}>Type{sortIcon('type')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('latency')}>Latency{sortIcon('latency')}</th>
              <th>Tags</th>
              <th style={{ textAlign: 'right', paddingRight: 32 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length > 0 ? filteredDevices.map(d => (
              <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${d.id}`)}>
                <td><span className={`status-badge ${d.status === 'UP' ? 'status-up' : 'status-down'}`}>{d.status}</span></td>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{d.ip}</td>
                <td style={{ textTransform: 'capitalize' }}>{d.type}</td>
                <td style={{ color: d.latency > 100 ? 'var(--danger)' : 'var(--text-muted)' }}>{d.latency > 0 ? d.latency + ' ms' : '-'}</td>
                <td>
                  {(d.tags || []).map(tag => (
                    <span key={tag} style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 12, fontSize: '0.7rem', marginRight: 4 }}>{tag}</span>
                  ))}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-primary btn-sm" style={{ marginRight: 8 }} onClick={(e) => { e.stopPropagation(); onEdit(d); }}>{t('edit')}</button>
                  <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(d); }}>{t('delete')}</button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                {searchQuery || statusFilter !== 'all' ? t('noFilterResult') : t('noDevicesYet')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <div className="modal-overlay">
          <div className="confirm-modal-content">
            <h3 className="confirm-title">{t('deleteDevice')}</h3>
            <p className="confirm-desc">{t('deleteDeviceConfirm')} <strong>{deleteTarget.name}</strong> ({deleteTarget.ip})? {t('deleteDeviceWarn')}</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDelete}>{t('yesDelete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
