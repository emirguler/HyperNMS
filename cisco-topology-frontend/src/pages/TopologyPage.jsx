import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import ReactFlow, {
  Background, Controls, MiniMap, applyNodeChanges,
  addEdge, applyEdgeChanges, useReactFlow, ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import SwitchNode from '../components/SwitchNode';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import { t } from '../i18n';
import { showToast } from '../Toast';
import { useTopologyTabs } from '../hooks/useTopologyTabs';

const nodeTypes = { switchNode: SwitchNode };

function TopologyInner({ onEdit }) {
  const { rawDevices, edges, setEdges, fetchData, sshSessions, openSshSession } = useApp();
  const { isAdmin, authFetch, csrfToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tabId } = useParams();
  const reactFlowWrapper = useRef(null);
  const { fitView, setCenter } = useReactFlow();
  const { tabs, addTab, removeTab, renameTab } = useTopologyTabs();

  const activeTabId = tabId || 'main';
  const [menu, setMenu] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null);
  const [tabMenu, setTabMenu] = useState(null);
  const [localNodes, setLocalNodes] = useState([]);
  const [renamingTab, setRenamingTab] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const prevTabId = useRef(activeTabId);

  // FitView on tab change
  useEffect(() => {
    if (prevTabId.current !== activeTabId) {
      prevTabId.current = activeTabId;
      setTimeout(() => fitView({ duration: 200 }), 50);
    }
  }, [activeTabId, fitView]);

  // Close all context menus on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest('.context-menu')) {
        setMenu(null);
        setEdgeMenu(null);
        setTabMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Node'ları sync — main tab tüm cihazları gösterir, diğer tab'lar kendi cihazlarını
  useEffect(() => {
    setLocalNodes(prev => {
      const devices = activeTabId === 'main'
        ? rawDevices.filter(s => !s.topologyPage || s.topologyPage === 'main')
        : rawDevices.filter(s => s.topologyPage === activeTabId);
      let updated = [];
      devices.forEach(s => {
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
  }, [rawDevices, activeTabId]);

  // URL'den zoom-to-device
  useEffect(() => {
    const zoomTo = searchParams.get('zoom');
    if (zoomTo) {
      const device = rawDevices.find(d => d.id === zoomTo);
      if (device?.position) {
        setTimeout(() => setCenter(device.position.x + 65, device.position.y + 40, { zoom: 1.5, duration: 800 }), 300);
      }
    }
  }, [searchParams, rawDevices, setCenter]);

  const styledEdges = useMemo(() => {
    return edges.map(e => {
      const src = rawDevices.find(s => s.id === e.source);
      const tgt = rawDevices.find(s => s.id === e.target);
      const active = src?.status === 'UP' && tgt?.status === 'UP';
      return {
        ...e, animated: false, className: active ? 'bi-flow-edge' : '',
        style: { stroke: active ? 'var(--success)' : 'var(--text-muted)', strokeWidth: active ? 3 : 2, opacity: active ? 1 : 0.4 }
      };
    });
  }, [edges, rawDevices]);

  const onNodeDragStop = useCallback((_, node) => {
    authFetch(`/switches/${node.id}`, {
      method: 'PUT',
      body: JSON.stringify({ position: node.position })
    }).catch(() => {});
  }, [authFetch]);

  const onConnect = useCallback((params) => {
    const newEdge = {
      ...params,
      id: `e-${params.source}-${params.target}-${Date.now()}`,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      animated: true,
      style: { stroke: 'var(--text-muted)', strokeWidth: 2 }
    };
    setEdges(eds => addEdge(newEdge, eds));
    authFetch('/edges', { method: 'POST', body: JSON.stringify(newEdge) });
  }, [authFetch, setEdges]);

  const onEdgesDelete = useCallback((edgesToDelete) => {
    edgesToDelete.forEach(edge => {
      authFetch(`/edges/${edge.id}`, { method: 'DELETE' });
    });
    setEdges(eds => eds.filter(e => !edgesToDelete.some(del => del.id === e.id)));
  }, [authFetch, setEdges]);

  const minimapNodeColor = (node) => {
    if (node.data?.status === 'DOWN') return '#ef4444';
    if (node.data?.status === 'UP') return '#34d399';
    return '#64748b';
  };

  const handleAddTab = async () => {
    const name = `Sub Page ${tabs.length}`;
    const id = await addTab(name);
    if (id) navigate(`/topology/${id}`);
  };

  const handleTabContextMenu = (tab, e) => {
    e.preventDefault();
    e.stopPropagation();
    setTabMenu({ id: tab.id, name: tab.name, top: e.clientY, left: e.clientX });
  };

  const handleStartRename = (tabId, name) => {
    setRenamingTab(tabId);
    setRenameValue(name);
    setTabMenu(null);
  };

  const handleFinishRename = useCallback(() => {
    setRenamingTab(prev => {
      if (prev && renameValue.trim()) {
        renameTab(prev, renameValue.trim());
      }
      return null;
    });
  }, [renameValue, renameTab]);

  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [showDiscoverDialog, setShowDiscoverDialog] = useState(false);
  const [selectedRootId, setSelectedRootId] = useState('auto');

  const handleAutoDiscover = async () => {
    const deviceIds = localNodes.map(n => n.id);
    if (deviceIds.length === 0) {
      showToast('No devices on this page', 'error');
      return;
    }
    setShowDiscoverDialog(false);
    setDiscovering(true);
    setDiscoveryResult(null);
    try {
      const body = { deviceIds };
      if (selectedRootId !== 'auto') body.rootDeviceId = selectedRootId;

      const res = await authFetch('/topology/auto-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res && res.ok) {
        const data = await res.json();
        if (data.positions) {
          setLocalNodes(prev => prev.map(n => {
            if (data.positions[n.id]) {
              return { ...n, position: data.positions[n.id] };
            }
            return n;
          }));
        }
        await fetchData();
        setTimeout(() => fitView({ duration: 500 }), 200);
        setDiscoveryResult(data);
        showToast(`Discovered ${data.totalNeighbors} neighbors, created ${data.newEdges} connections`, 'success');
      } else {
        showToast('Discovery failed', 'error');
      }
    } catch (e) {
      showToast('Discovery error: ' + e.message, 'error');
    }
    setDiscovering(false);
  };

  return (
    <div style={{ width: '100%', height: sshSessions.length > 0 ? '60%' : '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      {/* Tab Bar */}
      <div className="topology-tabs">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`topology-tab ${activeTabId === tab.id ? 'active' : ''}`}
            onClick={() => navigate(tab.id === 'main' ? '/topology' : `/topology/${tab.id}`)}
            onContextMenu={isAdmin ? ((e) => handleTabContextMenu(tab, e)) : undefined}
          >
            {renamingTab === tab.id ? (
              <input
                className="topology-tab-rename"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={e => { if (e.key === 'Enter') handleFinishRename(); if (e.key === 'Escape') setRenamingTab(null); }}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span>{tab.name}</span>
            )}
            {isAdmin && tab.id !== 'main' && (
              <span className="topology-tab-close" onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
                if (activeTabId === tab.id) navigate('/topology');
              }}>&times;</span>
            )}
          </div>
        ))}
        {isAdmin && <button className="topology-tab-add" onClick={handleAddTab} title="Add sub page">+</button>}
      </div>

      {/* Tab sağ tık menüsü */}
      {isAdmin && tabMenu && (
        <div className="context-menu" style={{ top: tabMenu.top, left: tabMenu.left, zIndex: 9999 }}
          onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
          <div className="context-menu-item" onClick={() => handleStartRename(tabMenu.id, tabMenu.name)}>✏️ Rename</div>
          {tabMenu.id !== 'main' && (
            <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={() => {
              removeTab(tabMenu.id);
              if (activeTabId === tabMenu.id) navigate('/topology');
              setTabMenu(null);
            }}>🗑️ Delete</div>
          )}
        </div>
      )}

      {/* React Flow Canvas */}
      <div className={`topology-canvas ${zoomLevel < 0.45 ? 'zoom-minimal' : zoomLevel < 0.7 ? 'zoom-compact' : ''}`} style={{ flex: 1, position: 'relative' }} ref={reactFlowWrapper}>
        <ReactFlow
          nodes={localNodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          onNodesChange={n => setLocalNodes(applyNodeChanges(n, localNodes))}
          onEdgesChange={isAdmin ? (e => setEdges(applyEdgeChanges(e, edges))) : undefined}
          onConnect={isAdmin ? onConnect : undefined}
          onEdgesDelete={isAdmin ? onEdgesDelete : undefined}
          onEdgeContextMenu={isAdmin ? ((e, edge) => { e.preventDefault(); setEdgeMenu({ id: edge.id, top: e.clientY, left: e.clientX }); setMenu(null); }) : undefined}
          onNodeContextMenu={(e, n) => { e.preventDefault(); setMenu({ id: n.id, label: n.data.label, top: e.clientY, left: e.clientX, data: n.data }); setEdgeMenu(null); }}
          onNodeDragStop={isAdmin ? onNodeDragStop : undefined}
          onMoveEnd={(_, viewport) => setZoomLevel(viewport.zoom)}
          nodesDraggable={isAdmin}
          nodesConnectable={isAdmin}
          elementsSelectable
          connectionMode="loose"
          selectionOnDrag={isAdmin}
          multiSelectionKeyCode="Shift"
          fitView
        >
          <Background color="var(--primary)" gap={25} size={1} style={{ opacity: 0.1 }} />
          <Controls style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8 }} />

          {/* Auto Topology Button */}
          {isAdmin && (
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5, display: 'flex', gap: 6 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setSelectedRootId('auto'); setShowDiscoverDialog(true); }}
                disabled={discovering}
                style={{ fontSize: '0.75rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                {discovering ? '⏳ Discovering...' : '🔍 Auto Topology'}
              </button>
            </div>
          )}

          <MiniMap
            nodeColor={minimapNodeColor}
            nodeStrokeWidth={2}
            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 8, height: 100, width: 150 }}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>

        {menu && (
          <div className="context-menu" style={{ top: menu.top, left: menu.left }}>
            <div className="context-menu-item" onClick={() => { navigate(`/devices/${menu.id}`); setMenu(null); }}>📊 Details</div>
            {isAdmin && <div className="context-menu-item" onClick={() => { onEdit(rawDevices.find(d => d.id === menu.id)); setMenu(null); }}>✏️ Edit</div>}
            {isAdmin && <div className="context-menu-item" onClick={() => { openSshSession(menu.id, menu.label); setMenu(null); }}>💻 SSH Terminal</div>}
            <div className="context-menu-item" onClick={() => {
              const pos = localNodes.find(n => n.id === menu.id)?.position;
              if (pos) setCenter(pos.x + 65, pos.y + 40, { zoom: 2, duration: 500 });
              setMenu(null);
            }}>🔍 Zoom Here</div>
          </div>
        )}

        {isAdmin && edgeMenu && (
          <div className="context-menu" style={{ top: edgeMenu.top, left: edgeMenu.left }}>
            <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={() => {
              authFetch(`/edges/${edgeMenu.id}`, { method: 'DELETE' });
              setEdges(eds => eds.filter(e => e.id !== edgeMenu.id));
              setEdgeMenu(null);
            }}>🗑️ {t('deleteConnection')}</div>
          </div>
        )}
      </div>

      {/* Auto Topology Dialog */}
      {showDiscoverDialog && (
        <div className="modal-overlay" onClick={() => setShowDiscoverDialog(false)}>
          <div className="confirm-modal-content" onClick={e => e.stopPropagation()} style={{ minWidth: 340 }}>
            <h3 className="confirm-title">🔍 Auto Topology</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 16 }}>
              Discovers connections via CDP/LLDP and arranges devices in a tree layout.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Root Device (top of tree)
              </label>
              <select
                className="modern-input"
                value={selectedRootId}
                onChange={e => setSelectedRootId(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="auto">Auto-detect (most referenced device)</option>
                {localNodes
                  .slice()
                  .sort((a, b) => (a.data.label || '').localeCompare(b.data.label || ''))
                  .map(n => (
                    <option key={n.id} value={n.id}>
                      {n.data.label} ({n.data.ip})
                    </option>
                  ))}
              </select>
            </div>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setShowDiscoverDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAutoDiscover}>
                Start Discovery
              </button>
            </div>
          </div>
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
