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
  const { rawDevices, edges, setEdges, sshSessions, openSshSession } = useApp();
  const { token, isAdmin } = useAuth();
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

  // Node'ları sync — main tab tüm cihazları gösterir, diğer tab'lar kendi cihazlarını
  useEffect(() => {
    setLocalNodes(prev => {
      const devices = activeTabId === 'main'
        ? rawDevices
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
    fetch(`${API_BASE}/switches/${node.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ position: node.position })
    }).catch(() => {});
  }, [token]);

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
    fetch(`${API_BASE}/edges`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(newEdge) });
  }, [token, setEdges]);

  const onEdgesDelete = useCallback((edgesToDelete) => {
    edgesToDelete.forEach(edge => {
      fetch(`${API_BASE}/edges/${edge.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    });
    setEdges(eds => eds.filter(e => !edgesToDelete.some(del => del.id === e.id)));
  }, [token, setEdges]);

  const minimapNodeColor = (node) => {
    if (node.data?.status === 'DOWN') return '#ef4444';
    if (node.data?.status === 'UP') return '#34d399';
    return '#64748b';
  };

  const handleAddTab = () => {
    const name = `Sub Page ${tabs.length}`;
    const id = addTab(name);
    navigate(`/topology/${id}`);
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

  const handleFinishRename = () => {
    if (renamingTab && renameValue.trim()) {
      renameTab(renamingTab, renameValue.trim());
    }
    setRenamingTab(null);
  };

  return (
    <div style={{ width: '100%', height: sshSessions.length > 0 ? '60%' : '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}
      onClick={() => { setMenu(null); setEdgeMenu(null); setTabMenu(null); }}>

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
        <div className="context-menu" style={{ top: tabMenu.top, left: tabMenu.left, zIndex: 9999 }}>
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
      <div style={{ flex: 1, position: 'relative' }} ref={reactFlowWrapper}>
        <ReactFlow
          nodes={localNodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          onNodesChange={n => setLocalNodes(applyNodeChanges(n, localNodes))}
          onEdgesChange={isAdmin ? (e => setEdges(applyEdgeChanges(e, edges))) : undefined}
          onConnect={isAdmin ? onConnect : undefined}
          onEdgesDelete={isAdmin ? onEdgesDelete : undefined}
          onEdgeContextMenu={isAdmin ? ((e, edge) => { e.preventDefault(); setEdgeMenu({ id: edge.id, top: e.clientY, left: e.clientX }); setMenu(null); }) : undefined}
          onNodeContextMenu={isAdmin ? ((e, n) => { e.preventDefault(); setMenu({ id: n.id, label: n.data.label, top: e.clientY, left: e.clientX, data: n.data }); setEdgeMenu(null); }) : undefined}
          onNodeDragStop={isAdmin ? onNodeDragStop : undefined}
          nodesDraggable={isAdmin}
          nodesConnectable={isAdmin}
          elementsSelectable={isAdmin}
          connectionMode="loose"
          selectionOnDrag={isAdmin}
          multiSelectionKeyCode="Shift"
          fitView
        >
          <Background color="var(--primary)" gap={25} size={1} style={{ opacity: 0.1 }} />
          <Controls style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8 }} />
          <MiniMap
            nodeColor={minimapNodeColor}
            nodeStrokeWidth={2}
            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 8, height: 100, width: 150 }}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>

        {isAdmin && menu && (
          <div className="context-menu" style={{ top: menu.top, left: menu.left }}>
            <div className="context-menu-item" onClick={() => { navigate(`/devices/${menu.id}`); setMenu(null); }}>📊 Details</div>
            <div className="context-menu-item" onClick={() => { onEdit(rawDevices.find(d => d.id === menu.id)); setMenu(null); }}>✏️ Edit</div>
            <div className="context-menu-item" onClick={() => { openSshSession(menu.id, menu.label); setMenu(null); }}>💻 Terminal</div>
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
              fetch(`${API_BASE}/edges/${edgeMenu.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
              setEdges(eds => eds.filter(e => e.id !== edgeMenu.id));
              setEdgeMenu(null);
            }}>🗑️ {t('deleteConnection')}</div>
          </div>
        )}
      </div>
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
