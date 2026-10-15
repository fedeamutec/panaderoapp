import { useEffect, useState } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import Home from './Pages/Home'
import Invoices from './Pages/Invoices'
import ArcaSettings from './Pages/ArcaSettings'
import Login from './Pages/Login'
import Budgets from './Pages/Budgets'
import Reports from './Pages/Reports'
import Dashboard from './Pages/Dashboard'
import {
  createLocalSnapshot,
  downloadLocalBackup,
  getLatestLocalSnapshot,
  restoreLatestLocalSnapshot,
  restoreLocalBackupFile,
} from './utils/localBackup'

const THEMES = ['cursor', 'black', 'paper']
const LAST_USER_KEY = 'panadero-last-authenticated-user'
const OFFLINE_SECTIONS = new Set(['inicio', 'presupuestos'])

function readCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null')
  } catch {
    return null
  }
}

function standaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function OAuthBridge() {
  useEffect(() => {
    const target = new URL('https://api.panaderoapp.com/api/mercadolibre/callback')
    for (const [key, value] of new URLSearchParams(window.location.search)) target.searchParams.set(key, value)
    window.location.replace(target.toString())
  }, [])

  return <main className="oauth-bridge"><div><strong>Conectando Mercado Libre…</strong><small>Panadero volverá a abrirse automáticamente.</small></div></main>
}

