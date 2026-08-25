import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import BulkImportModal from '../components/BulkImportModal';
import FindDeviceModal from '../components/FindDeviceModal';
import ConfirmModal from '../components/ConfirmModal';
import { showToast } from '../Toast';
import { t } from '../i18n';
import { API_BASE } from '../config';

// Dokunmatikte secim kutusu hucreyi kaplayan 44x44 bir etikete donusur;
// masaustunde etiket ciplak kalir (stil yok) ki gorunum aynen korunsun.
const TAP_BOX = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 44,
  minHeight: 44,
  margin: '-11px -12px',
  cursor: 'pointer',
};

// <=600px'te thead gizlendigi icin siralama tablonun ustundeki select'e tasinir.
// Dar govdedeki uclu yonetici eylem satiri. Yatay dolgu BILEREK verilmiyor:
// (pointer:coarse) blogu .btn-sm'e "padding: 10px 14px !important" diyor ve
// inline stil onu ezemez. 0.75rem punto + tek satir kirpma ile uc dugme 375px'e
// rahat sigiyor. Yukseklik durum segmentiyle ayni hizada (40px).
const COMPACT_ACTION = {
  fontSize: '0.75rem', minHeight: 40, justifyContent: 'center', minWidth: 0,
};

const SORT_OPTIONS = [
  { v: 'name|asc', label: 'Sort: Name A-Z' },
  { v: 'name|desc', label: 'Sort: Name Z-A' },
  { v: 'status|asc', label: 'Sort: Status' },
  { v: 'ip|asc', label: 'Sort: IP Address' },
  { v: 'latency|desc', label: 'Sort: Latency (high first)' },
  { v: 'latency|asc', label: 'Sort: Latency (low first)' },
];

