import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './App.css';
import { useAuth } from './context/AuthContext';
import { useApp } from './context/AppContext';
import Navbar from './components/Navbar';
import ToastContainer from './Toast';
import SwitchFormModal from './SwitchFormModal';
import LoginPage from './pages/LoginPage';
import ForcePasswordChange from './components/ForcePasswordChange';
import { showToast } from './Toast';

// Kimlik-korumalı sayfalar ve terminal talebe göre yüklenir (başlangıç paketini küçültür:
// recharts/d3 Dashboard'da, reactflow Topology'de, xterm terminalde — hepsi ilk yükte değil)
const TerminalPanel = lazy(() => import('./components/TerminalPanel'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DeviceListPage = lazy(() => import('./pages/DeviceListPage'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage'));
const TopologyPage = lazy(() => import('./pages/TopologyPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const GeoMapPage = lazy(() => import('./pages/GeoMapPage'));
const MacSearchPage = lazy(() => import('./pages/MacSearchPage'));
const CommandLinePage = lazy(() => import('./pages/CommandLinePage'));
import { t, getLang, setLang, onLangChange } from './i18n';
import { API_BASE } from './config';
// topology tabs now come from AppContext

// Klon için benzersiz adres üret: IPv4 ise son okteti ilk boşa kadar artır,
// değilse (hostname) sonek ekle. taken = mevcut tüm cihaz IP'leri.
function freeAddress(ip, taken) {
  const m = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(ip || '');
  if (m) {
    const prefix = m[1];
    let last = parseInt(m[2], 10);
    for (let i = 0; i < 254; i++) {
      last = last >= 254 ? 1 : last + 1;
      const cand = `${prefix}.${last}`;
      if (!taken.has(cand)) return cand;
    }
    return ip; // hepsi dolu → aynısını dön (backend reddederse toast bilgilendirir)
  }
  const base = ip || 'device';
  let cand = `${base}-copy`, n = 2;
  while (taken.has(cand)) cand = `${base}-copy${n++}`;
  return cand;
}

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function AppLayout() {
  const { isAuthenticated, isAdmin, mustChangePassword, clearMustChangePassword, authFetch, csrfToken } = useAuth();
  const { fetchData, topoTabs, rawDevices } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [editingNode, setEditingNode] = useState(null);
  const [lang, setLangState] = useState(getLang());

  useEffect(() => {
    const unsub = onLangChange((newLang) => setLangState(newLang));
    return unsub;
  }, []);

  const handleAddDevice = () => {
    setEditingNode(null);
    setModalMode('add');
    setIsModalOpen(true);
  };

  const handleEditDevice = (device) => {
    setEditingNode(device);
    setModalMode('edit');
    setIsModalOpen(true);
  };

  // Klonla: modal açmadan doğrudan yeni cihaz oluştur — benzersiz IP + kaynağın sağı
  const handleCloneDevice = async (device) => {
    if (!device) return;
    const taken = new Set((rawDevices || []).map(d => d.ip));
    const pos = device.position || { x: 0, y: 0 };
    const payload = {
      name: `${device.name || device.label || 'Device'} - Copy`,
      ip: freeAddress(device.ip, taken),
      model: device.model,
      type: device.type,
      sshUsername: device.sshUsername,
      snmpCommunity: device.snmpCommunity,
      snmpPort: device.snmpPort,
      snmpVersion: device.snmpVersion,
      healthIntervalSec: device.healthIntervalSec,
      tags: device.tags || [],
      topologyPage: device.topologyPage || 'main',
      position: { x: (pos.x || 0) + 100, y: pos.y || 0 } // hemen sağ tarafı
    };
    const res = await authFetch('/switches', { method: 'POST', body: JSON.stringify(payload) });
    if (res && res.ok) showToast(t('deviceAdded'), 'success');
    else { const d = await res?.json().catch(() => ({})); showToast(d?.error || t('operationFailed'), 'error'); }
    fetchData();
  };

  return (
    <div className="app-container">
      <Navbar onAddDevice={isAdmin ? handleAddDevice : undefined} />
      {/* .app-main: tek icerik bolgesi. Sinif tamamen ek — hicbir masaustu kurali
          buna bakmiyor; mobil katmanin overflow/dvh davranisini inline stile
          dokunmadan hedefleyebilmesi icin var. */}
      <main className="app-main" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>…</div>}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/devices" element={<DeviceListPage onEdit={isAdmin ? handleEditDevice : undefined} />} />
            <Route path="/devices/:id" element={<DeviceDetailPage />} />
            <Route path="/topology" element={<TopologyPage onEdit={isAdmin ? handleEditDevice : undefined} onClone={isAdmin ? handleCloneDevice : undefined} />} />
            <Route path="/topology/:tabId" element={<TopologyPage onEdit={isAdmin ? handleEditDevice : undefined} onClone={isAdmin ? handleCloneDevice : undefined} />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/geomap" element={<GeoMapPage />} />
            <Route path="/mac-search" element={<MacSearchPage />} />
            <Route path="/command-line" element={<CommandLinePage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          <TerminalPanel />
        </Suspense>
      </main>

      {mustChangePassword && <ForcePasswordChange onComplete={clearMustChangePassword} />}

      {isAdmin && isModalOpen && (
        <SwitchFormModal
          mode={modalMode}
          initialValues={editingNode}
          topologyTabs={topoTabs}
          onCancel={() => setIsModalOpen(false)}
          onSave={async (f) => {
            const res = await authFetch(`/switches${modalMode === 'edit' ? '/' + editingNode.id : ''}`, {
              method: modalMode === 'edit' ? 'PUT' : 'POST',
              body: JSON.stringify(f)
            });
            if (res.ok) showToast(modalMode === 'edit' ? t('deviceUpdated') : t('deviceAdded'), 'success');
            else { const d = await res.json().catch(() => ({})); showToast(d.error || t('operationFailed'), 'error'); }
            setIsModalOpen(false);
            fetchData();
          }}
        />
      )}
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<><ToastContainer /><LoginPage /></>} />
      <Route path="/*" element={
        <ProtectedRoute>
          <AppLayout />
        </ProtectedRoute>
      } />
    </Routes>
  );
}
