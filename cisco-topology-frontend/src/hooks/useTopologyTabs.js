import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export function useTopologyTabs() {
  const { topoTabs: tabs, setTopoTabs } = useApp();
  const { authFetch } = useAuth();

  const addTab = async (name) => {
    try {
      const res = await authFetch('/topology/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res && res.ok) {
        const tab = await res.json();
        setTopoTabs(prev => [...prev, tab]);
        return tab.id;
      }
    } catch (e) { console.error('Failed to add tab:', e); }
    return null;
  };

  const removeTab = async (id) => {
    if (id === 'main') return;
    try {
      const res = await authFetch(`/topology/tabs/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        setTopoTabs(prev => prev.filter(t => t.id !== id));
      }
    } catch (e) { console.error('Failed to remove tab:', e); }
  };

  const renameTab = async (id, name) => {
    // Optimistic update first
    setTopoTabs(prev => prev.map(t => t.id === id ? { ...t, name } : t));
    try {
      const res = await authFetch(`/topology/tabs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res || !res.ok) {
        console.error('Rename failed, reverting');
        // Revert on failure
        const tabsRes = await authFetch('/topology/tabs');
        if (tabsRes && tabsRes.ok) setTopoTabs(await tabsRes.json());
      }
    } catch (e) { console.error('Failed to rename tab:', e); }
  };

  // Sekme sırasını değiştir. Sıra backend'de kalıcı olmazsa 4sn'lik /topology poll'ü
  // eski sırayı geri getireceği için sunucuya yazmak şart.
  const reorderTabs = async (ids) => {
    const prevOrder = tabs;
    // İyimser: sürükleme bırakılır bırakılmaz yeni sıra görünsün
    setTopoTabs(prev => {
      const byId = new Map(prev.map(t => [t.id, t]));
      const next = ids.map(id => byId.get(id)).filter(Boolean);
      prev.forEach(t => { if (!ids.includes(t.id)) next.push(t); });
      return next;
    });
    try {
      const res = await authFetch('/topology/tabs/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids })
      });
      if (!res || !res.ok) setTopoTabs(prevOrder); // başarısızsa geri al
    } catch (e) {
      console.error('Failed to reorder tabs:', e);
      setTopoTabs(prevOrder);
    }
  };

  return { tabs, addTab, removeTab, renameTab, reorderTabs };
}

// For non-hook contexts (e.g. BulkImportModal)
export function getTopologyTabs() {
  return [{ id: 'main', name: 'Main Topology' }]; // Fallback, real data from context
}
