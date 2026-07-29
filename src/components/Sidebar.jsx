function Icon({ name }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  const icons = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>,
    sales: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    invoices: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></>,
    clients: <><circle cx="12" cy="8" r="3"/><path d="M6 20c.6-4 2.6-6 6-6s5.4 2 6 6"/></>,
    products: <><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 5V3h8v2M8 10h8"/></>,
    sync: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8A7 7 0 0 1 18 6l2 1M18 16a7 7 0 0 1-12 2l-2-1"/></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/></>,
    arca: <><rect x="4" y="3" width="16" height="18" rx="4"/><path d="m8.5 17 3.5-10 3.5 10"/><path d="M9.8 13h4.4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  }
  return <svg {...common}>{icons[name]}</svg>
}

const mainItems = [
  ['home', 'Inicio'],
  ['sales', 'Ventas'],
  ['invoices', 'Facturas'],
  ['clients', 'Clientes'],
  ['products', 'Productos'],
]

const secondaryItems = [
  ['sync', 'Sincronizaciones'],
  ['reports', 'Reportes'],
  ['arca', 'ARCA'],
]

const themeLabels = { cursor: 'Cursor', black: 'Black', paper: 'Paper' }

function Sidebar({ activeSection, onSectionChange, salesCount = 0, settingsOpen, onToggleSettings, theme, onThemeChange, fontScale, onFontScaleChange }) {
  const decreaseFont = () => onFontScaleChange((current) => Math.max(0.9, Number((current - 0.05).toFixed(2))))
  const increaseFont = () => onFontScaleChange((current) => Math.min(1.35, Number((current + 0.05).toFixed(2))))

  return (
    <aside className="sidebar">
      <div className="window-dots" aria-hidden="true"><span/><span/><span/></div>
      <div className="sidebar-brand"><div className="brand-mark">P</div><div><strong>Panadero</strong><small>Facturación inteligente</small></div></div>
      <nav className="sidebar-navigation" aria-label="Navegación principal">
        <span className="nav-label">Espacio de trabajo</span>
        {mainItems.map(([icon, label]) => {
          const section = label === 'Facturas' ? 'facturas' : label === 'Inicio' || label === 'Ventas' ? 'ventas' : label.toLowerCase()
          return <button className={`sidebar-item ${activeSection === section ? 'active' : ''}`} type="button" key={label} onClick={() => (section === 'ventas' || section === 'facturas') && onSectionChange(section)}><span className="sidebar-icon"><Icon name={icon}/></span><span>{label}</span>{label === 'Ventas' && <small className="nav-count">{salesCount}</small>}</button>
        })}
        <span className="nav-label nav-label-spaced">Herramientas</span>
        {secondaryItems.map(([icon, label]) => {
          const section = label === 'ARCA' ? 'arca' : label.toLowerCase()
          return <button className={`sidebar-item ${activeSection === section ? 'active' : ''}`} type="button" key={label} onClick={() => label === 'ARCA' && onSectionChange('arca')}><span className="sidebar-icon"><Icon name={icon}/></span><span>{label}</span></button>
        })}
        <button className={`sidebar-item ${settingsOpen ? 'active' : ''}`} type="button" onClick={onToggleSettings}><span className="sidebar-icon"><Icon name="settings"/></span><span>Configuración</span></button>
      </nav>
      {settingsOpen && <section className="appearance-panel" aria-label="Apariencia"><div className="appearance-heading"><div><strong>Apariencia</strong><small>Se guarda automáticamente</small></div><button type="button" onClick={onToggleSettings} aria-label="Cerrar">×</button></div><div className="appearance-group"><span className="appearance-label">Tema</span><div className="theme-options">{Object.keys(themeLabels).map((name) => <button key={name} type="button" className={`theme-option ${theme === name ? 'selected' : ''}`} onClick={() => onThemeChange(name)}><span className={`theme-preview ${name}`} aria-hidden="true"/><span>{themeLabels[name]}</span><span className="theme-check">{theme === name ? '●' : '○'}</span></button>)}</div></div><div className="appearance-group"><div className="font-size-heading"><span className="appearance-label">Tamaño de texto</span><strong>{Math.round(fontScale * 100)}%</strong></div><div className="font-size-controls"><button type="button" onClick={decreaseFont}>A−</button><button type="button" className="font-reset" onClick={() => onFontScaleChange(1.08)}>Restablecer</button><button type="button" onClick={increaseFont}>A+</button></div></div></section>}
      <div className="sidebar-footer"><button className="profile-card" type="button"><span className="profile-avatar">FA</span><span className="profile-copy"><strong>Fede Amurin</strong><small>Administrador</small></span><span className="profile-menu">•••</span></button></div>
    </aside>
  )
}

export default Sidebar
