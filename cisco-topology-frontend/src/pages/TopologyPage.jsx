import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import ReactFlow, {
  Background, Controls, MiniMap, applyNodeChanges,
  addEdge, applyEdgeChanges, useReactFlow, ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import SwitchNode from '../components/SwitchNode';
import CableEdge from '../components/CableEdge';
import BatchEditModal from '../components/BatchEditModal';
import ConfirmModal from '../components/ConfirmModal';
import PingModal from '../components/PingModal';
import PingIcon from '../components/PingIcon';
import TraceModal from '../components/TraceModal';
import TraceIcon from '../components/TraceIcon';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import { t } from '../i18n';
import { showToast } from '../Toast';
import { useTopologyTabs } from '../hooks/useTopologyTabs';

const nodeTypes = { switchNode: SwitchNode };
const edgeTypes = { cable: CableEdge };

// MiniMap'in her render'da yeniden çizilmemesi için modül seviyesinde sabit
const minimapNodeColor = (node) =>
  node.data?.status === 'DOWN' ? '#ef4444' : node.data?.status === 'UP' ? '#34d399' : '#64748b';

function TopologyInner({ onEdit, onClone }) {
  const { rawDevices, edges, setEdges, fetchData, openSshSession } = useApp();
  const { isAdmin, authFetch, csrfToken, allowedCommands } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tabId } = useParams();
  const reactFlowWrapper = useRef(null);
  const { fitView, setCenter } = useReactFlow();
  const { tabs, addTab, removeTab, renameTab, reorderTabs } = useTopologyTabs();

  const activeTabId = tabId || 'main';
  const [menu, setMenu] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null);
  const [tabMenu, setTabMenu] = useState(null);
  const [batchEditIds, setBatchEditIds] = useState(null); // çoklu seçim toplu düzenleme
  const [selMenu, setSelMenu] = useState(null); // çoklu seçim sağ-tık menüsü {ids, top, left}
  const [confirmState, setConfirmState] = useState(null); // tema uyumlu onay {title, message, onConfirm}
  const [pingIp, setPingIp] = useState(null); // cihaz bazlı ping (IP kilitli)
  const [traceIp, setTraceIp] = useState(null); // cihaz bazlı trace (IP kilitli)
  const [dragTabId, setDragTabId] = useState(null);       // sürüklenen sekme
  const [dragOverTabId, setDragOverTabId] = useState(null); // üzerine gelinen sekme
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
        setSelMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Node'ları sync — main tab tüm cihazları gösterir, diğer tab'lar kendi cihazlarını.
  // Perf: değişmeyen node'ların kimliğini KORU (aynı obje) → memo(SwitchNode) kısa devre
  // yapar, her poll'de tüm node'lar yeniden çizilmez. Hiçbir şey değişmediyse prev döner.
  useEffect(() => {
    setLocalNodes(prev => {
      const prevById = new Map(prev.map(n => [n.id, n]));
      const devices = activeTabId === 'main'
        ? rawDevices.filter(s => !s.topologyPage || s.topologyPage === 'main')
        : rawDevices.filter(s => s.topologyPage === activeTabId);
      let changed = devices.length !== prev.length;
      const updated = devices.map(s => {
        const existing = prevById.get(s.id);
        const d = existing?.data;
        const type = s.type || 'switch';
        // SwitchNode yalnızca bu alanları okur — latency artık gösterilmiyor, dahil değil
        const same = d && d.label === s.name && d.ip === s.ip && d.status === s.status && d.type === type;
        if (existing && same) return existing;
        changed = true;
        const data = { label: s.name, ip: s.ip, status: s.status, type };
        return existing
          ? { ...existing, data }
          : { id: s.id, type: 'switchNode', position: s.position || { x: Math.random() * 600, y: Math.random() * 400 }, data };
      });
      return changed ? updated : prev;
    });
  }, [rawDevices, activeTabId]);

  // URL'den zoom-to-device (Focus). Tek-sefer: hedef bulununca bir kez merkezle;
  // rawDevices 4sn'de bir güncellendiğinden aksi halde kullanıcı kaydırsa da geri zıplardı.
  const zoomedRef = useRef(null);
  useEffect(() => {
    const zoomTo = searchParams.get('zoom');
    if (!zoomTo) { zoomedRef.current = null; return; } // param yoksa sıfırla (yeni Focus'a hazır)
    if (zoomedRef.current === zoomTo) return;           // bu hedef için zaten merkezlendi
    const device = rawDevices.find(d => d.id === zoomTo);
    if (device?.position) {
      zoomedRef.current = zoomTo;
      setTimeout(() => setCenter(device.position.x + 65, device.position.y + 40, { zoom: 1.5, duration: 800 }), 300);
    }
  }, [searchParams, rawDevices, setCenter]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { setMenu(null); setEdgeMenu(null); setTabMenu(null); setSelMenu(null); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Cihaz kimliğe göre O(1) lookup — styledEdges'teki O(E×D) find'ı önler
  const deviceById = useMemo(() => new Map(rawDevices.map(d => [d.id, d])), [rawDevices]);

  // Değişmeyen edge'lerin stillenmiş objesini önbellekle → aynı referans kalınca
  // ReactFlow edge'i yeniden çizmez (edges her poll'de yeni dizi olsa bile).
  const edgeCacheRef = useRef(new Map());
  const styledEdges = useMemo(() => {
    const cache = edgeCacheRef.current;
    const liveIds = new Set();
    const next = edges.map(e => {
      liveIds.add(e.id);
      const src = deviceById.get(e.source);
      const tgt = deviceById.get(e.target);
      const active = src?.status === 'UP' && tgt?.status === 'UP';
      const wireless = src?.type === 'antenna' && tgt?.type === 'antenna';
      // İmza yalnızca görsel/yapısal alanlardan; edge obje kimliğinden bağımsız
      const sig = `${active}|${wireless}|${e.source}|${e.target}|${e.sourceHandle || ''}|${e.targetHandle || ''}`;
      const cached = cache.get(e.id);
      if (cached && cached.sig === sig) return cached.styled;

      const styled = wireless
        // Anten-anten: düz çizgi (eğri bezier değil)
        ? { ...e, type: 'straight', animated: false, className: active ? 'wireless-edge' : 'wireless-edge-idle',
            style: { stroke: active ? 'rgba(245, 158, 11, 0.7)' : 'rgba(148, 163, 184, 0.35)', strokeWidth: 1.5, opacity: 1 } }
        : { ...e, type: 'cable', animated: false, data: { ...(e.data || {}), active },
            style: { stroke: active ? 'rgba(250, 204, 21, 0.5)' : 'rgba(148, 163, 184, 0.28)', strokeWidth: 1.6, opacity: 1 } };
      cache.set(e.id, { sig, styled });
      return styled;
    });
    // Silinen edge'leri önbellekten temizle (sınırsız büyümesin)
    for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id);
    return next;
  }, [edges, deviceById]);

  const onConnect = useCallback((params) => {
    if (params.source === params.target) return; // kendine bağlanma engeli (savunma amaçlı)
    const newEdge = {
      ...params,
      id: `e-${params.source}-${params.target}-${Date.now()}`,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      animated: true,
      style: { stroke: 'var(--text-muted)', strokeWidth: 1.5 }
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

  // Node değişimleri: uygula + sürüklemesi BİTEN node'ların (dragging===false) konumunu
  // backend'e kaydet. ReactFlow multi-drag'de her node için ayrı position change gönderir,
  // bu yüzden tek/çoklu sürüklemede tüm taşınan node'lar güvenle kalıcılaşır.
  const onNodesChange = useCallback((changes) => {
    const stopped = changes.filter(c => c.type === 'position' && c.dragging === false).map(c => c.id);
    setLocalNodes(nds => {
      const next = applyNodeChanges(changes, nds);
      for (const id of stopped) {
        const n = next.find(nn => nn.id === id);
        if (n) authFetch(`/switches/${id}`, { method: 'PUT', body: JSON.stringify({ position: n.position }) }).catch(() => {});
      }
      return next;
    });
  }, [authFetch]);
  const onEdgesChange = useCallback((changes) => setEdges(eds => applyEdgeChanges(changes, eds)), [setEdges]);

  // Sürüklenen sekmeyi hedefin bulunduğu konuma taşı
  const handleTabDrop = (targetId) => {
    const from = tabs.findIndex(t => t.id === dragTabId);
    const to = tabs.findIndex(t => t.id === targetId);
    setDragTabId(null);
    setDragOverTabId(null);
    if (!dragTabId || dragTabId === targetId || from < 0 || to < 0) return;
    const ids = tabs.map(t => t.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorderTabs(ids);
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

  // Cihaz web arayüzü popup'ı (backend reverse proxy üzerinden)
  const [webModal, setWebModal] = useState(null); // { id, label, ip, scheme }

  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [showDiscoverDialog, setShowDiscoverDialog] = useState(false);
  const [selectedRootIds, setSelectedRootIds] = useState([]); // 0-2 backbone device IDs

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
      const validRoots = selectedRootIds.filter(id => id && id !== 'auto' && id !== 'none');
      if (validRoots.length > 0) body.rootDeviceIds = validRoots;

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
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      {/* Tab Bar */}
      <div className="topology-tabs">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`topology-tab ${activeTabId === tab.id ? 'active' : ''}`}
            // Yeniden sıralama: admin sürükleyebilir (rename sırasında kapalı — metin seçimi bozulmasın)
            draggable={isAdmin && renamingTab !== tab.id}
            onDragStart={(e) => { setDragTabId(tab.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (!dragTabId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverTabId !== tab.id) setDragOverTabId(tab.id); }}
            onDragLeave={() => setDragOverTabId(prev => (prev === tab.id ? null : prev))}
            onDrop={(e) => { e.preventDefault(); handleTabDrop(tab.id); }}
            onDragEnd={() => { setDragTabId(null); setDragOverTabId(null); }}
            style={{
              opacity: dragTabId === tab.id ? 0.4 : 1,
              boxShadow: dragOverTabId === tab.id && dragTabId !== tab.id ? 'inset 3px 0 0 var(--primary)' : undefined,
              cursor: isAdmin ? 'grab' : 'pointer'
            }}
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
            {/* Silme yalnızca sağ-tık menüsünden — yanlışlıkla tıklamayla sayfa silinmesin */}
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
              const { id, name } = tabMenu;
              setTabMenu(null);
              setConfirmState({
                title: t('deletePage'),
                message: `"${name}" ${t('deletePageConfirm')}`,
                onConfirm: () => { removeTab(id); if (activeTabId === id) navigate('/topology'); }
              });
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
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={isAdmin ? onEdgesChange : undefined}
          onConnect={isAdmin ? onConnect : undefined}
          onEdgesDelete={isAdmin ? onEdgesDelete : undefined}
          onEdgeContextMenu={isAdmin ? ((e, edge) => { e.preventDefault(); setEdgeMenu({ id: edge.id, top: e.clientY, left: e.clientX }); setMenu(null); }) : undefined}
          onNodeContextMenu={(e, n) => { e.preventDefault(); setMenu({ id: n.id, label: n.data.label, top: e.clientY, left: e.clientX, data: n.data }); setEdgeMenu(null); }}
          onSelectionContextMenu={isAdmin ? ((e, nodes) => { e.preventDefault(); if (nodes.length >= 2) { setSelMenu({ ids: nodes.map(n => n.id), top: e.clientY, left: e.clientX }); setMenu(null); setEdgeMenu(null); } }) : undefined}
          onPaneClick={() => { setMenu(null); setEdgeMenu(null); setTabMenu(null); setSelMenu(null); }}
          onMoveEnd={(_, viewport) => setZoomLevel(viewport.zoom)}
          isValidConnection={(c) => c.source !== c.target} // kendine bağlanma (loop) yok
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
                onClick={() => { setSelectedRootIds([]); setShowDiscoverDialog(true); }}
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
            {/* Geri dönünce Devices'a değil, bulunduğumuz topoloji sekmesine dönsün */}
            <div className="context-menu-item" onClick={() => {
              navigate(`/devices/${menu.id}`, {
                state: { from: activeTabId === 'main' ? '/topology' : `/topology/${activeTabId}` }
              });
              setMenu(null);
            }}>📊 Details</div>
            {menu.data?.ip && <div className="context-menu-item" onClick={() => { setPingIp(menu.data.ip); setMenu(null); }} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PingIcon size={15} /> Ping</div>}
            {menu.data?.ip && <div className="context-menu-item" onClick={() => { setTraceIp(menu.data.ip); setMenu(null); }} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><TraceIcon size={15} /> Trace</div>}
            {isAdmin && <div className="context-menu-item" onClick={() => { onEdit(rawDevices.find(d => d.id === menu.id)); setMenu(null); }}>✏️ Edit</div>}
            {isAdmin && <div className="context-menu-item" onClick={() => { onClone(rawDevices.find(d => d.id === menu.id)); setMenu(null); }}>⧉ Clone</div>}
            {(isAdmin || allowedCommands.length > 0) && <div className="context-menu-item" onClick={() => { openSshSession(menu.id, menu.label); setMenu(null); }}>💻 SSH Terminal</div>}
            {menu.data?.type === 'antenna' && <div className="context-menu-item" onClick={() => { setWebModal({ id: menu.id, label: menu.label, ip: menu.data.ip, scheme: 'http' }); setMenu(null); }}>🌐 Web</div>}
            <div className="context-menu-item" onClick={() => {
              const pos = localNodes.find(n => n.id === menu.id)?.position;
              if (pos) setCenter(pos.x + 65, pos.y + 40, { zoom: 2, duration: 500 });
              setMenu(null);
            }}>🔍 Zoom Here</div>
            {isAdmin && <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={async () => {
              const nodeId = menu.id;
              const nodeName = menu.label;
              setMenu(null);
              setConfirmState({
                title: t('deleteDevice'),
                message: `"${nodeName}" ${t('deleteDeviceConfirmShort')}`,
                onConfirm: async () => {
                  try {
                    const res = await authFetch('/switches/' + nodeId, { method: 'DELETE' });
                    if (res && res.ok) {
                      showToast(`"${nodeName}" deleted`, 'success');
                      fetchData();
                    } else {
                      const d = await res.json().catch(() => ({}));
                      showToast(d.error || 'Delete failed', 'error');
                    }
                  } catch { showToast('Delete failed', 'error'); }
                }
              });
            }}>🗑️ Delete Device</div>}
          </div>
        )}

        {/* Çoklu seçim sağ-tık menüsü */}
        {isAdmin && selMenu && (
          <div className="context-menu" style={{ top: selMenu.top, left: selMenu.left }}>
            <div style={{ padding: '4px 10px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{selMenu.ids.length} selected</div>
            <div className="context-menu-item" onClick={() => { setBatchEditIds(selMenu.ids); setSelMenu(null); }}>✏️ Batch Edit</div>
            <div className="context-menu-item" style={{ color: 'var(--danger)' }} onClick={async () => {
              const ids = selMenu.ids;
              setSelMenu(null);
              setConfirmState({
                title: t('deleteDevice'),
                message: `${ids.length} ${t('deleteSelectedConfirm')}`,
                onConfirm: async () => {
                  let deleted = 0;
                  for (const id of ids) {
                    try { const res = await authFetch('/switches/' + id, { method: 'DELETE' }); if (res && res.ok) deleted++; } catch { /* ignore */ }
                  }
                  showToast(`${deleted} device(s) deleted`, 'success');
                  fetchData();
                }
              });
            }}>🗑️ Delete Selected</div>
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

      {/* Cihaz Web Arayüzü — backend proxy üzerinden iframe */}
      {webModal && (
        <div className="modal-overlay" onClick={() => setWebModal(null)} onKeyDown={e => { if (e.key === 'Escape') setWebModal(null); }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '85vw', height: '85vh', background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)', borderRadius: 12,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
              <strong style={{ fontSize: '0.9rem' }}>🌐 {webModal.label}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'monospace' }}>{webModal.ip}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                {['http', 'https'].map(s => (
                  <button key={s} onClick={() => setWebModal(w => ({ ...w, scheme: s }))}
                    style={{
                      padding: '3px 10px', fontSize: '0.7rem', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border-color)', fontWeight: 600,
                      background: webModal.scheme === s ? 'var(--primary)' : 'transparent',
                      color: webModal.scheme === s ? '#0f172a' : 'var(--text-muted)'
                    }}>{s.toUpperCase()}</button>
                ))}
                {/* reloadKey artışı iframe'i remount ederek sayfayı yeniler */}
                <button onClick={() => setWebModal(w => ({ ...w, reloadKey: (w.reloadKey || 0) + 1 }))}
                  title={t('refresh')}
                  style={{
                    padding: '3px 9px', fontSize: '0.85rem', lineHeight: 1, borderRadius: 6, cursor: 'pointer',
                    border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)'
                  }}>⟳</button>
              </div>
              <button onClick={() => setWebModal(null)} className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: '1.3rem', lineHeight: 1, padding: '0 8px' }}>&times;</button>
            </div>
            <iframe
              key={`${webModal.id}-${webModal.scheme}-${webModal.reloadKey || 0}`}
              src={`${API_BASE}/webproxy/${webModal.id}/${webModal.scheme}/`}
              title={`${webModal.label} Web UI`}
              style={{ flex: 1, border: 'none', background: '#fff' }}
            />
          </div>
        </div>
      )}

      {/* Cihaz bazlı ping (IP kilitli) */}
      {pingIp && <PingModal ip={pingIp} lockIp onClose={() => setPingIp(null)} />}
      {traceIp && <TraceModal ip={traceIp} lockIp onClose={() => setTraceIp(null)} />}

      {/* Tema uyumlu onay penceresi (window.confirm yerine) */}
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          onCancel={() => setConfirmState(null)}
          onConfirm={() => { const fn = confirmState.onConfirm; setConfirmState(null); fn(); }}
        />
      )}

      {/* Çoklu seçim toplu düzenleme */}
      {isAdmin && batchEditIds && (
        <BatchEditModal
          deviceIds={batchEditIds}
          topoTabs={tabs}
          authFetch={authFetch}
          onClose={() => setBatchEditIds(null)}
          onDone={fetchData}
        />
      )}

      {/* Auto Topology Dialog */}
      {showDiscoverDialog && (
        <div className="modal-overlay" onClick={() => setShowDiscoverDialog(false)} onKeyDown={e => { if (e.key === 'Escape') setShowDiscoverDialog(false); }}>
          <div className="confirm-modal-content" onClick={e => e.stopPropagation()} style={{ minWidth: 380 }}>
            <h3 className="confirm-title">🔍 Auto Topology</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 16 }}>
              Discovers connections via CDP/LLDP and arranges devices in a tree layout.
              Select up to 2 backbone devices for redundant backbone topology.
            </p>

            {/* Backbone device selection */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Backbone Device 1 (top of tree)
              </label>
              <select
                className="modern-input"
                value={selectedRootIds[0] || 'auto'}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedRootIds(prev => {
                    if (val === 'auto') return prev.length > 1 ? [prev[1]] : [];
                    return prev.length > 1 ? [val, prev[1]] : [val];
                  });
                }}
                style={{ width: '100%' }}
              >
                <option value="auto">Auto-detect (most referenced device)</option>
                {localNodes
                  .slice()
                  .sort((a, b) => (a.data.label || '').localeCompare(b.data.label || ''))
                  .filter(n => n.id !== selectedRootIds[1])
                  .map(n => (
                    <option key={n.id} value={n.id}>
                      {n.data.label} ({n.data.ip})
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Backbone Device 2 (redundant — optional)
              </label>
              <select
                className="modern-input"
                value={selectedRootIds[1] || 'none'}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedRootIds(prev => {
                    if (val === 'none') return prev.length > 0 ? [prev[0]] : [];
                    return prev.length > 0 ? [prev[0], val] : ['auto', val];
                  });
                }}
                style={{ width: '100%' }}
              >
                <option value="none">— None (single backbone) —</option>
                {localNodes
                  .slice()
                  .sort((a, b) => (a.data.label || '').localeCompare(b.data.label || ''))
                  .filter(n => n.id !== selectedRootIds[0])
                  .map(n => (
                    <option key={n.id} value={n.id}>
                      {n.data.label} ({n.data.ip})
                    </option>
                  ))}
              </select>
            </div>

            {selectedRootIds.length === 2 && (
              <p style={{ color: 'var(--accent)', fontSize: '0.8rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                ⚡ Dual backbone: devices will be placed side by side and connected.
              </p>
            )}

            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setShowDiscoverDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAutoDiscover} autoFocus>
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
