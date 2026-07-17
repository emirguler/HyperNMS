import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import BulkImportModal from '../components/BulkImportModal';
import FindDeviceModal from '../components/FindDeviceModal';
import ConfirmModal from '../components/ConfirmModal';
import { showToast } from '../Toast';
import { t } from '../i18n';
import { API_BASE } from '../config';

export default function DeviceListPage({ onEdit }) {
  const { rawDevices, topoTabs, fetchData } = useApp();
  const { isAdmin, authFetch } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [topoFilter, setTopoFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showFindDevice, setShowFindDevice] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchForm, setBatchForm] = useState({ sshUsername: '', sshPassword: '', snmpCommunity: '', tags: '', topologyPage: '' });

  // Topology page id → okunabilir sayfa adı
  const pageName = (id) => topoTabs.find(tab => tab.id === (id || 'main'))?.name || (id || 'main');

  const filteredDevices = useMemo(() => {
    let list = [...rawDevices];
    if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter);
    if (topoFilter !== 'all') {
      list = list.filter(d => (d.topologyPage || 'main') === topoFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d => d.name?.toLowerCase().includes(q) || d.ip?.toLowerCase().includes(q) || d.type?.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let valA, valB;
      if (sortConfig.key === 'latency') {
        valA = Number(a.latency ?? 0); valB = Number(b.latency ?? 0);
      } else if (sortConfig.key === 'topologyPage') {
        // id yerine okunabilir sayfa adına göre sırala
        valA = pageName(a.topologyPage).toLowerCase(); valB = pageName(b.topologyPage).toLowerCase();
      } else {
        valA = String(a[sortConfig.key] ?? '').toLowerCase(); valB = String(b[sortConfig.key] ?? '').toLowerCase();
      }
      if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [rawDevices, searchQuery, sortConfig, statusFilter, topoFilter, topoTabs]);

  const handleSort = (key) => setSortConfig(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  const sortIcon = (key) => sortConfig.key === key ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await authFetch(`/switches/${deleteTarget.id}`, { method: 'DELETE' });
    if (res.ok) showToast(`"${deleteTarget.name}" ${t('deleted')}`, 'success');
    else { const d = await res.json().catch(() => ({})); showToast(d.error || t('deleteFailed'), 'error'); }
    setDeleteTarget(null);
    fetchData();
  };

  const handleExportCSV = async () => {
    try {
      const res = await fetch(`${API_BASE}/switches/export/csv`, { credentials: 'include' });
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

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDevices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDevices.map(d => d.id)));
    }
  };

  const handleBatchSubmit = async () => {
    const updates = {};
    if (batchForm.sshUsername) updates.sshUsername = batchForm.sshUsername;
    if (batchForm.sshPassword) updates.sshPassword = batchForm.sshPassword;
    if (batchForm.snmpCommunity) updates.snmpCommunity = batchForm.snmpCommunity;
    if (batchForm.tags) updates.tags = batchForm.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (batchForm.topologyPage) updates.topologyPage = batchForm.topologyPage;

    if (Object.keys(updates).length === 0) {
      showToast('No fields filled in', 'error');
      return;
    }

    try {
      const res = await authFetch('/switches/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], updates })
      });
      if (res && res.ok) {
        showToast(`${selectedIds.size} device(s) updated`, 'success');
        setSelectedIds(new Set());
        setShowBatchEdit(false);
        setBatchForm({ sshUsername: '', sshPassword: '', snmpCommunity: '', tags: '', topologyPage: '' });
        fetchData();
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Batch update failed', 'error');
      }
    } catch {
      showToast('Batch update failed', 'error');
    }
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
        <select className="modern-input" value={topoFilter} onChange={e => setTopoFilter(e.target.value)}
          style={{ width: 'auto', minWidth: 140, fontSize: '0.8rem', padding: '8px 12px' }}>
          <option value="all">All Pages</option>
          {topoTabs.map(tab => (
            <option key={tab.id} value={tab.id}>{tab.name}</option>
          ))}
        </select>
        {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => setShowFindDevice(true)} title={t('findDeviceTitle')}>🔍 {t('findDevice')}</button>}
        {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => setShowBulkImport(true)} title="Bulk Import">📤 Import List</button>}
        {isAdmin && <button className="btn btn-ghost btn-sm" onClick={handleExportCSV} title="Export CSV">📥 Download List</button>}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{filteredDevices.length} / {rawDevices.length} {t('deviceCount')}</span>
      </div>

      {isAdmin && selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 16px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>{selectedIds.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={() => setShowBatchEdit(true)}>Batch Edit</button>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmBatchDelete(true)}>Delete Selected</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}>Deselect All</button>
        </div>
      )}

      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="modern-table">
          <thead>
            <tr>
              {isAdmin && <th style={{ width: 40, textAlign: 'center' }}><input type="checkbox" checked={filteredDevices.length > 0 && selectedIds.size === filteredDevices.length} onChange={toggleSelectAll} /></th>}
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('status')}>Status{sortIcon('status')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Name{sortIcon('name')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('ip')}>IP Address{sortIcon('ip')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('type')}>Type{sortIcon('type')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('topologyPage')}>Page{sortIcon('topologyPage')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('latency')}>Latency{sortIcon('latency')}</th>
              <th>Tags</th>
              {isAdmin && <th style={{ textAlign: 'right', paddingRight: 32 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length > 0 ? filteredDevices.map(d => (
              <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${d.id}`, { state: { from: '/devices' } })}>
                {isAdmin && <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggleSelect(d.id)} /></td>}
                <td><span className={`status-badge ${d.status === 'UP' ? 'status-up' : 'status-down'}`}>{d.status}</span></td>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{d.ip}</td>
                <td style={{ textTransform: 'capitalize' }}>{d.type}</td>
                <td style={{ color: 'var(--text-muted)' }}>{pageName(d.topologyPage)}</td>
                <td style={{ color: d.latency > 100 ? 'var(--danger)' : 'var(--text-muted)' }}>{d.latency > 0 ? d.latency + ' ms' : '-'}</td>
                <td>
                  {(d.tags || []).map(tag => (
                    <span key={tag} style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 12, fontSize: '0.7rem', marginRight: 4 }}>{tag}</span>
                  ))}
                </td>
                {isAdmin && (
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-primary btn-sm" style={{ marginRight: 8 }} onClick={(e) => { e.stopPropagation(); onEdit(d); }}>{t('edit')}</button>
                    <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(d); }}>{t('delete')}</button>
                  </td>
                )}
              </tr>
            )) : (
              <tr><td colSpan={isAdmin ? 9 : 7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                {searchQuery || statusFilter !== 'all' ? t('noFilterResult') : t('noDevicesYet')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Enter') confirmDelete(); if (e.key === 'Escape') setDeleteTarget(null); }}>
          <div className="confirm-modal-content">
            <h3 className="confirm-title">{t('deleteDevice')}</h3>
            <p className="confirm-desc">{t('deleteDeviceConfirm')} <strong>{deleteTarget.name}</strong> ({deleteTarget.ip})? {t('deleteDeviceWarn')}</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDelete} autoFocus>{t('yesDelete')}</button>
            </div>
          </div>
        </div>
      )}

      {showBatchEdit && (
        <div className="modal-overlay" onClick={() => setShowBatchEdit(false)} onKeyDown={e => { if (e.key === 'Escape') setShowBatchEdit(false); }}>
          <div className="modal-content" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>Batch Edit ({selectedIds.size} devices)</h2>
              <button onClick={() => setShowBatchEdit(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 16 }}>Only filled fields will be updated. Leave blank to skip.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>SSH Username</label>
                <input className="modern-input" value={batchForm.sshUsername} onChange={e => setBatchForm(p => ({ ...p, sshUsername: e.target.value }))} autoComplete="off" />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>SSH Password</label>
                <input className="modern-input" type="password" value={batchForm.sshPassword} onChange={e => setBatchForm(p => ({ ...p, sshPassword: e.target.value }))} autoComplete="new-password" />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>SNMP Community</label>
                <input className="modern-input" value={batchForm.snmpCommunity} onChange={e => setBatchForm(p => ({ ...p, snmpCommunity: e.target.value }))} />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>Tags (comma-separated)</label>
                <input className="modern-input" value={batchForm.tags} onChange={e => setBatchForm(p => ({ ...p, tags: e.target.value }))} placeholder="core, datacenter" />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>Topology Page</label>
                <select className="modern-input" value={batchForm.topologyPage} onChange={e => setBatchForm(p => ({ ...p, topologyPage: e.target.value }))}>
                  <option value="">-- No change --</option>
                  {topoTabs.map(tab => (
                    <option key={tab.id} value={tab.id}>{tab.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setShowBatchEdit(false)}>{t('cancel')}</button>
              <button className="btn btn-primary" onClick={handleBatchSubmit}>Apply Changes</button>
            </div>
          </div>
        </div>
      )}

      {showBulkImport && <BulkImportModal onClose={() => setShowBulkImport(false)} />}
      {showFindDevice && <FindDeviceModal onClose={() => setShowFindDevice(false)} />}

      {confirmBatchDelete && (
        <ConfirmModal
          title={t('deleteDevice')}
          message={`${selectedIds.size} ${t('deleteSelectedConfirm')}`}
          onCancel={() => setConfirmBatchDelete(false)}
          onConfirm={async () => {
            setConfirmBatchDelete(false);
            let deleted = 0;
            for (const id of selectedIds) {
              const res = await authFetch(`/switches/${id}`, { method: 'DELETE' });
              if (res && res.ok) deleted++;
            }
            showToast(`${deleted} device(s) deleted`, 'success');
            setSelectedIds(new Set());
            fetchData();
          }}
        />
      )}
    </div>
  );
}
