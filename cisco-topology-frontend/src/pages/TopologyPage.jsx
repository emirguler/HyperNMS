import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactFlow, {
  Background, Controls, MiniMap, applyNodeChanges,
  addEdge, applyEdgeChanges, useReactFlow, ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import SwitchNode from '../components/SwitchNode';
import TopologyToolbar from '../components/TopologyToolbar';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { getLayoutedElements } from '../utils/layoutEngine';
import { API_BASE } from '../config';
import { t } from '../i18n';
import { showToast } from '../Toast';

const nodeTypes = { switchNode: SwitchNode };

function TopologyInner({ onEdit }) {
  const { rawDevices, edges, setEdges, sshSessions, openSshSession, fetchData } = useApp();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reactFlowWrapper = useRef(null);
  const { fitView, setCenter } = useReactFlow();

  // State
  const [menu, setMenu] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [layoutDirection, setLayoutDirection] = useState('TB');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('');
  const [activeLayer, setActiveLayer] = useState('status');
  const [localNodes, setLocalNodes] = useState([]);

  // Undo/Redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Tüm etiketler
  const allTags = useMemo(() => {
    const tags = new Set();
    rawDevices.forEach(d => (d.tags || []).forEach(tag => tags.add(tag)));
    return [...tags];
  }, [rawDevices]);

  // Filtrelenmiş cihazlar
  const filteredDevices = useMemo(() => {
    let list = rawDevices;
    if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter);
    if (tagFilter) list = list.filter(d => (d.tags || []).includes(tagFilter));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d => d.name?.toLowerCase().includes(q) || d.ip?.toLowerCase().includes(q));
    }
    return list;
  }, [rawDevices, statusFilter, tagFilter, searchQuery]);

  // Node'ları sync et
  useEffect(() => {
    const filteredIds = new Set(filteredDevices.map(s => s.id));
    setLocalNodes(prev => {
      let updated = [];
      filteredDevices.forEach(s => {
        const existing = prev.find(n => n.id === s.id);
        const nodeData = {
          label: s.name, ip: s.ip, status: s.status,
          type: s.type || 'switch', latency: s.latency,
          tags: s.tags || [], cpu: s.cpu, ram: s.ram,
          uptime: s.uptime, vendor: s.detectedVendor
        };
        if (existing) {
          updated.push({ ...existing, data: nodeData });
        } else {
          updated.push({
            id: s.id, type: 'switchNode',
            position: s.position || { x: Math.random() * 600, y: Math.random() * 400 },
            data: nodeData
          });
        }
      });
      return updated;
    });
  }, [filteredDevices]);

  // Arama ile zoom
  useEffect(() => {
    if (searchQuery && filteredDevices.length === 1) {
      const d = filteredDevices[0];
      const pos = d.position || { x: 0, y: 0 };
      setTimeout(() => setCenter(pos.x + 85, pos.y + 65, { zoom: 1.5, duration: 600 }), 100);
    }
  }, [searchQuery, filteredDevices, setCenter]);

  // URL'den zoom-to-device
  useEffect(() => {
    const zoomTo = searchParams.get('zoom');
    if (zoomTo) {
      const device = rawDevices.find(d => d.id === zoomTo);
      if (device?.position) {
        setTimeout(() => setCenter(device.position.x + 85, device.position.y + 65, { zoom: 1.5, duration: 800 }), 300);
      }
    }
  }, [searchParams, rawDevices, setCenter]);

  // Edge styling katmana göre
  const styledEdges = useMemo(() => {
    return edges.map(e => {
      const src = rawDevices.find(s => s.id === e.source);
      const tgt = rawDevices.find(s => s.id === e.target);
      const active = src?.status === 'UP' && tgt?.status === 'UP';

      let stroke = active ? 'var(--success)' : 'var(--text-muted)';
      let strokeWidth = active ? 3 : 2;
      let label = e.label || '';

      if (activeLayer === 'traffic' && e.trafficMbps) {
        const mbps = e.trafficMbps;
        stroke = mbps > 800 ? '#ef4444' : mbps > 400 ? '#f59e0b' : '#34d399';
        strokeWidth = Math.max(2, Math.min(8, mbps / 150));
        label = mbps >= 1000 ? `${(mbps / 1000).toFixed(1)}G` : `${mbps.toFixed(0)}M`;
      }

      if (activeLayer === 'latency') {
        const avgLat = ((src?.latency || 0) + (tgt?.latency || 0)) / 2;
        stroke = avgLat > 80 ? '#ef4444' : avgLat > 30 ? '#f59e0b' : '#34d399';
      }

      // Edge tipi
      const edgeType = e.edgeType || 'smoothstep';

      return {
        ...e, type: edgeType, animated: false,
        className: active ? 'bi-flow-edge' : '',
        label: label || undefined,
        labelStyle: { fill: 'var(--text-muted)', fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: 'var(--bg-panel)', fillOpacity: 0.8 },
        labelBgPadding: [4, 6],
        labelBgBorderRadius: 4,
        style: { stroke, strokeWidth, opacity: active ? 1 : 0.4 }
      };
    });
  }, [edges, rawDevices, activeLayer]);

  // Auto layout
  const handleAutoLayout = useCallback(() => {
    const { nodes: layouted } = getLayoutedElements(localNodes, edges, layoutDirection);
    setLocalNodes(layouted);
    // Pozisyonları backend'e kaydet
    layouted.forEach(node => {
      fetch(`${API_BASE}/switches/${node.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ position: node.position })
      }).catch(() => {});
    });
    setTimeout(() => fitView({ duration: 500 }), 50);
    showToast('Layout applied', 'success');
  }, [localNodes, edges, layoutDirection, token, fitView]);

  // Export PNG
  const handleExportPng = useCallback(() => {
    if (!reactFlowWrapper.current) return;
    const el = reactFlowWrapper.current.querySelector('.react-flow__viewport');
    if (!el) return;
    toPng(el, { backgroundColor: '#0f172a', quality: 1, pixelRatio: 2 })
      .then(dataUrl => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `topology-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        showToast('Topology exported as PNG', 'success');
      })
      .catch(() => showToast('Export failed', 'error'));
  }, []);

  // Node drag
  const onNodeDragStop = useCallback((_, node) => {
    fetch(`${API_BASE}/switches/${node.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ position: node.position })
    }).catch(() => {});
  }, [token]);

  // Connect
  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({ ...params, type: 'smoothstep', animated: true, style: { stroke: 'var(--text-muted)', strokeWidth: 2 } }, eds));
    const newEdge = { ...params, id: `e-${params.source}-${params.target}-${Date.now()}`, animated: true, style: { stroke: 'var(--text-muted)', strokeWidth: 2 } };
    fetch(`${API_BASE}/edges`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(newEdge) });
  }, [token, setEdges]);

  // Delete edges
  const onEdgesDelete = useCallback((edgesToDelete) => {
    edgesToDelete.forEach(edge => {
      fetch(`${API_BASE}/edges/${edge.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    });
    setEdges(eds => eds.filter(e => !edgesToDelete.some(del => del.id === e.id)));
  }, [token, setEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        // Undo placeholder
      }
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        // Redo placeholder
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // MiniMap renk
  const minimapNodeColor = (node) => {
    if (node.data?.status === 'DOWN') return '#ef4444';
    if (node.data?.status === 'UP') return '#34d399';
    return '#64748b';
  };

  return (
    <div style={{ width: '100%', height: sshSessions.length > 0 ? '60%' : '100%', position: 'relative' }}
      onClick={() => { setMenu(null); setEdgeMenu(null); }}
      ref={reactFlowWrapper}>

      <TopologyToolbar
        onAutoLayout={handleAutoLayout}
        onExportPng={handleExportPng}
        onFitView={() => fitView({ duration: 400 })}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        snapEnabled={snapEnabled}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        tagFilter={tagFilter}
        onTagFilter={setTagFilter}
        allTags={allTags}
        layoutDirection={layoutDirection}
        onLayoutDirection={setLayoutDirection}
        activeLayer={activeLayer}
        onLayerChange={setActiveLayer}
      />

      <ReactFlow
        nodes={localNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onNodesChange={n => setLocalNodes(applyNodeChanges(n, localNodes))}
        onEdgesChange={e => setEdges(applyEdgeChanges(e, edges))}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onEdgeContextMenu={(e, edge) => { e.preventDefault(); setEdgeMenu({ id: edge.id, top: e.clientY, left: e.clientX }); setMenu(null); }}
        onNodeContextMenu={(e, n) => { e.preventDefault(); setMenu({ id: n.id, label: n.data.label, top: e.clientY, left: e.clientX, data: n.data }); setEdgeMenu(null); }}
        onNodeDragStop={onNodeDragStop}
        snapToGrid={snapEnabled}
        snapGrid={[20, 20]}
        selectionOnDrag
        multiSelectionKeyCode="Shift"
        fitView
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="var(--primary)" gap={snapEnabled ? 20 : 25} size={snapEnabled ? 2 : 1} style={{ opacity: 0.1 }} variant={snapEnabled ? 'lines' : 'dots'} />
        <Controls style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8 }} />
        <MiniMap
          nodeColor={minimapNodeColor}
          nodeStrokeWidth={2}
          style={{
            background: 'var(--bg-dark)', border: '1px solid var(--border-color)',
            borderRadius: 8, height: 120, width: 180
          }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>

      {/* Node context menu */}
      {menu && (
        <div className="context-menu" style={{ top: menu.top, left: menu.left }}>
          <div className="context-menu-item" onClick={() => { navigate(`/devices/${menu.id}`); setMenu(null); }}>📊 Details</div>
          <div className="context-menu-item" onClick={() => { onEdit(rawDevices.find(d => d.id === menu.id)); setMenu(null); }}>✏️ Edit</div>
          <div className="context-menu-item" onClick={() => { openSshSession(menu.id, menu.label); setMenu(null); }}>💻 Terminal</div>
          <div className="context-menu-item" onClick={() => {
            const pos = localNodes.find(n => n.id === menu.id)?.position;
            if (pos) setCenter(pos.x + 85, pos.y + 65, { zoom: 2, duration: 500 });
            setMenu(null);
          }}>🔍 Zoom Here</div>
        </div>
      )}

      {/* Edge context menu */}
      {edgeMenu && (
        <div className="context-menu" style={{ top: edgeMenu.top, left: edgeMenu.left }}>
          <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={() => {
            fetch(`${API_BASE}/edges/${edgeMenu.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
            setEdges(eds => eds.filter(e => e.id !== edgeMenu.id));
            setEdgeMenu(null);
          }}>🗑️ {t('deleteConnection')}</div>
        </div>
      )}
    </div>
  );
}

export default function TopologyPage(props) {
  return (
    <ReactFlowProvider>
      <TopologyInner {...props} />
    </ReactFlowProvider>
  );
}
