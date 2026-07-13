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
import { t, getLang, setLang, onLangChange } from './i18n';
import { API_BASE } from './config';
// topology tabs now come from AppContext

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function AppLayout() {
  const { isAuthenticated, isAdmin, mustChangePassword, clearMustChangePassword, authFetch, csrfToken } = useAuth();
  const { fetchData, topoTabs } = useApp();
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

  return (
    <div className="app-container">
      <Navbar onAddDevice={isAdmin ? handleAddDevice : undefined} />
      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>…</div>}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/devices" element={<DeviceListPage onEdit={isAdmin ? handleEditDevice : undefined} />} />
            <Route path="/devices/:id" element={<DeviceDetailPage />} />
            <Route path="/topology" element={<TopologyPage onEdit={isAdmin ? handleEditDevice : undefined} />} />
            <Route path="/topology/:tabId" element={<TopologyPage onEdit={isAdmin ? handleEditDevice : undefined} />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/geomap" element={<GeoMapPage />} />
            <Route path="/mac-search" element={<MacSearchPage />} />
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
