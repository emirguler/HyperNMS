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
import { useViewport } from '../hooks/useViewport';
import { useLongPress } from '../hooks/useLongPress';

const nodeTypes = { switchNode: SwitchNode };
const edgeTypes = { cable: CableEdge };

// MiniMap'in her render'da yeniden çizilmemesi için modül seviyesinde sabit
const minimapNodeColor = (node) =>
  node.data?.status === 'DOWN' ? '#ef4444' : node.data?.status === 'UP' ? '#34d399' : '#64748b';

/* ==========================================================================
   DOKUNMATIK KATMANI - modul seviyesi yardimcilar
   React 19: bilesen govdesi ICINDE bilesen tanimlanmaz (her render'da remount eder).
   Bu yuzden TopoMenu ve tum stil sabitleri burada, modul kapsaminda duruyor.
   ========================================================================== */

/**
 * Yuzen baglam menusunu goruntu alaninin icinde tutar.
 * .context-menu position:fixed oldugu icin clientX/clientY dogrudan kullanilir;
 * kirpma olmadan 375px genislikte sag kenardan tasip erisilemez hale geliyordu.
 * @param   {number} x clientX
 * @param   {number} y clientY
 * @param   {number} w menunun tahmini genisligi
 * @param   {number} h menunun tahmini yuksekligi
 * @returns {{top:number,left:number}}
 */
function clampMenu(x, y, w = 200, h = 200) {
  if (typeof window === 'undefined') return { top: y, left: x };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.max(8, Math.min(x, vw - w - 8)),
    top: Math.max(8, Math.min(y, vh - h - 8)),
  };
}

