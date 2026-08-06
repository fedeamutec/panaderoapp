import { useEffect, useState } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import Home from './Pages/Home'
import Invoices from './Pages/Invoices'
import ArcaSettings from './Pages/ArcaSettings'
import Login from './Pages/Login'
import Budgets from './Pages/Budgets'
import Reports from './Pages/Reports'

const THEMES = ['cursor', 'black', 'paper']

function OAuthBridge() {
  useEffect(() => {
    const target = new URL('https://api.panaderoapp.com/api/mercadolibre/callback')
    for (const [key, value] of new URLSearchParams(window.location.search)) target.searchParams.set(key, value)
    window.location.replace(target.toString())
  }, [])

  return <main className="oauth-bridge"><div><strong>Conectando Mercado Libre…</strong><small>Panadero volverá a abrirse automáticamente.</small></div></main>
}

function App() {
  const [authState, setAuthState] = useState({ loading: true, user: null })
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('panadero-theme')
    return THEMES.includes(saved) ? saved : 'cursor'
  })
  const [fontScale, setFontScale] = useState(() => {
    const saved = Number(localStorage.getItem('panadero-font-scale'))
    return Number.isFinite(saved) && saved >= 0.9 && saved <= 1.35 ? saved : 1.08
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('panadero-sidebar-collapsed') === '1')
  const [activeSection, setActiveSection] = useState(() => localStorage.getItem('panadero-section') || 'inicio')

  useEffect(() => {
    let cancelled = false
    fetch('https://api.panaderoapp.com/api/auth/session', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!cancelled) setAuthState({ loading: false, user: response.ok ? payload.user : null })
      })
      .catch(() => {
        if (!cancelled) setAuthState({ loading: false, user: null })
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => localStorage.setItem('panadero-theme', theme), [theme])
  useEffect(() => localStorage.setItem('panadero-font-scale', String(fontScale)), [fontScale])
  useEffect(() => localStorage.setItem('panadero-section', activeSection), [activeSection])
  useEffect(() => localStorage.setItem('panadero-sidebar-collapsed', sidebarCollapsed ? '1' : '0'), [sidebarCollapsed])

  if (window.location.pathname === '/oauth/callback') return <OAuthBridge />
  if (authState.loading) return <main className="auth-loading"><strong>Panadero</strong><small>Verificando sesión…</small></main>

  const previewMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1'
  if (!authState.user && !previewMode) return <Login onLogin={(user) => setAuthState({ loading: false, user })} />

  const effectiveUser = authState.user || { name: 'Fede Amurin', role: 'Administrador', email: 'preview@local' }

  const logout = async () => {
    try {
      await fetch('https://api.panaderoapp.com/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      setAuthState({ loading: false, user: null })
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-theme={theme} style={{ '--font-scale': fontScale }}>
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        salesCount={Number(localStorage.getItem('panadero-total-sales') || 0)}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((current) => !current)}
        theme={theme}
        onThemeChange={setTheme}
        fontScale={fontScale}
        onFontScaleChange={setFontScale}
        user={effectiveUser}
        onLogout={logout}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
      {activeSection === 'presupuestos' ? (
        <Budgets />
      ) : activeSection === 'facturas' ? (
        <Invoices onNavigateToSales={() => setActiveSection('ventas')} />
      ) : activeSection === 'arca' ? (
        <ArcaSettings />
      ) : activeSection === 'reportes' ? (
        <Reports />
      ) : (
        <Home />
      )}
    </div>
  )
}

export default App
