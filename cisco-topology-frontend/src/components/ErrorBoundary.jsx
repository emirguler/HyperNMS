import { Component } from 'react';

// Sinif bilesende hook kullanilamiyor; dvh destegi modul seviyesinde bir kez
// olculup vh'ye dusuluyor (inline stilde ayni ozellik iki kez yazilamaz).
const VH_100 = (typeof window !== 'undefined' && window.CSS && typeof window.CSS.supports === 'function'
  && window.CSS.supports('height', '100dvh')) ? '100dvh' : '100vh';

// "Dar govde" sorgusu: responsive.css bolum 08/13 ile birebir ayni esik.
// Sinif bilesende hook yok; hata ekrani yeniden boyutlandirmaya tepki vermek
// zorunda olmadigi icin render aninda bir kez okumak yeterli.
const COMPACT_QUERY = '(max-width: 768px), (max-height: 500px)';
function isCompactViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(COMPACT_QUERY).matches;
  } catch {
    return false;
  }
}

// Dikey ortalama, justify-content yerine auto margin ile yapiliyor:
// ikisi de bosluk varken ayni sonucu verir, ama tastiginda auto margin 0'a
// duser ve icerik yukaridan kirpilmadan kaydirilabilir olur.
const wrapperBaseStyle = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  minHeight: VH_100, height: 'auto', overflowY: 'auto',
  background: 'var(--bg-dark)', color: 'var(--text-main)',
  boxSizing: 'border-box', textAlign: 'center'
};

// Masaustu: eski 40px dolgu BIREBIR korunuyor. vh/vw tabanli clamp kullanilmadi,
// cunku 1366x768 gibi kisa masaustu pencerelerde 40px'in altina duserdi.
const wrapperStyle = { ...wrapperBaseStyle, padding: 40 };
const wrapperStyleCompact = { ...wrapperBaseStyle, padding: '16px' };

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={isCompactViewport() ? wrapperStyleCompact : wrapperStyle}>
          <div style={{ fontSize: '4rem', marginTop: 'auto', marginBottom: 16, opacity: 0.3 }}>!</div>
          <h2 style={{ margin: '0 0 8px', color: 'var(--danger)' }}>Unexpected Error</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 'min(400px, 100%)', overflowWrap: 'anywhere' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            className="rw-tap"
            type="button"
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: 20, marginBottom: 'auto', padding: '12px 24px', background: 'var(--primary)',
              color: '#0f172a', border: 'none', borderRadius: 8, cursor: 'pointer',
              fontWeight: 600, fontSize: '0.9rem', touchAction: 'manipulation'
            }}
          >
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
