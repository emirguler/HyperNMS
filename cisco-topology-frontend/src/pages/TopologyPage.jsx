import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactFlow, { Background, Controls, applyNodeChanges, addEdge, applyEdgeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import SwitchNode from '../components/SwitchNode';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import { t } from '../i18n';

const nodeTypes = { switchNode: SwitchNode };

export default function TopologyPage({ onEdit }) {
  const { rawDevices, edges, setEdges, sshSessions, openSshSession, fetchData } = useApp();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null);

  const nodes = useMemo(() => {
    return rawDevices.map(s => ({
      id: s.id,
      type: 'switchNode',
      position: s.position || { x: 0, y: 0 },
      data: { label: s.name, ip: s.ip, status: s.status, type: s.type || 'switch' }
    }));
  }, [rawDevices]);

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

  const [localNodes, setLocalNodes] = useState(nodes);
  // Sync nodes from rawDevices
  useMemo(() => {
    setLocalNodes(prev => {
      const serverIds = new Set(rawDevices.map(s => s.id));
      let updated = prev.filter(n => serverIds.has(n.id));
      rawDevices.forEach(s => {
        const idx = updated.findIndex(n => n.id === s.id);
        if (idx > -1) {
          updated[idx] = { ...updated[idx], data: { label: s.name, ip: s.ip, status: s.status, type: s.type || 'switch' } };
        } else {
          updated.push({ id: s.id, type: 'switchNode', position: s.position || { x: 0, y: 0 }, data: { label: s.name, ip: s.ip, status: s.status, type: s.type || 'switch' } });
        }
      });
      return updated;
    });
  }, [rawDevices]);

  const onNodeDragStop = useCallback((_, node) => {
    fetch(`${API_BASE}/switches/${node.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ position: node.position })
    }).catch(() => {});
  }, [token]);

  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({ ...params, animated: true, style: { stroke: 'var(--text-muted)', strokeWidth: 2 } }, eds));
    const newEdge = { ...params, id: `e-${params.source}-${params.target}-${Date.now()}`, animated: true, style: { stroke: 'var(--text-muted)', strokeWidth: 2 } };
    fetch(`${API_BASE}/edges`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(newEdge) });
  }, [token, setEdges]);

  const onEdgesDelete = useCallback((edgesToDelete) => {
    edgesToDelete.forEach(edge => {
      fetch(`${API_BASE}/edges/${edge.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    });
    setEdges(eds => eds.filter(e => !edgesToDelete.some(del => del.id === e.id)));
  }, [token, setEdges]);

  return (
    <div style={{ width: '100%', height: sshSessions.length > 0 ? '60%' : '100%' }} onClick={() => { setMenu(null); setEdgeMenu(null); }}>
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
        fitView
      >
        <Background color="var(--primary)" gap={25} size={1} style={{ opacity: 0.1 }} />
        <Controls style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8 }} />
      </ReactFlow>

      {menu && (
        <div className="context-menu" style={{ top: menu.top, left: menu.left }}>
          <div className="context-menu-item" onClick={() => { navigate(`/devices/${menu.id}`); setMenu(null); }}>📊 Details</div>
          <div className="context-menu-item" onClick={() => { onEdit(rawDevices.find(d => d.id === menu.id)); setMenu(null); }}>✏️ Edit</div>
          <div className="context-menu-item" onClick={() => { openSshSession(menu.id, menu.label); setMenu(null); }}>💻 Terminal</div>
        </div>
      )}

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