// --- Alt sayfa (bottom sheet) sunumu ---
const SHEET_BACKDROP = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10004 };
const SHEET_BOX = {
  position: 'fixed', left: 0, right: 0, bottom: 0, top: 'auto',
  width: '100%', minWidth: 0, maxWidth: '100%',
  padding: 0, paddingBottom: 'calc(6px + env(safe-area-inset-bottom))',
  borderRadius: '18px 18px 0 0', borderBottom: 'none',
  overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
  // iOS'ta tam genislikte backdrop-filter her kaydirma karesinde repaint eder
  backdropFilter: 'none', WebkitBackdropFilter: 'none',
  zIndex: 10005,
};
const SHEET_HEAD = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
  position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 1,
};
const SHEET_TITLE = {
  fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)',
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const SHEET_CLOSE = {
  minWidth: 44, minHeight: 44, background: 'none', border: 'none', color: 'var(--text-muted)',
  fontSize: '1.4rem', lineHeight: 1, cursor: 'pointer', borderRadius: 8, touchAction: 'manipulation',
};
const SHEET_ROW = { minHeight: 48, padding: '0 16px', fontSize: '0.95rem', gap: 12, whiteSpace: 'normal', borderRadius: 0 };
const POPUP_TITLE = { padding: '4px 10px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 };

/**
 * TopoMenu - TEK menu govdesi, iki sunum.
 *   sheet=false -> ekran icine kirpilmis yuzen popup (fare)
 *   sheet=true  -> alt sayfa: tam genislik, 48px satirlar, guvenli alan dolgusu
 *
 * Menu DURUM nesneleri (menu/edgeMenu/tabMenu/selMenu) aynen kalir; yalnizca sunum
 * degisir - menu mantigi catallanmaz. .context-menu sinifi iki modda da korunur ki
 * disari-tiklama koruyucusu (.closest('.context-menu')) ve responsive.css calissin.
 *
 * @param {Object}  props
 * @param {boolean} props.sheet  alt sayfa sunumu mu
 * @param {boolean} props.short  kisa ekran (yatay telefon) - sayfa daha yuksek olabilir
 * @param {{key:string,label:any,onClick:Function,danger?:boolean,style?:Object}[]} props.items
 */
function TopoMenu({ sheet, short, top, left, zIndex, title, popupTitle, items, onClose }) {
  const rows = (items || []).filter(Boolean);
  if (rows.length === 0) return null;

  if (!sheet) {
    return (
      <div className="context-menu" style={{ top, left, zIndex }}
        onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
        {popupTitle ? <div style={POPUP_TITLE}>{popupTitle}</div> : null}
        {rows.map(it => (
          <div key={it.key} className="context-menu-item"
            style={{ ...(it.style || null), ...(it.danger ? { color: 'var(--danger)' } : null) }}
            onClick={it.onClick}>{it.label}</div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div style={SHEET_BACKDROP} onClick={onClose} />
      <div className="context-menu" style={{ ...SHEET_BOX, maxHeight: short ? '88vh' : '70vh' }}
        onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
        <div style={SHEET_HEAD}>
          <span style={SHEET_TITLE}>{title || 'Actions'}</span>
          <button type="button" style={SHEET_CLOSE} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        {rows.map(it => (
          <div key={it.key} className="context-menu-item"
            style={{ ...SHEET_ROW, ...(it.danger ? { color: 'var(--danger)' } : null) }}
            onClick={it.onClick}>{it.label}</div>
        ))}
      </div>
    </>
  );
}

// --- Dokunmatik arac cubugu ---
const TB_WRAP = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px',
  paddingLeft: 'max(10px, env(safe-area-inset-left))',
  paddingRight: 'max(10px, env(safe-area-inset-right))',
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)',
  flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
};
const TB_BTN = {
  minWidth: 44, minHeight: 44, padding: '0 12px', borderRadius: 10,
  border: '1px solid var(--border-color)', background: 'transparent',
  color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600, lineHeight: 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  cursor: 'pointer', flexShrink: 0, touchAction: 'manipulation',
};
const TB_BTN_ON = { ...TB_BTN, borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--primary-light)' };
const TB_SEARCH_ROW = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 8px',
  paddingLeft: 'max(10px, env(safe-area-inset-left))',
  paddingRight: 'max(10px, env(safe-area-inset-right))',
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
};
const TB_RESULTS = {
  maxHeight: '40vh', overflowY: 'auto', overscrollBehavior: 'contain',
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
};
const TB_RESULT_ROW = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  minHeight: 48, padding: '0 14px', cursor: 'pointer', color: 'var(--text-main)',
  fontSize: '0.9rem', borderTop: '1px solid var(--border-color)', touchAction: 'manipulation',
};

// --- Sekme seridi (dokunmatik) ---
const TAB_STRIP_TOUCH = {
  WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
  scrollSnapType: 'x proximity',
};
const TAB_FADE_L = {
  position: 'absolute', left: 0, top: 0, bottom: 0, width: 12, pointerEvents: 'none',
  background: 'linear-gradient(90deg, var(--bg-panel), rgba(0,0,0,0))',
};
const TAB_FADE_R = {
  position: 'absolute', right: 0, top: 0, bottom: 0, width: 12, pointerEvents: 'none',
  background: 'linear-gradient(270deg, var(--bg-panel), rgba(0,0,0,0))',
};
// Uzun basmada iOS metin secme balonunu / suruk onizlemesini bastir
const CANVAS_TOUCH = { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' };

function TopologyInner({ onEdit, onClone }) {
  const { rawDevices, edges, setEdges, fetchData, openSshSession } = useApp();
  const { isAdmin, isOperator, authFetch, csrfToken, allowedCommands, fullSsh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tabId } = useParams();
  const reactFlowWrapper = useRef(null);
  const { fitView, setCenter, zoomIn, zoomOut } = useReactFlow();
  const { tabs, addTab, removeTab, renameTab, reorderTabs } = useTopologyTabs();

  // Dokunmatik / dar govde kararlari - responsive.css ile birebir ayni kirilma noktalari
  const { isPhone, isShort, isTouch } = useViewport();
  // Parmak arayuzu: dokunmatik cihaz VEYA dar/kisa govde (kucuk masaustu penceresi dahil)
  const showTouchBar = isTouch || isPhone || isShort;
  // Tuvalin daraldigi durum: MiniMap gizlenir, minZoom duser
  const compactCanvas = isPhone || isShort;

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
  // --- Dokunmatik durum ---
  const [touchEdit, setTouchEdit] = useState(false);   // parmakla taşıma/bağlama kilidi (varsayılan KAPALI)
  const [selectMode, setSelectMode] = useState(false); // kutu ile çoklu seçim modu
  const [selectedIds, setSelectedIds] = useState([]);  // çoklu seçimdeki node id'leri
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const prevTabId = useRef(activeTabId);

  // Tüm bağlam menülerini kapat — pan, yön değişimi, dışarı tıklama ve Escape ortak yolu
  const closeAllMenus = useCallback(() => {
    setMenu(null);
    setEdgeMenu(null);
    setTabMenu(null);
    setSelMenu(null);
  }, []);

  // FitView on tab change
  useEffect(() => {
    if (prevTabId.current !== activeTabId) {
      prevTabId.current = activeTabId;
      setTimeout(() => fitView({ duration: 200 }), 50);
    }
  }, [activeTabId, fitView]);

  // Close all context menus on outside click.
  // pointerdown (mousedown değil): dokunmatikte sentetik mousedown ancak touchend'den
  // SONRA geldiği için menü geç kapanıyordu; pointerdown hem farede hem parmakta anında gelir.
  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest || !e.target.closest('.context-menu')) closeAllMenus();
    };
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [closeAllMenus]);

  // Yön değişiminde açık menü ekranın ortasında asılı kalmasın
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOrient = () => closeAllMenus();
    window.addEventListener('orientationchange', onOrient);
    return () => window.removeEventListener('orientationchange', onOrient);
  }, [closeAllMenus]);

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

  // Focus (?zoom=): kullanıcının önerdiği sıra — fitView otursun, HEMEN ARDINDAN sağ-tık
  // "Zoom Here" ile birebir aynı setCenter uygulansın.
  // KÖK NEDEN (önceki hatalar): efekt rawDevices/localNodes'a da bağlıydı; mount'taki ilk fetchData
  // ~100-200ms sonra rawDevices'ı güncelleyip efekti YENİDEN çalıştırıyor, cleanup bekleyen
  // setTimeout'u iptal ediyor, tek-sefer guard'ı da yeniden kurulmasını engelliyordu → setCenter
  // hiç ateşlenmiyordu. Çözüm: efekt yalnızca [searchParams, setCenter]'a bağlı (kararlı); en güncel
  // veriyi ref'ten okuyup node bu sekmede görünene kadar kısa aralıklarla deniyoruz → iptal olmaz.
  const localNodesRef = useRef(localNodes); localNodesRef.current = localNodes;
  const rawDevicesRef = useRef(rawDevices); rawDevicesRef.current = rawDevices;
  const zoomedRef = useRef(null);
  useEffect(() => {
    const zoomTo = searchParams.get('zoom');
    if (!zoomTo) { zoomedRef.current = null; return; }
    if (zoomedRef.current === zoomTo) return;
    let centerTimer = null;
    const start = Date.now();
    const tryFocus = () => {
      if (zoomedRef.current === zoomTo) return true;
      const found = localNodesRef.current.find(n => n.id === zoomTo);
      const pos = rawDevicesRef.current.find(d => d.id === zoomTo)?.position || found?.position;
      if (!found || !pos) return false;                   // node bu sekmede henüz yok → tekrar dene
      zoomedRef.current = zoomTo;
      centerTimer = setTimeout(() => {
        console.log('[FOCUS] setCenter', pos);            // (geçici) çalıştığını doğrulamak için
        try { setCenter(pos.x + 65, pos.y + 40, { zoom: 2, duration: 500 }); } catch (e) { /* ignore */ }
      }, 400);                                            // fitView otursun, hemen ardından zoom
      return true;
    };
    const iv = setInterval(() => { if (tryFocus() || Date.now() - start > 6000) clearInterval(iv); }, 150);
    if (tryFocus()) clearInterval(iv);                    // node zaten yüklüyse beklemeden
    return () => { clearInterval(iv); if (centerTimer) clearTimeout(centerTimer); };
  }, [searchParams, setCenter]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeAllMenus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeAllMenus]);

  /* --- UZUN BASMA -> AYNI menü durumu --------------------------------------
     Dokunmatik cihaz `contextmenu` olayını üretmez; node/edge menüsüne giden tek yol
     sağ tıktı. Burada 500ms uzun basma AYNI setMenu/setEdgeMenu çağrısını yapar.
     Hedefi pointerdown'ın target'ından çözüyoruz: ReactFlow node sarmalayıcısında
     data-id, edge grubunda data-testid="rf__edge-<id>" var. */
  const openMenuFromTarget = useCallback((ev) => {
    const start = (ev.target && ev.target.closest)
      ? ev.target
      : (typeof document !== 'undefined' ? document.elementFromPoint(ev.clientX, ev.clientY) : null);
    if (!start || !start.closest) return;

    const nodeEl = start.closest('.react-flow__node');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-id');
      const n = localNodesRef.current.find(x => x.id === id);
      if (!n) return;
      setEdgeMenu(null); setTabMenu(null); setSelMenu(null);
      setMenu({ id: n.id, label: n.data.label, data: n.data, ...clampMenu(ev.clientX, ev.clientY, 220, 300) });
      return;
    }

    if (!isAdmin) return;
    const edgeEl = start.closest('.react-flow__edge');
    if (edgeEl) {
      const testId = edgeEl.getAttribute('data-testid') || '';
      if (!testId.startsWith('rf__edge-')) return;
      setMenu(null); setTabMenu(null); setSelMenu(null);
      setEdgeMenu({ id: testId.slice('rf__edge-'.length), ...clampMenu(ev.clientX, ev.clientY, 200, 70) });
    }
  }, [isAdmin]);
  const canvasLongPress = useLongPress(openMenuFromTarget);

  // Sekme şeridi uzun basma -> rename/delete/move menüsü (sağ tıkın dokunmatik karşılığı)
  const openTabMenuFromTarget = useCallback((ev) => {
    if (!isAdmin) return;
    const el = (ev.target && ev.target.closest) ? ev.target.closest('.topology-tab') : null;
    if (!el) return;
    const id = el.getAttribute('data-tab-id');
    const tab = tabs.find(tb => tb.id === id);
    if (!tab) return;
    const r = el.getBoundingClientRect();
    setMenu(null); setEdgeMenu(null); setSelMenu(null);
    setTabMenu({ id: tab.id, name: tab.name, ...clampMenu(ev.clientX, r.bottom, 200, 200) });
    // useLongPress handler'ı bir ref'te tuttuğu için kimliğin değişmesi maliyetsiz
  }, [isAdmin, tabs]);
  const tabsLongPress = useLongPress(openTabMenuFromTarget);

  // Çoklu seçim: yalnızca dokunmatik araç çubuğu açıkken dinlenir (masaüstü render'ı değişmesin)
  const handleSelectionChange = useCallback(({ nodes }) => {
    const ids = nodes.map(n => n.id);
    setSelectedIds(prev =>
      (prev.length === ids.length && prev.every((v, i) => v === ids[i])) ? prev : ids
    );
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

  // Dokunmatik sıralama: HTML5 sürükle-bırak parmakla ateşlenmez → menüden taşı
  const moveTab = (id, delta) => {
    const ids = tabs.map(t => t.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    setTabMenu(null);
    if (from < 0 || to < 0 || to >= ids.length) return;
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
    setTabMenu({ id: tab.id, name: tab.name, ...clampMenu(e.clientX, e.clientY, 200, 200) });
  };

  // Sekme "kebap" düğmesi (dokunmatik): menüyü düğmenin altına açar
  const handleTabKebab = (tab, e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(null); setEdgeMenu(null); setSelMenu(null);
    setTabMenu({ id: tab.id, name: tab.name, ...clampMenu(r.left, r.bottom + 4, 200, 200) });
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

  // Cihaz arama / atlama listesi — büyük bir grafiği parmakla taramak imkânsız.
  // "Zoom Here" ile aynı setCenter yolunu kullanır.
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [];
    return localNodes
      .filter(n => (n.data.label || '').toLowerCase().includes(q) || (n.data.ip || '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [searchQ, localNodes]);

  const focusNode = useCallback((id) => {
    const pos = localNodesRef.current.find(n => n.id === id)?.position;
    if (pos) setCenter(pos.x + 65, pos.y + 40, { zoom: 1.6, duration: 400 });
    setSearchOpen(false);
    setSearchQ('');
  }, [setCenter]);

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

  /* ---------------------------------------------------------------------
     BAĞLAM MENÜSÜ SATIRLARI — tek kaynak, iki sunum.
     Aynı diziler hem masaüstü popup'ında hem dokunmatik alt sayfada kullanılır.
     --------------------------------------------------------------------- */
  const tabIndex = tabMenu ? tabs.findIndex(tb => tb.id === tabMenu.id) : -1;
  const tabMenuItems = tabMenu ? [
    { key: 'rename', label: '✏️ Rename', onClick: () => handleStartRename(tabMenu.id, tabMenu.name) },
    // Dokunmatikte HTML5 sürükle-bırak yok → sırayı menüden değiştir
    showTouchBar && tabIndex > 0 && { key: 'left', label: '⬅️ Move left', onClick: () => moveTab(tabMenu.id, -1) },
    showTouchBar && tabIndex >= 0 && tabIndex < tabs.length - 1 && { key: 'right', label: '➡️ Move right', onClick: () => moveTab(tabMenu.id, 1) },
    tabMenu.id !== 'main' && {
      key: 'delete', danger: true, label: '🗑️ Delete',
      onClick: () => {
        const { id, name } = tabMenu;
        setTabMenu(null);
        setConfirmState({
          title: t('deletePage'),
          message: `"${name}" ${t('deletePageConfirm')}`,
          onConfirm: () => { removeTab(id); if (activeTabId === id) navigate('/topology'); }
        });
      }
    },
  ] : [];

  const nodeMenuItems = menu ? [
    {
      key: 'details', label: '📊 Details',
      // Geri dönünce Devices'a değil, bulunduğumuz topoloji sekmesine dönsün
      onClick: () => {
        navigate(`/devices/${menu.id}`, {
          state: { from: activeTabId === 'main' ? '/topology' : `/topology/${activeTabId}` }
        });
        setMenu(null);
      }
    },
    menu.data?.ip && {
      key: 'ping', style: { display: 'flex', alignItems: 'center', gap: 8 },
      label: <><PingIcon size={15} /> Ping</>,
      onClick: () => { setPingIp(menu.data.ip); setMenu(null); }
    },
    menu.data?.ip && {
      key: 'trace', style: { display: 'flex', alignItems: 'center', gap: 8 },
      label: <><TraceIcon size={15} /> Trace</>,
      onClick: () => { setTraceIp(menu.data.ip); setMenu(null); }
    },
    isAdmin && { key: 'edit', label: '✏️ Edit', onClick: () => { onEdit(rawDevices.find(d => d.id === menu.id)); setMenu(null); } },
    isAdmin && { key: 'clone', label: '⧉ Clone', onClick: () => { onClone(rawDevices.find(d => d.id === menu.id)); setMenu(null); } },
    isOperator && (isAdmin || fullSsh || allowedCommands.length > 0) && {
      key: 'ssh', label: '💻 SSH Terminal',
      onClick: () => { openSshSession(menu.id, menu.label); setMenu(null); }
    },
    menu.data?.type === 'antenna' && {
      key: 'web', label: '🌐 Web',
      onClick: () => { setWebModal({ id: menu.id, label: menu.label, ip: menu.data.ip, scheme: 'http' }); setMenu(null); }
    },
    {
      key: 'zoom', label: '🔍 Zoom Here',
      onClick: () => {
        const pos = localNodes.find(n => n.id === menu.id)?.position;
        if (pos) setCenter(pos.x + 65, pos.y + 40, { zoom: 2, duration: 500 });
        setMenu(null);
      }
    },
    isAdmin && {
      key: 'delete', danger: true, label: '🗑️ Delete Device',
      onClick: () => {
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
      }
    },
  ] : [];

  const selMenuItems = selMenu ? [
    { key: 'batch', label: '✏️ Batch Edit', onClick: () => { setBatchEditIds(selMenu.ids); setSelMenu(null); } },
    {
      key: 'delete', danger: true, label: '🗑️ Delete Selected',
      onClick: () => {
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
      }
    },
  ] : [];

  const edgeMenuItems = edgeMenu ? [
    {
      key: 'delete', danger: true, label: <>🗑️ {t('deleteConnection')}</>,
      onClick: () => {
        authFetch(`/edges/${edgeMenu.id}`, { method: 'DELETE' });
        setEdges(eds => eds.filter(e => e.id !== edgeMenu.id));
        setEdgeMenu(null);
      }
    },
  ] : [];

  // Şerit yüksekliği: coarse pointer'da 48px (responsive.css), kısa ekranda 36px,
  // fare + dar pencerede App.css'in 36px'i. Düğme şeridi taşırmamalı.
  const tabBtn = (isTouch && !isShort) ? 44 : 32;
  const tabIconBtnStyle = {
    background: 'none', border: '1px solid var(--border-color)', color: 'inherit',
    borderRadius: 8, minWidth: tabBtn, height: tabBtn, padding: 0, flexShrink: 0,
    fontSize: '0.9rem', lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      {/* Tab Bar — dokunmatikte kenar solmaları için saran kap */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {/* Uzun basma YALNIZCA gerçek dokunmatikte bağlanır (isTouch = hover:none).
            Dar bir masaüstü penceresinde fare hâlâ sağ tıklayabildiği için orada
            bağlamak sadece zarar veriyordu: 500ms basılı tutulan SOL tık menüyü
            açıyor ve ardından gelen tıklamayı yutuyordu. */}
        <div
          className="topology-tabs"
          style={isTouch ? TAB_STRIP_TOUCH : undefined}
          {...(isTouch ? tabsLongPress : null)}
        >
          {tabs.map(tab => (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`topology-tab ${activeTabId === tab.id ? 'active' : ''}`}
              // Yeniden sıralama: admin sürükleyebilir (rename sırasında kapalı — metin seçimi bozulmasın).
              // Dokunmatikte HTML5 DnD ateşlenmez ve iPadOS'ta uzun basmayı yutar → kapalı, menüden taşınır.
              draggable={isAdmin && !isTouch && renamingTab !== tab.id}
              onDragStart={(e) => { setDragTabId(tab.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (!dragTabId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverTabId !== tab.id) setDragOverTabId(tab.id); }}
              onDragLeave={() => setDragOverTabId(prev => (prev === tab.id ? null : prev))}
              onDrop={(e) => { e.preventDefault(); handleTabDrop(tab.id); }}
              onDragEnd={() => { setDragTabId(null); setDragOverTabId(null); }}
              style={{
                opacity: dragTabId === tab.id ? 0.4 : 1,
                boxShadow: dragOverTabId === tab.id && dragTabId !== tab.id ? 'inset 3px 0 0 var(--primary)' : undefined,
                cursor: isAdmin && !isTouch ? 'grab' : 'pointer'
              }}
              onClick={() => navigate(tab.id === 'main' ? '/topology' : `/topology/${tab.id}`)}
              onContextMenu={isAdmin ? ((e) => handleTabContextMenu(tab, e)) : undefined}
            >
              {renamingTab === tab.id ? (
                <>
                  <input
                    className="topology-tab-rename"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    // Dokunmatikte blur=kaydet, yazılım klavyesi açılıp kapanırken kazara commit ediyor
                    onBlur={showTouchBar ? undefined : handleFinishRename}
                    onKeyDown={e => { if (e.key === 'Enter') handleFinishRename(); if (e.key === 'Escape') setRenamingTab(null); }}
                    onClick={e => e.stopPropagation()}
                    enterKeyHint="done"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                  />
                  {showTouchBar && (
                    <>
                      <button type="button" style={tabIconBtnStyle} aria-label="Save name"
                        onClick={e => { e.stopPropagation(); handleFinishRename(); }}>✓</button>
                      <button type="button" style={tabIconBtnStyle} aria-label="Cancel rename"
                        onClick={e => { e.stopPropagation(); setRenamingTab(null); }}>✕</button>
                    </>
                  )}
                </>
              ) : (
                <span>{tab.name}</span>
              )}
              {/* Silme yalnızca menüden — yanlışlıkla tıklamayla sayfa silinmesin.
                  Dokunmatikte sağ tık yok: kebap düğmesi + uzun basma aynı menüyü açar. */}
              {isAdmin && showTouchBar && renamingTab !== tab.id && (
                <button type="button" style={tabIconBtnStyle} aria-label={`${tab.name} actions`}
                  onClick={(e) => handleTabKebab(tab, e)}>⋮</button>
              )}
            </div>
          ))}
          {isAdmin && <button className="topology-tab-add" onClick={handleAddTab} title="Add sub page">+</button>}
        </div>
        {/* Kaydırılabilir olduğunu belli eden kenar solmaları */}
        {showTouchBar && (
          <>
            <div style={TAB_FADE_L} />
            <div style={TAB_FADE_R} />
          </>
        )}
      </div>

      {/* Tab menüsü — dokunmatikte alt sayfa, farede kırpılmış popup */}
      {isAdmin && tabMenu && (
        <TopoMenu
          sheet={showTouchBar}
          short={isShort}
          top={tabMenu.top}
          left={tabMenu.left}
          zIndex={9999}
          title={tabMenu.name}
          items={tabMenuItems}
          onClose={() => setTabMenu(null)}
        />
      )}

      {/* Dokunmatik araç çubuğu — ReactFlow'un 26px Controls'unun yerini alır.
          KISA EKRANDA ARAMA ACIKKEN GIZLENIR: 812x375'te navbar 44 + sekme seridi 36
          + arac cubugu 56 + arama satiri 52 + sonuc listesi 150 = 338px chrome ediyor
          ve tuvale 37px kaliyordu. Gizlenince tuval ~93px'e cikar; arama satirindaki
          x dugmesi (ve bir sonuca dokunmak) cubugu geri getirir. */}
      {showTouchBar && !(isShort && searchOpen) && (
        <div className="rw-scroll-x" style={TB_WRAP}>
          <button type="button" style={searchOpen ? TB_BTN_ON : TB_BTN}
            onClick={() => setSearchOpen(o => !o)} aria-label="Search device">🔍</button>
          <button type="button" style={TB_BTN}
            onClick={() => fitView({ duration: 300, padding: 0.15 })}>Fit</button>
          <button type="button" style={TB_BTN}
            onClick={() => zoomOut({ duration: 200 })} aria-label="Zoom out">−</button>
          <button type="button" style={TB_BTN}
            onClick={() => zoomIn({ duration: 200 })} aria-label="Zoom in">+</button>
          {isAdmin && isTouch && (
            <button type="button" style={touchEdit ? TB_BTN_ON : TB_BTN}
              onClick={() => setTouchEdit(v => !v)}>
              {touchEdit ? '🔓 Edit' : '🔒 Locked'}
            </button>
          )}
          {isAdmin && (
            <button type="button" style={selectMode ? TB_BTN_ON : TB_BTN}
              onClick={() => { setSelectMode(v => !v); setSelectedIds([]); }}>☑ Select</button>
          )}
          {isAdmin && selectedIds.length >= 2 && (
            <button type="button" style={TB_BTN_ON}
              onClick={() => { closeAllMenus(); setSelMenu({ ids: selectedIds, top: 60, left: 12 }); }}>
              ⋯ {selectedIds.length}
            </button>
          )}
          {isAdmin && (
            <button type="button" style={TB_BTN} disabled={discovering}
              onClick={() => { setSelectedRootIds([]); setShowDiscoverDialog(true); }}>
              {discovering ? '⏳' : '🔍 Auto'}
            </button>
          )}
        </div>
      )}

      {showTouchBar && searchOpen && (
        <div style={TB_SEARCH_ROW}>
          <input
            type="search"
            className="modern-input"
            placeholder="Search device or IP..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="button" style={TB_BTN}
            onClick={() => { setSearchOpen(false); setSearchQ(''); }} aria-label="Close search">✕</button>
        </div>
      )}
      {showTouchBar && searchOpen && searchResults.length > 0 && (
        <div style={TB_RESULTS}>
          {searchResults.map(n => (
            <div key={n.id} style={TB_RESULT_ROW} onClick={() => focusNode(n.id)}>
              {/* .rw-truncate yalnızca <=1024px'te tanımlı; geniş bir tablette de
                  kırpılsın diye aynı kurallar inline tekrarlanıyor */}
              <span className="rw-truncate" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.data.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'monospace', flexShrink: 0 }}>{n.data.ip}</span>
            </div>
          ))}
        </div>
      )}

      {/* React Flow Canvas */}
      <div
        className={`topology-canvas ${zoomLevel < 0.45 ? 'zoom-minimal' : zoomLevel < 0.7 ? 'zoom-compact' : ''}`}
        style={isTouch ? { flex: 1, position: 'relative', ...CANVAS_TOUCH } : { flex: 1, position: 'relative' }}
        ref={reactFlowWrapper}
        {...(isTouch ? canvasLongPress : null)}
      >
        <ReactFlow
          nodes={localNodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={isAdmin ? onEdgesChange : undefined}
          onConnect={isAdmin ? onConnect : undefined}
          onEdgesDelete={isAdmin ? onEdgesDelete : undefined}
          onEdgeContextMenu={isAdmin ? ((e, edge) => { e.preventDefault(); setEdgeMenu({ id: edge.id, ...clampMenu(e.clientX, e.clientY, 200, 70) }); setMenu(null); }) : undefined}
          onNodeContextMenu={(e, n) => { e.preventDefault(); setMenu({ id: n.id, label: n.data.label, data: n.data, ...clampMenu(e.clientX, e.clientY, 220, 300) }); setEdgeMenu(null); }}
          onSelectionContextMenu={isAdmin ? ((e, nodes) => { e.preventDefault(); if (nodes.length >= 2) { setSelMenu({ ids: nodes.map(n => n.id), ...clampMenu(e.clientX, e.clientY, 200, 120) }); setMenu(null); setEdgeMenu(null); } }) : undefined}
          // Dokunmatikte 20px'lik kenara parmakla basmak imkânsız → tek dokunuş menüyü açar
          onEdgeClick={isAdmin && showTouchBar ? ((e, edge) => { setMenu(null); setTabMenu(null); setSelMenu(null); setEdgeMenu({ id: edge.id, ...clampMenu(e.clientX, e.clientY, 200, 70) }); }) : undefined}
          onSelectionChange={showTouchBar ? handleSelectionChange : undefined}
          onPaneClick={closeAllMenus}
          // Pan başlayınca position:fixed menü havada asılı kalmasın (yalnızca dar gövde)
          onMoveStart={showTouchBar ? closeAllMenus : undefined}
          onMoveEnd={(_, viewport) => setZoomLevel(viewport.zoom)}
          isValidConnection={(c) => c.source !== c.target} // kendine bağlanma (loop) yok
          // Dokunmatikte varsayılan KİLİTLİ: parmak teması düzeni yeniden yazıyordu
          // (/switches PUT) veya kazara /edges POST atıyordu. Araç çubuğundaki "Edit" açar.
          nodesDraggable={isAdmin && (!isTouch || touchEdit)}
          nodesConnectable={isAdmin && (!isTouch || touchEdit)}
          nodeDragThreshold={isTouch ? 8 : 0}
          connectionRadius={isTouch ? 40 : 20}
          elementsSelectable
          connectionMode="loose"
          // Kutu seçimi ancak panOnDrag kapalıyken çalışır → "Select" ikisini birlikte çevirir.
          // showTouchBar şartı ZORUNLU: Select açıkken pencere masaüstü genişliğine
          // büyütülürse düğme kaybolur, selectMode true kalır ve pan kalıcı olarak kapanırdı.
          panOnDrag={showTouchBar && selectMode ? false : true}
          selectionOnDrag={isAdmin && (!isTouch || (showTouchBar && selectMode))}
          multiSelectionKeyCode="Shift"
          minZoom={compactCanvas ? 0.15 : undefined}
          maxZoom={compactCanvas ? 3 : undefined}
          fitView
          fitViewOptions={compactCanvas ? { padding: 0.15, minZoom: 0.1 } : undefined}
        >
          <Background color="var(--primary)" gap={25} size={1} style={{ opacity: 0.1 }} />
          {/* 26x26 Controls parmakla kullanılamaz; dokunmatikte yerini 44px araç çubuğu alır */}
          {!showTouchBar && (
            <Controls style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8 }} />
          )}

          {/* Auto Topology Button — dokunmatikte araç çubuğuna taşınır */}
          {isAdmin && !showTouchBar && (
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

          {/* 150x100 MiniMap yatay telefonda tuvalin üçte birini yiyor ve dokunuşları yutuyor */}
          {!compactCanvas && (
            <MiniMap
              nodeColor={minimapNodeColor}
              nodeStrokeWidth={2}
              style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 8, height: 100, width: 150 }}
              maskColor="rgba(0,0,0,0.6)"
            />
          )}
        </ReactFlow>
      </div>

      {/* Menüler tuvalin DIŞINDA duruyor. .context-menu position:fixed olduğu için
          konumları değişmez (tuvalin transform'u yok), ama uzun basmadan sonra gelen
          "tıklamayı yut" koruyucusu (useLongPress -> onClickCapture, tuval sarmalayıcıya
          yayılıyor) menü satırına giden dokunuşu capture fazında yiyemez. */}
      {menu && (
        <TopoMenu
          sheet={showTouchBar}
          short={isShort}
          top={menu.top}
          left={menu.left}
          title={menu.label}
          items={nodeMenuItems}
          onClose={() => setMenu(null)}
        />
      )}

      {/* Çoklu seçim menüsü */}
      {isAdmin && selMenu && (
        <TopoMenu
          sheet={showTouchBar}
          short={isShort}
          top={selMenu.top}
          left={selMenu.left}
          title={`${selMenu.ids.length} selected`}
          popupTitle={`${selMenu.ids.length} selected`}
          items={selMenuItems}
          onClose={() => setSelMenu(null)}
        />
      )}

      {isAdmin && edgeMenu && (
        <TopoMenu
          sheet={showTouchBar}
          short={isShort}
          top={edgeMenu.top}
          left={edgeMenu.left}
          title="Connection"
          items={edgeMenuItems}
          onClose={() => setEdgeMenu(null)}
        />
      )}

      {/* Cihaz Web Arayüzü — backend proxy üzerinden iframe */}
      {webModal && (
        <div className="modal-overlay" onClick={() => setWebModal(null)} onKeyDown={e => { if (e.key === 'Escape') setWebModal(null); }}>
          {/* Telefonda tam ekran sayfa, kısa ekranda kenardan 8px. 85vh iOS'ta URL çubuğu
              olmayan uzun viewport'a göre ölçülüp içeriği kırpıyordu.
              height + maxHeight ikilisi dvh yoksa güvenle vh'ye düşer. */}
          <div onClick={e => e.stopPropagation()} style={
            isPhone
              ? {
                  width: '100%', maxWidth: '100%', height: '100vh', maxHeight: '100dvh',
                  background: 'var(--bg-panel)', border: 'none', borderRadius: 0,
                  display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
                  paddingBottom: 'env(safe-area-inset-bottom)'
                }
              : isShort
                ? {
                    width: 'calc(100vw - 16px)', maxWidth: 'calc(100vw - 16px)',
                    height: 'calc(100vh - 16px)', maxHeight: 'calc(100dvh - 16px)',
                    background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 10,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box'
                  }
                : {
                    width: '85vw', height: '85vh', background: 'var(--bg-panel)',
                    border: '1px solid var(--border-color)', borderRadius: 12,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.6)'
                  }
          }>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
              borderBottom: '1px solid var(--border-color)', flexShrink: 0,
              ...(showTouchBar ? { flexWrap: 'wrap', minWidth: 0, rowGap: 6 } : null)
            }}>
              {/* Kırpma yalnızca dar gövdede: masaüstünde başlık eskisi gibi tam görünür */}
              <strong style={{
                fontSize: '0.9rem',
                ...(showTouchBar ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : null)
              }}>🌐 {webModal.label}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'monospace' }}>{webModal.ip}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: showTouchBar ? 0 : 12 }}>
                {['http', 'https'].map(s => (
                  <button key={s} onClick={() => setWebModal(w => ({ ...w, scheme: s }))}
                    style={{
                      padding: '3px 10px', fontSize: '0.7rem', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border-color)', fontWeight: 600,
                      background: webModal.scheme === s ? 'var(--primary)' : 'transparent',
                      color: webModal.scheme === s ? '#0f172a' : 'var(--text-muted)',
                      ...(showTouchBar ? { minWidth: 56, minHeight: 44, fontSize: '0.8rem', touchAction: 'manipulation' } : null)
                    }}>{s.toUpperCase()}</button>
                ))}
                {/* reloadKey artışı iframe'i remount ederek sayfayı yeniler */}
                <button onClick={() => setWebModal(w => ({ ...w, reloadKey: (w.reloadKey || 0) + 1 }))}
                  title={t('refresh')}
                  aria-label={t('refresh')}
                  style={{
                    padding: '3px 9px', fontSize: '0.85rem', lineHeight: 1, borderRadius: 6, cursor: 'pointer',
                    border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)',
                    ...(showTouchBar ? { minWidth: 44, minHeight: 44, touchAction: 'manipulation' } : null)
                  }}>⟳</button>
              </div>
              <button onClick={() => setWebModal(null)} className="btn btn-ghost" aria-label="Close"
                style={{
                  marginLeft: 'auto', fontSize: '1.3rem', lineHeight: 1, padding: '0 8px',
                  ...(showTouchBar ? { minWidth: 44, minHeight: 44 } : null)
                }}>&times;</button>
            </div>
            <iframe
              key={`${webModal.id}-${webModal.scheme}-${webModal.reloadKey || 0}`}
              src={`${API_BASE}/webproxy/${webModal.id}/${webModal.scheme}/`}
              title={`${webModal.label} Web UI`}
              style={{ flex: 1, minHeight: 0, border: 'none', background: '#fff' }}
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
              {/* autoFocus telefonda odak/scroll zıplamasına yol açıyor → yalnızca farede */}
              <button className="btn btn-primary" onClick={handleAutoDiscover} autoFocus={!showTouchBar}>
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
