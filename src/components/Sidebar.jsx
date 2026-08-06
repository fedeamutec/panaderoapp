function Icon({ name }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  const icons = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>,
    sales: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    invoices: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></>,
    budget: <><path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4M8 11h8M8 15h5"/></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/></>,
    arca: <><rect x="4" y="3" width="16" height="18" rx="4"/><path d="m8.5 17 3.5-10 3.5 10"/><path d="M9.8 13h4.4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  }
  return <svg {...common}>{icons[name]}</svg>
}

const mainItems = [
  { icon: 'home', label: 'Inicio', section: 'inicio' },
  { icon: 'sales', label: 'Mercado Libre', section: 'ventas', accent: 'mercadolibre' },
  { icon: 'budget', label: 'Presupuesto', section: 'presupuestos', accent: 'presupuesto' },
  { icon: 'invoices', label: 'Facturas', section: 'facturas' },
  { icon: 'arca', label: 'ARCA', section: 'arca', accent: 'arca' },
]

const secondaryItems = [
  { icon: 'reports', label: 'Reportes', section: 'reportes' },
]

const themeLabels = { cursor: 'Cursor', black: 'Black', paper: 'Paper' }

function Sidebar({ activeSection, onSectionChange, salesCount = 0, settingsOpen, onToggleSettings, theme, onThemeChange, fontScale, onFontScaleChange, user, onLogout, collapsed, onToggleCollapsed }) {
  const decreaseFont = () => onFontScaleChange((current) => Math.max(0.9, Number((current - 0.05).toFixed(2))))
  const increaseFont = () => onFontScaleChange((current) => Math.min(1.35, Number((current + 0.05).toFixed(2))))

  const renderItem = ({ icon, label, section, accent }) => (
    <button
      className={`sidebar-item ${accent ? `sidebar-item-${accent}` : ''} ${activeSection === section ? 'active' : ''}`}
      type="button"
      key={label}
      onClick={() => onSectionChange(section)}
    >
      <span className="sidebar-icon"><Icon name={icon}/></span>
      <span>{label}</span>
      {label === 'Mercado Libre' && <small className="nav-count">{salesCount}</small>}
    </button>
  )

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-topline">
        <div className="sidebar-brand"><div><strong>Panadero</strong><small>Facturación inteligente</small></div></div>
        <button className="sidebar-collapse-button" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'} title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}>{collapsed ? '›' : '‹'}</button>
      </div>

      <nav className="sidebar-navigation" aria-label="Navegación principal">
        <span className="nav-label">Espacio de trabajo</span>
        {mainItems.map(renderItem)}

        <span className="nav-label nav-label-spaced">Herramientas</span>
        {secondaryItems.map(renderItem)}

        <button className={`sidebar-item ${settingsOpen ? 'active' : ''}`} type="button" onClick={onToggleSettings}>
          <span className="sidebar-icon"><Icon name="settings"/></span>
          <span>Configuración</span>
        </button>
      </nav>

      {settingsOpen && <section className="appearance-panel" aria-label="Apariencia"><div className="appearance-heading"><div><strong>Apariencia</strong><small>Se guarda automáticamente</small></div><button type="button" onClick={onToggleSettings} aria-label="Cerrar">×</button></div><div className="appearance-group"><span className="appearance-label">Tema</span><div className="theme-options">{Object.keys(themeLabels).map((name) => <button key={name} type="button" className={`theme-option ${theme === name ? 'selected' : ''}`} onClick={() => onThemeChange(name)}><span className={`theme-preview ${name}`} aria-hidden="true"/><span>{themeLabels[name]}</span><span className="theme-check">{theme === name ? '●' : '○'}</span></button>)}</div></div><div className="appearance-group"><div className="font-size-heading"><span className="appearance-label">Tamaño de texto</span><strong>{Math.round(fontScale * 100)}%</strong></div><div className="font-size-controls"><button type="button" onClick={decreaseFont}>A−</button><button type="button" className="font-reset" onClick={() => onFontScaleChange(1.08)}>Restablecer</button><button type="button" onClick={increaseFont}>A+</button></div></div></section>}

      <div className="sidebar-footer"><div className="profile-card"><span className="profile-avatar">FA</span><span className="profile-copy"><strong>{user?.name || 'Fede Amurin'}</strong><small>{user?.role || 'Administrador'}</small></span><button className="logout-button" type="button" onClick={onLogout}>Salir</button></div></div>
    </aside>
  )
}

export default Sidebar
