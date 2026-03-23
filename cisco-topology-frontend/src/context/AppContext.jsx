import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { authFetch } = useAuth();
  const [rawDevices, setRawDevices] = useState([]);
  const [users, setUsers] = useState([]);
  const [edges, setEdges] = useState([]);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

  // SSH Sessions
  const [sshSessions, setSshSessions] = useState([]);
  const [activeSshTabId, setActiveSshTabId] = useState(null);
  const [terminalHeight, setTerminalHeight] = useState(350);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await authFetch('/topology');
      if (!res || !res.ok) return;
      const data = await res.json();
      setRawDevices(data.switches);
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
          sourceHandle: e.sourceHandle || localHandleMap[e.id]?.sourceHandle || null,
          targetHandle: e.targetHandle || localHandleMap[e.id]?.targetHandle || null,
        }));
      });

      const resU = await authFetch('/users');
      if (resU && resU.ok) setUsers(await resU.json());
    } catch (e) { /* ignore */ }
  }, [authFetch]);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 4000);
    return () => clearInterval(i);
  }, [fetchData]);

  // SSH helpers
  const openSshSession = useCallback((id, label) => {
    setSshSessions(prev => {
      if (prev.find(s => s.id === id)) return prev;
      return [...prev, { id, name: label }];
    });
    setActiveSshTabId(id);
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

  return (
    <AppContext.Provider value={{
      rawDevices, users, edges, setEdges,
      theme, toggleTheme,
      fetchData,
      sshSessions, activeSshTabId, setActiveSshTabId, terminalHeight, setTerminalHeight,
      openSshSession, closeSshSession, closeAllSessions
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
