import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
// Mobil/dokunmatik katman: App.css'ten SONRA yuklenmeli (cascade'de sonuncu olmali)
import './responsive.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { AppProvider } from './context/AppContext.jsx'
import { useAuth } from './context/AuthContext.jsx'
import NativeGate from './native/NativeGate.jsx'
import NativeShell from './native/NativeShell.jsx'
import { isNative } from './native/state.js'

// Paketlenmis mobil uygulamada sayfalar WebView'in yerel sunucusundan gelir;
// derin bir yolu (ornegin /devices/12) yeniden yuklemek orada dosya arayisina
// doner. HashRouter bu sinifi tamamen ortadan kaldirir. Web'de hicbir sey degismez.
const Router = isNative ? HashRouter : BrowserRouter

function Root() {
  return (
    <StrictMode>
      <ErrorBoundary>
        {/* Native: sunucu adresi cozulup ag yamalari kurulana kadar alt agac monte edilmez */}
        <NativeGate>
          <Router>
            <NativeShell />
            <AuthProvider>
              <AppProviderWrapper />
            </AuthProvider>
          </Router>
        </NativeGate>
      </ErrorBoundary>
    </StrictMode>
  )
}

function AppProviderWrapper() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <App />
  return (
    <AppProvider>
      <App />
    </AppProvider>
  )
}

createRoot(document.getElementById('root')).render(<Root />)