export default function DeviceListPage({ onEdit }) {
  const { rawDevices, topoTabs, fetchData } = useApp();
  const { isAdmin, authFetch } = useAuth();
  const { isPhone, isShort, isTouch } = useViewport();
  // "Dar govde": telefon genisligi VEYA kisa (yatay telefon) ekran
  const compact = isPhone || isShort;
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [topoFilter, setTopoFilter] = useState('all');
  // Varsayilan 'switch': envanterin buyuk cogunlugu switch; anten/router gibi
  // tipler tek dokunusla secilir. (Dashboard'daki DOWN karti da ayni varsayilani
  // kullanir, iki sayfa tutarli acilir.)
  const [typeFilter, setTypeFilter] = useState('switch');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showFindDevice, setShowFindDevice] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [detailedLoading, setDetailedLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchForm, setBatchForm] = useState({ sshUsername: '', sshPassword: '', snmpCommunity: '', tags: '', topologyPage: '', ipSlaEnabled: '', ipSlaOkLabel: '', ipSlaFailLabel: '' });

  // Topology page id → okunabilir sayfa adı
  const pageName = (id) => topoTabs.find(tab => tab.id === (id || 'main'))?.name || (id || 'main');

  const filteredDevices = useMemo(() => {
    let list = [...rawDevices];
    if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter);
    if (topoFilter !== 'all') {
      list = list.filter(d => (d.topologyPage || 'main') === topoFilter);
    }
    // Tipi bos kalmis eski kayitlar switch sayilir — uygulamanin geri kalaninda
    // (topoloji ikonu, Dashboard filtreleri) ayni varsayim gecerli. Varsayilan
    // filtre artik 'switch' oldugu icin bu sart: aksi halde tipsiz cihazlar
    // listeden sessizce dusecekti.
    if (typeFilter !== 'all') list = list.filter(d => (d.type || 'switch') === typeFilter);
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
      } else if (sortConfig.key === 'version') {
        // Sürüm: sayısal-duyarlı karşılaştırma ("9.3" < "17.6", düz metinde ters çıkardı)
        const cmp = String(a.version ?? '').localeCompare(String(b.version ?? ''), undefined, { numeric: true, sensitivity: 'base' });
        return sortConfig.dir === 'asc' ? cmp : -cmp;
      } else {
        valA = String(a[sortConfig.key] ?? '').toLowerCase(); valB = String(b[sortConfig.key] ?? '').toLowerCase();
      }
      if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [rawDevices, searchQuery, sortConfig, statusFilter, topoFilter, typeFilter, topoTabs]);

  // Cihaz tipleri elde yazilmaz, kayitlardan turetilir: yeni bir tip eklenirse
  // (or. router, firewall) filtre kendiliginden onu da listeler.
  // Secili tip her zaman listede olmali: cihazlar henuz yuklenmemisken ya da o
  // tipten hic kayit kalmamisken select bos gorunmesin.
  const deviceTypes = useMemo(() => {
    const set = new Set(rawDevices.map(d => d.type).filter(Boolean));
    if (typeFilter !== 'all') set.add(typeFilter);
    return [...set].sort();
  }, [rawDevices, typeFilter]);

  const handleSort = (key) => setSortConfig(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  const sortIcon = (key) => sortConfig.key === key ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const sortValue = `${sortConfig.key}|${sortConfig.dir}`;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await authFetch(`/switches/${deleteTarget.id}`, { method: 'DELETE' });
    // authFetch 401'de null doner; guard yoksa oturum dusunce uygulama ErrorBoundary'e cakiliyor
    if (res && res.ok) showToast(`"${deleteTarget.name}" ${t('deleted')}`, 'success');
    else { const d = res ? await res.json().catch(() => ({})) : {}; showToast(d.error || t('deleteFailed'), 'error'); }
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
        setShowDownloadMenu(false);
      }
    } catch { showToast('Export failed', 'error'); }
  };

  // Detaylı liste: her cihazdan SNMP ile serial/model/version toplanır (yavaş)
  const handleExportDetailed = async () => {
    setDetailedLoading(true);
    try {
      const res = await fetch(`${API_BASE}/switches/export/detailed`, { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'devices-detailed.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Detailed CSV exported', 'success');
        setShowDownloadMenu(false);
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Export failed', 'error');
      }
    } catch { showToast('Export failed', 'error'); }
    finally { setDetailedLoading(false); }
  };

  // Toplu islemler YALNIZCA hem secili hem GORUNUR cihazlara uygulanir.
  // Secim filtre degisince temizlenmiyordu; "hepsini sec -> tipe gore filtrele ->
  // Sil" ekranda hic gormedigin cihazlari da siliyordu. Kesisim almak, gosterilen
  // sayinin gercekten islenecek sayi olmasini garantiler.
  const selectedVisible = useMemo(
    () => filteredDevices.filter(d => selectedIds.has(d.id)),
    [filteredDevices, selectedIds]
  );
  const hiddenSelectedCount = selectedIds.size - selectedVisible.length;

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
    if (batchForm.ipSlaEnabled) updates.ipSlaEnabled = batchForm.ipSlaEnabled === 'on';
    if (batchForm.ipSlaOkLabel) updates.ipSlaOkLabel = batchForm.ipSlaOkLabel;
    if (batchForm.ipSlaFailLabel) updates.ipSlaFailLabel = batchForm.ipSlaFailLabel;

    if (Object.keys(updates).length === 0) {
      showToast('No fields filled in', 'error');
      return;
    }

    try {
      const res = await authFetch('/switches/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedVisible.map(d => d.id), updates })
      });
      if (res && res.ok) {
        showToast(`${selectedVisible.length} device(s) updated`, 'success');
        setSelectedIds(new Set());
        setShowBatchEdit(false);
        setBatchForm({ sshUsername: '', sshPassword: '', snmpCommunity: '', tags: '', topologyPage: '', ipSlaEnabled: '', ipSlaOkLabel: '', ipSlaFailLabel: '' });
        fetchData();
      } else {
        const d = res ? await res.json().catch(() => ({})) : {};
        showToast(d.error || 'Batch update failed', 'error');
      }
    } catch {
      showToast('Batch update failed', 'error');
    }
  };

  return (
    <div className="list-container">
      {/* Arac cubugu.
          Masaustu: tek satirda yan yana — eskisiyle birebir ayni.
          Dar govde: filtreler ARTIK GIZLI DEGIL. Eski "⚙ Filters" dugmesi
          filtreleri gorunmez kiliyordu; hangi filtrenin acik oldugunu anlamak
          icin once dugmeye basmak gerekiyordu. Yerine sikistirilmis bir duzen
          kondu: durum uc parcali tek bir segment, iki select yan yana, yonetici
          eylemleri uclu satir. Hepsi acik haldeyken bile eski "acik filtre"
          gorunumunun yaklasik yarisi kadar dikey yer kapliyor.
          Sarmalayicilar masaustunde display:contents ile "yokmus gibi" davranir,
          boylece masaustu yerlesimi hic degismez. */}
      <div className="rw-actions" style={{ display: 'flex', gap: compact ? 8 : 12, marginBottom: compact ? 12 : 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: compact ? '100%' : 200 }}>
          {/* type="search" SADECE dokunmatikte: masaustu Chrome/Safari bu tipe kendi
              temizle (x) dugmesini ve searchfield gorunumunu ekliyor -> masaustu degisirdi. */}
          <input className="modern-input" type={isTouch ? 'search' : undefined} enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder={t('searchPlaceholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ paddingLeft: 40 }} />
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '1rem', pointerEvents: 'none' }}>🔍</span>
        </div>

        {/* Durum filtresi — dar govdede uc esit parcali segment kontrolu */}
        <div style={compact
          ? { display: 'flex', width: '100%', border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }
          : { display: 'flex', gap: 6 }}>
          {[{ label: t('all'), value: 'all' }, { label: 'UP', value: 'UP' }, { label: 'DOWN', value: 'DOWN' }].map((f, i) => (
            <button key={f.value} className={`nav-btn ${statusFilter === f.value ? 'active' : ''}`}
              style={compact
                ? { flex: 1, minWidth: 0, justifyContent: 'center', fontSize: '0.82rem', padding: '9px 4px', minHeight: 40, border: 'none', borderLeft: i ? '1px solid var(--border-color)' : 'none', borderRadius: 0 }
                : { fontSize: '0.8rem', padding: '8px 14px', border: '1px solid var(--border-color)' }}
              onClick={() => setStatusFilter(f.value)}>{f.label}</button>
          ))}
        </div>

        {/* Sayfa + tip filtreleri — dar govdede yan yana iki kolon */}
        <div style={compact ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' } : { display: 'contents' }}>
          <select className="modern-input" value={topoFilter} onChange={e => setTopoFilter(e.target.value)}
            style={{ width: compact ? '100%' : 'auto', minWidth: 0, ...(compact ? null : { minWidth: 140, fontSize: '0.8rem' }), padding: compact ? '8px 10px' : '8px 12px' }}>
            <option value="all">All Pages</option>
            {topoTabs.map(tab => (
              <option key={tab.id} value={tab.id}>{tab.name}</option>
            ))}
          </select>
          <select className="modern-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            style={{ width: compact ? '100%' : 'auto', minWidth: 0, ...(compact ? null : { minWidth: 130, fontSize: '0.8rem' }), padding: compact ? '8px 10px' : '8px 12px', textTransform: 'capitalize' }}>
            <option value="all">All Types</option>
            {deviceTypes.map(tp => (
              <option key={tp} value={tp}>{tp}</option>
            ))}
          </select>
        </div>

        {/* Yonetici eylemleri — dar govdede uclu satir, kisa etiketlerle */}
        {isAdmin && (
          <div style={compact ? { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: '100%' } : { display: 'contents' }}>
            <button className="btn btn-ghost btn-sm rw-truncate" style={compact ? COMPACT_ACTION : undefined}
              onClick={() => setShowFindDevice(true)} title={t('findDeviceTitle')}>🔍 {compact ? 'Find' : t('findDevice')}</button>
            <button className="btn btn-ghost btn-sm rw-truncate" style={compact ? COMPACT_ACTION : undefined}
              onClick={() => setShowBulkImport(true)} title="Bulk Import">📤 {compact ? 'Import' : 'Import List'}</button>
            <button className="btn btn-ghost btn-sm rw-truncate" style={compact ? COMPACT_ACTION : undefined}
              onClick={() => setShowDownloadMenu(true)} title="Export CSV">📥 {compact ? 'Export' : 'Download List'}</button>
          </div>
        )}

        <span style={{
          color: 'var(--text-muted)', fontSize: compact ? '0.75rem' : '0.8rem',
          ...(compact ? { width: '100%', textAlign: 'right' } : null)
        }}>{filteredDevices.length} / {rawDevices.length} {t('deviceCount')}</span>
      </div>

      {/* Toplu islem cubugu. Satir kaydirma .rw-actions'tan gelir (<=1024px);
          inline flexWrap masaustune de sizacagi icin bilerek yazilmadi. */}
      {isAdmin && selectedVisible.length > 0 && (
        <div className="rw-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 16px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>{selectedVisible.length} selected</span>
          {/* Filtre disinda kalan secimler islenmeyecek - sessizce yutmak yerine soyle */}
          {hiddenSelectedCount > 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--warning)' }}>
              {hiddenSelectedCount} more hidden by filters (not affected)
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setShowBatchEdit(true)}>Batch Edit</button>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmBatchDelete(true)}>Delete Selected</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}>Deselect All</button>
        </div>
      )}

      {/* <=600px'te thead gizlendigi icin siralama ve "hepsini sec" buraya tasindi. */}
      <div className="rw-only-sm" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <select className="modern-input" style={{ flex: 1, minWidth: 0 }}
          value={sortValue}
          onChange={e => { const [key, dir] = e.target.value.split('|'); setSortConfig({ key, dir }); }}>
          {/* Masaustunde Page/Version'a gore siralanip pencere daraltilirsa select bos
              gorunuyordu; mevcut siralamayi gecici bir secenek olarak ekle. */}
          {!SORT_OPTIONS.some(o => o.v === sortValue) && (
            <option value={sortValue}>Sort: {sortConfig.key}{sortConfig.dir === 'asc' ? ' ▲' : ' ▼'}</option>
          )}
          {SORT_OPTIONS.map(o => (
            <option key={o.v} value={o.v}>{o.label}</option>
          ))}
        </select>
        {isAdmin && (
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={toggleSelectAll}>
            {filteredDevices.length > 0 && selectedIds.size === filteredDevices.length ? 'None' : 'All'}
          </button>
        )}
      </div>

      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Yatay kaydirma kabin ICINDE kalir: 812x375 telefon yatayda ve iPad
            dikeyde tablo eskiden overflow:hidden altinda kirpiliyordu. */}
        <div className="rw-scroll-x">
        <table className="modern-table rw-cards">
          <thead>
            <tr>
              {isAdmin && <th className="rw-tap-cell" style={{ width: 40, textAlign: 'center' }}>
                <label style={isTouch ? TAP_BOX : undefined}>
                  <input type="checkbox" checked={filteredDevices.length > 0 && selectedIds.size === filteredDevices.length} onChange={toggleSelectAll} />
                </label>
              </th>}
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('status')}>Status{sortIcon('status')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Name{sortIcon('name')}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('ip')}>IP Address{sortIcon('ip')}</th>
              <th className="rw-hide-sm" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('type')}>Type{sortIcon('type')}</th>
              <th className="rw-hide-md" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('topologyPage')}>Page{sortIcon('topologyPage')}</th>
              <th className="rw-hide-sm" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('latency')}>Latency{sortIcon('latency')}</th>
              <th className="rw-hide-md" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('version')}>Version{sortIcon('version')}</th>
              <th className="rw-hide-md">Tags</th>
              {/* paddingRight inline kaldigi surece App.css'in <=768px "padding:10px 8px"
                  kurali bu hucreye islemiyordu; telefon katmaninda birak devreye girsin. */}
              {/* Actions HIC gizlenmez: cihaz detay sayfasinda Edit/Delete yok, tek erisim
                  yolu bu kolon. <=600px'te kart modunda kendi satirini alir (data-label=""),
                  601-768px'te tablo yatay kaydigi icin bugunku gibi kaydirarak erisilir. */}
              {isAdmin && <th style={{ textAlign: 'right', paddingRight: isPhone ? undefined : 32 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length > 0 ? filteredDevices.map(d => (
              <tr key={d.id}
                style={{ cursor: 'pointer', ...(isTouch ? { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } : {}) }}
                onClick={() => navigate(`/devices/${d.id}`, { state: { from: '/devices' } })}>
                {isAdmin && (
                  <td className="rw-tap-cell" data-label="Select" style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <label style={isTouch ? TAP_BOX : undefined}>
                      <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggleSelect(d.id)} />
                    </label>
                  </td>
                )}
                <td data-label="Status"><span className={`status-badge ${d.status === 'UP' ? 'status-up' : 'status-down'}`}>{d.status}</span></td>
                <td data-label="Name" style={{ fontWeight: 600 }}>{d.name}</td>
                <td data-label="IP" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{d.ip}</td>
                <td data-label="Type" className="rw-hide-sm" style={{ textTransform: 'capitalize' }}>{d.type}</td>
                <td data-label="Page" className="rw-hide-md" style={{ color: 'var(--text-muted)' }}>{pageName(d.topologyPage)}</td>
                <td data-label="Latency" className="rw-hide-sm" style={{ color: d.latency > 100 ? 'var(--danger)' : 'var(--text-muted)' }}>{d.latency > 0 ? d.latency + ' ms' : '-'}</td>
                <td data-label="Version" className="rw-hide-md" style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{d.version || '-'}</td>
                <td data-label="Tags" className="rw-hide-md">
                  {(d.tags || []).map(tag => (
                    <span key={tag} style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 12, fontSize: '0.7rem', marginRight: 4 }}>{tag}</span>
                  ))}
                </td>
                {isAdmin && (
                  <td data-label="" style={{ textAlign: 'right' }}>
                    <button className="btn btn-primary btn-sm" style={{ marginRight: 8 }} onClick={(e) => { e.stopPropagation(); onEdit(d); }}>{t('edit')}</button>
                    <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(d); }}>{t('delete')}</button>
                  </td>
                )}
              </tr>
            )) : (
              // justifyContent sadece kart modunda (display:flex) etkili, masaustunde no-op
              <tr><td colSpan={isAdmin ? 10 : 8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', justifyContent: 'center' }}>
                {searchQuery || statusFilter !== 'all' || topoFilter !== 'all' || typeFilter !== 'all' ? t('noFilterResult') : t('noDevicesYet')}
              </td></tr>
            )}
          </tbody>
        </table>
        </div>
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
          <div className="modal-content rw-sheet" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <div className="rw-sheet-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 0 : 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>Batch Edit ({selectedVisible.length} devices)</h2>
              <button className="rw-tap rw-sheet-close" onClick={() => setShowBatchEdit(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>
            <div className="rw-sheet-body">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 16 }}>Only filled fields will be updated. Leave blank to skip.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>SSH Username</label>
                <input className="modern-input" value={batchForm.sshUsername} onChange={e => setBatchForm(p => ({ ...p, sshUsername: e.target.value }))} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>SSH Password</label>
                <input className="modern-input" type="password" value={batchForm.sshPassword} onChange={e => setBatchForm(p => ({ ...p, sshPassword: e.target.value }))} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>SNMP Community</label>
                <input className="modern-input" value={batchForm.snmpCommunity} onChange={e => setBatchForm(p => ({ ...p, snmpCommunity: e.target.value }))} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>Tags (comma-separated)</label>
                <input className="modern-input" value={batchForm.tags} onChange={e => setBatchForm(p => ({ ...p, tags: e.target.value }))} placeholder="core, datacenter" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
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
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, marginTop: 2 }}>
                <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('ipSlaMonitoring')}</label>
                <select className="modern-input" value={batchForm.ipSlaEnabled} onChange={e => setBatchForm(p => ({ ...p, ipSlaEnabled: e.target.value }))}>
                  <option value="">-- No change --</option>
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </div>
              {batchForm.ipSlaEnabled !== 'off' && (
                <div className="grid-2col rw-stack">
                  <div>
                    <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('ipSlaOkLabel')}</label>
                    <input className="modern-input" value={batchForm.ipSlaOkLabel} onChange={e => setBatchForm(p => ({ ...p, ipSlaOkLabel: e.target.value }))} placeholder="MD" maxLength={12} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                  </div>
                  <div>
                    <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('ipSlaFailLabel')}</label>
                    <input className="modern-input" value={batchForm.ipSlaFailLabel} onChange={e => setBatchForm(p => ({ ...p, ipSlaFailLabel: e.target.value }))} placeholder="GSM" maxLength={12} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" />
                  </div>
                </div>
              )}
            </div>
            </div>
            <div className="rw-sheet-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: compact ? 0 : 24 }}>
              <button className="btn btn-ghost" onClick={() => setShowBatchEdit(false)}>{t('cancel')}</button>
              <button className="btn btn-primary" onClick={handleBatchSubmit}>Apply Changes</button>
            </div>
          </div>
        </div>
      )}

      {showBulkImport && <BulkImportModal onClose={() => setShowBulkImport(false)} />}
      {showFindDevice && <FindDeviceModal onClose={() => setShowFindDevice(false)} />}

      {showDownloadMenu && (
        <div className="modal-overlay" onClick={() => !detailedLoading && setShowDownloadMenu(false)}
          onKeyDown={e => { if (e.key === 'Escape' && !detailedLoading) setShowDownloadMenu(false); }}>
          <div className="modal-content rw-sheet" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <div className="rw-sheet-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 0 : 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('downloadTitle')}</h2>
              <button className="rw-tap rw-sheet-close" onClick={() => !detailedLoading && setShowDownloadMenu(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>
            <div className="rw-sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button className="btn btn-ghost" onClick={handleExportCSV} disabled={detailedLoading}
                style={{ textAlign: 'left', padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>📄 {t('downloadSummary')}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('downloadSummaryDesc')}</span>
              </button>
              <button className="btn btn-primary" onClick={handleExportDetailed} disabled={detailedLoading}
                style={{ textAlign: 'left', padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{detailedLoading ? `⏳ ${t('downloadGathering')}` : `📋 ${t('downloadDetailed')}`}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>{t('downloadDetailedDesc')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBatchDelete && (
        <ConfirmModal
          title={t('deleteDevice')}
          message={`${selectedVisible.length} ${t('deleteSelectedConfirm')}`}
          onCancel={() => setConfirmBatchDelete(false)}
          onConfirm={async () => {
            setConfirmBatchDelete(false);
            let deleted = 0;
            // Yalnizca gorunur olanlar: filtre disinda kalan secimler silinmez
            for (const id of selectedVisible.map(d => d.id)) {
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
