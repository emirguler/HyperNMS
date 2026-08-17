import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
// Mobil/dokunmatik katman: App.css'ten SONRA yuklenmeli (cascade'de sonuncu olmali)
import './responsive.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { AppProvider } from './context/AppContext.jsx'
import { useAuth } from './context/AuthContext.jsx'

function Root() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <AppProviderWrapper />
          </AuthProvider>
        </BrowserRouter>
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
