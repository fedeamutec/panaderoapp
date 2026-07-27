import { useEffect, useState } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import Home from './Pages/Home'
import Invoices from './Pages/Invoices'

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
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('panadero-theme')
    return THEMES.includes(saved) ? saved : 'cursor'
  })
  const [fontScale, setFontScale] = useState(() => {
    const saved = Number(localStorage.getItem('panadero-font-scale'))
    return Number.isFinite(saved) && saved >= 0.9 && saved <= 1.35 ? saved : 1.08
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeSection, setActiveSection] = useState(() => localStorage.getItem('panadero-section') || 'ventas')

  useEffect(() => localStorage.setItem('panadero-theme', theme), [theme])
  useEffect(() => localStorage.setItem('panadero-font-scale', String(fontScale)), [fontScale])
  useEffect(() => localStorage.setItem('panadero-section', activeSection), [activeSection])

  if (window.location.pathname === '/oauth/callback') return <OAuthBridge />

  return (
    <div className="app-shell" data-theme={theme} style={{ '--font-scale': fontScale }}>
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
      />
      {activeSection === 'facturas' ? <Invoices /> : <Home />}
    </div>
  )
}

export default App