function App() {
  const [authState, setAuthState] = useState({ loading: true, user: null, offline: false })
  const [online, setOnline] = useState(() => navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(standaloneMode)
  const [lastBackupAt, setLastBackupAt] = useState(null)
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
  const [activeSection, setActiveSection] = useState(() => {
    const saved = localStorage.getItem('panadero-section') || 'inicio'
    return navigator.onLine || OFFLINE_SECTIONS.has(saved) ? saved : 'presupuestos'
  })
  const [invoiceView, setInvoiceView] = useState('new')

  useEffect(() => {
    let cancelled = false
    const cachedUser = readCachedUser()
    const loadSession = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setAuthState({ loading: false, user: cachedUser, offline: Boolean(cachedUser) })
        return
      }

      try {
        const response = await fetch('https://api.panaderoapp.com/api/auth/session', { credentials: 'include' })
        const payload = await response.json().catch(() => ({}))
        if (response.ok && payload.user) {
          localStorage.setItem(LAST_USER_KEY, JSON.stringify(payload.user))
          if (!cancelled) setAuthState({ loading: false, user: payload.user, offline: false })
          return
        }
        if (response.status >= 500 && cachedUser) {
          if (!cancelled) setAuthState({ loading: false, user: cachedUser, offline: true })
          return
        }
        if (response.status === 401) localStorage.removeItem(LAST_USER_KEY)
        if (!cancelled) setAuthState({ loading: false, user: null, offline: false })
      } catch {
        if (!cancelled) setAuthState({ loading: false, user: cachedUser, offline: Boolean(cachedUser) })
      }
    }
    loadSession()
    return () => { cancelled = true }
  }, [online])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => {
      setOnline(false)
      setActiveSection((current) => OFFLINE_SECTIONS.has(current) ? current : 'presupuestos')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const capturePrompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const markInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', capturePrompt)
    window.addEventListener('appinstalled', markInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt)
      window.removeEventListener('appinstalled', markInstalled)
    }
  }, [])

  useEffect(() => {
    if (!authState.user) return undefined
    let active = true
    let dataTimer = null

    const saveSnapshot = (reason = 'automatic') => {
      window.clearTimeout(dataTimer)
      dataTimer = window.setTimeout(() => {
        createLocalSnapshot(reason)
          .then((snapshot) => { if (active) setLastBackupAt(snapshot.createdAt) })
          .catch((error) => console.warn('No se pudo actualizar el respaldo local:', error))
      }, reason === 'data-change' ? 350 : 0)
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') saveSnapshot('background') }
    const onDataChange = () => saveSnapshot('data-change')

    getLatestLocalSnapshot().then((snapshot) => {
      if (active && snapshot?.createdAt) setLastBackupAt(snapshot.createdAt)
    }).catch(() => {})
    saveSnapshot('startup')
    const interval = window.setInterval(() => saveSnapshot('automatic'), 60_000)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('panadero:data-changed', onDataChange)
    return () => {
      active = false
      window.clearInterval(interval)
      window.clearTimeout(dataTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('panadero:data-changed', onDataChange)
    }
  }, [authState.user])

  useEffect(() => localStorage.setItem('panadero-theme', theme), [theme])
  useEffect(() => localStorage.setItem('panadero-font-scale', String(fontScale)), [fontScale])
  useEffect(() => localStorage.setItem('panadero-section', activeSection), [activeSection])
  useEffect(() => localStorage.setItem('panadero-sidebar-collapsed', sidebarCollapsed ? '1' : '0'), [sidebarCollapsed])

  const offlineMode = !online || authState.offline
  const visibleSection = offlineMode && !OFFLINE_SECTIONS.has(activeSection) ? 'presupuestos' : activeSection

  if (window.location.pathname === '/oauth/callback') return <OAuthBridge />
  if (authState.loading) return <main className="auth-loading"><strong>Panadero</strong><small>Verificando sesión…</small></main>

  const previewMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1'
  if (!authState.user && !previewMode) return <Login onLogin={(user) => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(user))
    setAuthState({ loading: false, user, offline: false })
  }} />

  const effectiveUser = authState.user || { name: 'Fede Amurin', role: 'Administrador', email: 'preview@local' }

  const logout = async () => {
    try {
      if (online) await fetch('https://api.panaderoapp.com/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      localStorage.removeItem(LAST_USER_KEY)
      setAuthState({ loading: false, user: null, offline: false })
    }
  }

  const navigate = (section) => {
    if (offlineMode && !OFFLINE_SECTIONS.has(section)) return
    setActiveSection(section)
  }

  const installApplication = async () => {
    if (installed) return
    if (installPrompt) {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') setInstallPrompt(null)
      return
    }
    const appleDevice = /Mac|iPhone|iPad/.test(navigator.platform)
    window.alert(appleDevice
      ? 'En Safari, abrí Archivo y elegí “Agregar al Dock”. En Chrome, usá el icono Instalar de la barra de direcciones.'
      : 'En Chrome o Edge, abrí el menú del navegador y elegí “Instalar Panadero”.')
  }

  const exportBackup = async () => {
    try {
      const snapshot = await downloadLocalBackup()
      setLastBackupAt(snapshot.createdAt)
    } catch (error) {
      window.alert(error.message)
    }
  }

  const importBackup = async (file) => {
    if (!file || !window.confirm('¿Restaurar este respaldo? Los datos locales actuales de Presupuestos serán reemplazados.')) return
    try {
      await restoreLocalBackupFile(file)
      window.alert('Respaldo restaurado. Panadero se volverá a abrir para aplicar los datos.')
      window.location.reload()
    } catch (error) {
      window.alert(error.message)
    }
  }

  const restoreAutomaticBackup = async () => {
    if (!window.confirm('¿Restaurar la última copia automática guardada en esta computadora?')) return
    try {
      await restoreLatestLocalSnapshot()
      window.alert('Copia automática restaurada. Panadero se volverá a abrir.')
      window.location.reload()
    } catch (error) {
      window.alert(error.message)
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-theme={theme} data-section={visibleSection} data-offline={offlineMode ? 'true' : 'false'} style={{ '--font-scale': fontScale }}>
      <Sidebar
        activeSection={visibleSection}
        onSectionChange={navigate}
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
        offline={offlineMode}
        installed={installed}
        canInstall={Boolean(installPrompt)}
        onInstall={installApplication}
        lastBackupAt={lastBackupAt}
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
        onRestoreAutomaticBackup={restoreAutomaticBackup}
      />
      {offlineMode && <div className="offline-ribbon" role="status"><strong>Modo sin conexión</strong><span>Presupuestos disponibles · Facturación y ARCA pausadas</span></div>}
      {visibleSection === 'inicio' ? (
        <Dashboard onNavigate={navigate} />
      ) : visibleSection === 'presupuestos' ? (
        <Budgets key="presupuesto" online={!offlineMode} />
      ) : visibleSection === 'facturas' ? (
        invoiceView === 'new'
          ? <Budgets key="factura" mode="invoice" online={!offlineMode} onShowInvoiceHistory={() => setInvoiceView('history')} />
          : <Invoices onNavigateToSales={() => setActiveSection('ventas')} onCreateInvoice={() => setInvoiceView('new')} />
      ) : visibleSection === 'arca' ? (
        <ArcaSettings />
      ) : visibleSection === 'reportes' ? (
        <Reports />
      ) : (
        <Home />
      )}
    </div>
  )
}

export default App
