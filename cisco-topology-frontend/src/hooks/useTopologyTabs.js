import { useState } from 'react';

const DEFAULT_TABS = [{ id: 'main', name: 'Main Topology' }];

function loadTabs() {
  try {
    const saved = localStorage.getItem('topologyTabs');
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_TABS;
}

export function getTopologyTabs() {
  return loadTabs();
}

export function useTopologyTabs() {
  const [tabs, setTabs] = useState(loadTabs);

  const saveTabs = (newTabs) => {
    setTabs(newTabs);
    localStorage.setItem('topologyTabs', JSON.stringify(newTabs));
  };

  const addTab = (name) => {
    const id = 'tab-' + Date.now();
    saveTabs([...tabs, { id, name }]);
    return id;
  };

  const removeTab = (id) => {
    if (id === 'main') return;
    saveTabs(tabs.filter(t => t.id !== id));
  };

  const renameTab = (id, name) => {
    saveTabs(tabs.map(t => t.id === id ? { ...t, name } : t));
  };

  return { tabs, addTab, removeTab, renameTab };
}
