import { useState } from 'react';
import { t } from '../i18n';

export default function TopologyToolbar({
  onAutoLayout, onExportPng, onFitView, onToggleSnap,
  snapEnabled, searchQuery, onSearch, statusFilter, onStatusFilter,
  tagFilter, onTagFilter, allTags, layoutDirection, onLayoutDirection,
  activeLayer, onLayerChange
}) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="topology-toolbar">
      {/* Sol: Arama */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ position: 'relative' }}>
          <input
            className="modern-input"
            placeholder="Search device..."
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
            style={{ padding: '6px 10px 6px 30px', fontSize: '0.75rem', width: 180, height: 32 }}
          />
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', pointerEvents: 'none', opacity: 0.5 }}>🔍</span>
        </div>

        <button className="topo-btn" onClick={() => setShowFilters(!showFilters)} title="Filters">
          🎛️
        </button>
      </div>

      {/* Orta: Layout ve View */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div className="topo-btn-group">
          <button className={`topo-btn ${layoutDirection === 'TB' ? 'active' : ''}`} onClick={() => onLayoutDirection('TB')} title="Top-Bottom">↓</button>
          <button className={`topo-btn ${layoutDirection === 'LR' ? 'active' : ''}`} onClick={() => onLayoutDirection('LR')} title="Left-Right">→</button>
        </div>
        <button className="topo-btn" onClick={onAutoLayout} title="Auto Layout">⚡ Layout</button>
        <button className="topo-btn" onClick={onFitView} title="Fit View">🔲</button>
        <button className={`topo-btn ${snapEnabled ? 'active' : ''}`} onClick={onToggleSnap} title="Snap to Grid">📐</button>
      </div>

      {/* Sağ: Katmanlar ve Export */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div className="topo-btn-group">
          {['status', 'latency', 'traffic'].map(layer => (
            <button key={layer} className={`topo-btn ${activeLayer === layer ? 'active' : ''}`}
              onClick={() => onLayerChange(layer)} title={`${layer} layer`}>
              {layer === 'status' ? '🟢' : layer === 'latency' ? '⏱️' : '📊'}
            </button>
          ))}
        </div>
        <button className="topo-btn" onClick={onExportPng} title="Export PNG">📥 PNG</button>
      </div>

      {/* Filtre paneli */}
      {showFilters && (
        <div className="topology-filter-panel">
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Status</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {['all', 'UP', 'DOWN'].map(s => (
                <button key={s} className={`topo-btn ${statusFilter === s ? 'active' : ''}`}
                  onClick={() => onStatusFilter(s)} style={{ fontSize: '0.65rem' }}>{s}</button>
              ))}
            </div>
          </div>
          {allTags.length > 0 && (
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Tags</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button className={`topo-btn ${tagFilter === '' ? 'active' : ''}`}
                  onClick={() => onTagFilter('')} style={{ fontSize: '0.65rem' }}>All</button>
                {allTags.map(tag => (
                  <button key={tag} className={`topo-btn ${tagFilter === tag ? 'active' : ''}`}
                    onClick={() => onTagFilter(tag)} style={{ fontSize: '0.65rem' }}>{tag}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
