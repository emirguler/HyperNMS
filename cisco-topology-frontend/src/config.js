const raw = import.meta.env.VITE_API_URL || 'http://localhost:4000';
// Remove trailing slash to avoid double slashes in fetch URLs
export const API_BASE = raw.endsWith('/') ? raw.slice(0, -1) : raw;

export const WS_BASE = (() => {
  // Production: API_BASE is a relative path like '/api' — derive WS from window.location
  if (!raw.startsWith('http')) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  // Dev: API_BASE is full URL like 'http://localhost:4000'
  return API_BASE.replace(/^http/, 'ws');
})();
