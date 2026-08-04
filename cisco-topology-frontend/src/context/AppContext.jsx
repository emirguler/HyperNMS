import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { API_BASE, WS_BASE } from '../config';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { authFetch, isAdmin, isAuthenticated } = useAuth();
  const [rawDevices, setRawDevices] = useState([]);
  const [users, setUsers] = useState([]);
  const [edges, setEdges] = useState([]);
  const [topoTabs, setTopoTabs] = useState([{ id: 'main', name: 'Main Topology' }]);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  // Genel (cihaz geneli) ayarlar — sistem geneli; admin ayarlar, herkes okur
  const [general, setGeneral] = useState({ cometAnimation: true });

  // SSH Sessions
  const [sshSessions, setSshSessions] = useState([]);
  const [activeSshTabId, setActiveSshTabId] = useState(null);
  const [terminalHeight, setTerminalHeight] = useState(350);

  // Bildirimler — tek kaynak: hem zil hem dashboard bloğu bunu okur (tek WebSocket)
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const markNotificationsRead = useCallback(() => setUnreadCount(0), []);

  useEffect(() => {
    if (!isAuthenticated) { setNotifications([]); setUnreadCount(0); return; }
    let ws, reconnectTimer, closed = false;

    // Sadece geçerli bir dizi geldiğinde uygula — başarısız/404 REST boş listeyi ezmesin
    const applyHistory = (list) => {
      if (!Array.isArray(list)) return;
      setNotifications(list);
      setUnreadCount(list.filter(n => !n.read).length);
    };

    // İlk yükleme (en yeni önce) — REST başarısızsa null döner, mevcut listeyi ezmez
    fetch(`${API_BASE}/notifications`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(applyHistory)
      .catch(() => {});

    // Canlı akış — backend restart olunca WS kopar; otomatik yeniden bağlan
    const connect = () => {
      ws = new WebSocket(`${WS_BASE}/ws/notifications`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'notification') {
            setNotifications(prev => [msg.data, ...prev].slice(0, 50));
            setUnreadCount(prev => prev + 1);
          } else if (msg.type === 'history') {
            applyHistory([...msg.data].reverse()); // her (re)bağlanışta 1 günlük geçmişi geri yükler
          }
        } catch (e) { /* ignore */ }
      };
      ws.onclose = () => { if (!closed) reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
    };
    connect();

    return () => { closed = true; clearTimeout(reconnectTimer); try { ws && ws.close(); } catch (e) { /* ignore */ } };
  }, [isAuthenticated]);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Genel ayarları giriş yapınca çek (topoloji comet'i buna göre çizilir)
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    authFetch('/settings/general')
      .then(r => (r && r.ok ? r.json() : null))
      .then(d => { if (active && d) setGeneral(d); })
      .catch(() => { /* ignore */ });
    return () => { active = false; };
  }, [isAuthenticated, authFetch]);

  // Comet animasyonu kapalıysa body'ye sınıf ekle → CSS .cable-comet'i gizler (tüm bağlantılar)
  useEffect(() => {
    document.body.classList.toggle('comet-off', general.cometAnimation === false);
  }, [general]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await authFetch('/topology');
      if (!res || !res.ok) return;
      const data = await res.json();
      setRawDevices(data.switches);
      if (data.tabs) setTopoTabs(data.tabs);
      // Edge'leri merge et — yerel sourceHandle/targetHandle bilgisini koru
      setEdges(prev => {
        const localHandleMap = {};
        prev.forEach(e => {
          if (e.sourceHandle || e.targetHandle) {
            localHandleMap[e.id] = { sourceHandle: e.sourceHandle, targetHandle: e.targetHandle };
          }
        });
        return data.edges.map(e => ({
          ...e,
          sourceHandle: e.sourceHandle || localHandleMap[e.id]?.sourceHandle || 'bottom',
          targetHandle: e.targetHandle || localHandleMap[e.id]?.targetHandle || 'top',
        }));
      });
    } catch (e) { /* ignore */ }
  }, [authFetch]);

  // Kullanıcı listesi ayrı ve talebe göre çekilir — 4sn'lik topoloji poll'ünden çıkarıldı
  // (nadiren değişir; ayrıca admin olmayanda /users 403 döner)
  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await authFetch('/users');
      if (res && res.ok) setUsers(await res.json());
    } catch (e) { /* ignore */ }
  }, [authFetch, isAdmin]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Topoloji poll'ü: sekme gizliyken duraklat (arka planda gereksiz istek/render yok)
  useEffect(() => {
    let timer = null;
    const start = () => { if (!timer) timer = setInterval(fetchData, 4000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    fetchData();
    start();
    const onVis = () => {
      if (document.hidden) stop();
      else { fetchData(); start(); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchData]);

  // SSH helpers
  const openSshSession = useCallback((id, label) => {
    const sessionId = `${id}-ssh`;
    setSshSessions(prev => {
      if (prev.find(s => s.id === sessionId)) return prev;
      return [...prev, { id: sessionId, deviceId: id, name: label }];
    });
    setActiveSshTabId(sessionId);
  }, []);

  const closeSshSession = useCallback((id) => {
    setSshSessions(prev => {
      const newSessions = prev.filter(s => s.id !== id);
      if (activeSshTabId === id) {
        setActiveSshTabId(newSessions.length > 0 ? newSessions[newSessions.length - 1].id : null);
      }
      return newSessions;
    });
  }, [activeSshTabId]);

  const closeAllSessions = useCallback(() => {
    setSshSessions([]);
    setActiveSshTabId(null);
  }, []);

  // Context value'yu memoize et — alakasız provider render'ları (theme/ssh) value
  // kimliğini değiştirip tüm tüketicileri yeniden render etmesin
  const value = useMemo(() => ({
    rawDevices, users, edges, setEdges,
    topoTabs, setTopoTabs,
    theme, toggleTheme,
    general, setGeneral,
    fetchData, fetchUsers,
    sshSessions, activeSshTabId, setActiveSshTabId, terminalHeight, setTerminalHeight,
    openSshSession, closeSshSession, closeAllSessions,
    notifications, unreadCount, markNotificationsRead
  }), [
    rawDevices, users, edges, setEdges, topoTabs, setTopoTabs, theme, toggleTheme,
    general, setGeneral,
    fetchData, fetchUsers, sshSessions, activeSshTabId, setActiveSshTabId,
    terminalHeight, setTerminalHeight, openSshSession, closeSshSession, closeAllSessions,
    notifications, unreadCount, markNotificationsRead
  ]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
