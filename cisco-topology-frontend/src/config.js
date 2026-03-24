const raw = import.meta.env.VITE_API_URL || 'http://localhost:4000';
// Remove trailing slash to avoid double slashes in fetch URLs
export const API_BASE = raw.endsWith('/') ? raw.slice(0, -1) : raw;

export const WS_BASE = (() => {
  if (raw === '/' || raw === '' || API_BASE === '') {
    // Production: same origin, derive from window.location
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return API_BASE.replace(/^http/, 'ws');
})();
