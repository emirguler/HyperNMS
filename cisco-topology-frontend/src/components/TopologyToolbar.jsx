import { useState } from 'react';
import { t } from '../i18n';
import { useViewport } from '../hooks/useViewport';

/* NOT: Bu bilesen su an hicbir yerden import EDILMIYOR ve .topology-toolbar /
   .topo-btn / .topo-btn-group / .topology-filter-panel siniflarinin CSS'i yok.
   Bu yuzden tum olculer inline verildi - baglandigi gun mobilde de calisir,
   ayrica inline degerler bir media query ile ezilemeyecegi icin tersi mumkun degildi. */

const BAR = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
  padding: '6px 8px', position: 'relative',
};
const GROUP = { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minWidth: 0 };

// Emoji-only dugmeler yalnizca title= ile anlam tasiyordu; dokunmatikte tooltip yok.
// Bu yuzden her dugme aria-label alir ve 44x44 hedef boyuna cikar.
const btnStyle = (active, touch) => ({
  minWidth: touch ? 44 : 32,
  minHeight: touch ? 44 : 28,
  padding: touch ? '0 12px' : '0 8px',
  borderRadius: 8,
  border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
  background: active ? 'var(--primary-light)' : 'transparent',
  color: active ? 'var(--primary)' : 'var(--text-muted)',
  fontSize: touch ? '0.85rem' : '0.8rem',
  fontWeight: 600, lineHeight: 1, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  flexShrink: 0, touchAction: 'manipulation',
});

export default function TopologyToolbar({
  onAutoLayout, onExportPng, onFitView, onToggleSnap,
  snapEnabled, searchQuery, onSearch, statusFilter, onStatusFilter,
  tagFilter, onTagFilter, allTags, layoutDirection, onLayoutDirection,
  activeLayer, onLayerChange
}) {
  const [showFilters, setShowFilters] = useState(false);
  const { isPhone, isTouch } = useViewport();
  const compact = isPhone || isTouch;
  const btn = (active) => btnStyle(active, compact);

  return (
    <div className="topology-toolbar" style={BAR}>
      {/* Sol: Arama — telefonda sabit 180px yerine satırın tamamını kullanır */}
      <div style={{ ...GROUP, flex: compact ? '1 1 100%' : '0 0 auto' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input
            className="modern-input"
            type="search"
            placeholder="Search device..."
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            // 12px yazı tipi iOS'ta odakta sayfayı zoomlar ve geri dönmez → 16px
            style={{
              padding: '6px 10px 6px 30px',
              fontSize: compact ? 16 : '0.75rem',
              width: compact ? '100%' : 180,
              minWidth: 0,
              minHeight: compact ? 44 : 32,
              boxSizing: 'border-box',
            }}
          />
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', pointerEvents: 'none', opacity: 0.5 }}>🔍</span>
        </div>

        <button className="topo-btn" style={btn(showFilters)} onClick={() => setShowFilters(!showFilters)}
          title="Filters" aria-label="Filters">🎛️</button>
      </div>

      {/* Orta: Layout ve View */}
      <div style={GROUP}>
        <div className="topo-btn-group" style={GROUP}>
          <button className={`topo-btn ${layoutDirection === 'TB' ? 'active' : ''}`} style={btn(layoutDirection === 'TB')}
            onClick={() => onLayoutDirection('TB')} title="Top-Bottom" aria-label="Top to bottom layout">↓</button>
          <button className={`topo-btn ${layoutDirection === 'LR' ? 'active' : ''}`} style={btn(layoutDirection === 'LR')}
            onClick={() => onLayoutDirection('LR')} title="Left-Right" aria-label="Left to right layout">→</button>
        </div>
        <button className="topo-btn" style={btn(false)} onClick={onAutoLayout} title="Auto Layout" aria-label="Auto layout">⚡ Layout</button>
        <button className="topo-btn" style={btn(false)} onClick={onFitView} title="Fit View" aria-label="Fit view">🔲 Fit</button>
        <button className={`topo-btn ${snapEnabled ? 'active' : ''}`} style={btn(snapEnabled)}
          onClick={onToggleSnap} title="Snap to Grid" aria-label="Snap to grid">📐 Snap</button>
      </div>

      {/* Sağ: Katmanlar ve Export */}
      <div style={GROUP}>
        <div className="topo-btn-group" style={GROUP}>
          {['status', 'latency', 'traffic'].map(layer => (
            <button key={layer} className={`topo-btn ${activeLayer === layer ? 'active' : ''}`} style={btn(activeLayer === layer)}
              onClick={() => onLayerChange(layer)} title={`${layer} layer`} aria-label={`${layer} layer`}>
              {layer === 'status' ? '🟢' : layer === 'latency' ? '⏱️' : '📊'}
            </button>
          ))}
        </div>
        <button className="topo-btn" style={btn(false)} onClick={onExportPng} title="Export PNG" aria-label="Export PNG">📥 PNG</button>
      </div>

      {/* Filtre paneli — telefonda tam genişlik, kendi içinde kayan panel */}
      {showFilters && (
        <div className="topology-filter-panel" style={{
          position: 'absolute', top: '100%', left: 8, zIndex: 20,
          width: compact ? 'calc(100% - 16px)' : 260,
          maxHeight: '60vh', overflowY: 'auto', overscrollBehavior: 'contain',
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
          borderRadius: 10, padding: 12, boxSizing: 'border-box',
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
        }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Status</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['all', 'UP', 'DOWN'].map(s => (
                <button key={s} className={`topo-btn ${statusFilter === s ? 'active' : ''}`}
                  onClick={() => onStatusFilter(s)} style={btn(statusFilter === s)}>{s}</button>
              ))}
            </div>
          </div>
          {allTags.length > 0 && (
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Tags</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button className={`topo-btn ${tagFilter === '' ? 'active' : ''}`}
                  onClick={() => onTagFilter('')} style={btn(tagFilter === '')}>All</button>
                {allTags.map(tag => (
                  <button key={tag} className={`topo-btn ${tagFilter === tag ? 'active' : ''}`}
                    onClick={() => onTagFilter(tag)} style={btn(tagFilter === tag)}>{tag}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
