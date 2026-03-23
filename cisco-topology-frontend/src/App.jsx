import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './App.css';
import { useAuth } from './context/AuthContext';
import { useApp } from './context/AppContext';
import Navbar from './components/Navbar';
import TerminalPanel from './components/TerminalPanel';
import ToastContainer from './Toast';
import SwitchFormModal from './SwitchFormModal';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DeviceListPage from './pages/DeviceListPage';
import DeviceDetailPage from './pages/DeviceDetailPage';
import TopologyPage from './pages/TopologyPage';
import UsersPage from './pages/UsersPage';
import AuditPage from './pages/AuditPage';
import GeoMapPage from './pages/GeoMapPage';
import { showToast } from './Toast';
import { t, getLang, setLang, onLangChange } from './i18n';
import { API_BASE } from './config';

function ProtectedRoute({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function AppLayout() {
  const { token } = useAuth();
  const { fetchData } = useApp();
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
      <Navbar onAddDevice={handleAddDevice} />
      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/devices" element={<DeviceListPage onEdit={handleEditDevice} />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/topology" element={<TopologyPage onEdit={handleEditDevice} />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/geomap" element={<GeoMapPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        <TerminalPanel />
      </main>

      {isModalOpen && (
        <SwitchFormModal
          mode={modalMode}
          initialValues={editingNode}
          onCancel={() => setIsModalOpen(false)}
          onSave={async (f) => {
            const res = await fetch(`${API_BASE}/switches${modalMode === 'edit' ? '/' + editingNode.id : ''}`, {
              method: modalMode === 'edit' ? 'PUT' : 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
