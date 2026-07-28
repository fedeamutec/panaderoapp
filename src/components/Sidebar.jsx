const mainItems = [
  ['⌂', 'Inicio'],
  ['▤', 'Ventas'],
  ['▧', 'Facturas'],
  ['♙', 'Clientes'],
  ['□', 'Productos'],
]

const secondaryItems = [
  ['◉', 'Sincronizaciones'],
  ['▥', 'Reportes'],
  ['◈', 'ARCA'],
]

const themeLabels = {
  cursor: 'Cursor',
  black: 'Black',
  paper: 'Paper',
}


function Sidebar({
  activeSection,
  onSectionChange,
  salesCount = 0,
  settingsOpen,
  onToggleSettings,
  theme,
  onThemeChange,
  fontScale,
  onFontScaleChange,
}) {
  const decreaseFont = () => {
    onFontScaleChange((current) => Math.max(0.9, Number((current - 0.05).toFixed(2))))
  }

  const increaseFont = () => {
    onFontScaleChange((current) => Math.min(1.35, Number((current + 0.05).toFixed(2))))
  }

  return (
    <aside className="sidebar">
      <div className="window-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="sidebar-brand">
        <div className="brand-mark">P</div>
        <div>
          <strong>Panadero</strong>
          <small>Facturación inteligente</small>
        </div>
      </div>

      <nav className="sidebar-navigation" aria-label="Navegación principal">
        <span className="nav-label">Espacio de trabajo</span>
        {mainItems.map(([icon, label]) => {
          const section = label === 'Facturas' ? 'facturas' : label === 'Inicio' || label === 'Ventas' ? 'ventas' : label.toLowerCase()
          return (
          <button
            className={`sidebar-item ${activeSection === section ? 'active' : ''}`}
            type="button"
            key={label}
            onClick={() => (section === 'ventas' || section === 'facturas') && onSectionChange(section)}
          >
            <span className="sidebar-icon">{icon}</span>
            <span>{label}</span>
            {label === 'Ventas' && <small className="nav-count">{salesCount}</small>}
          </button>
          )
        })}

        <span className="nav-label nav-label-spaced">Herramientas</span>
        {secondaryItems.map(([icon, label]) => {
          const section = label === 'ARCA' ? 'arca' : label.toLowerCase()
          return (
          <button className={`sidebar-item ${activeSection === section ? 'active' : ''}`} type="button" key={label} onClick={() => label === 'ARCA' && onSectionChange('arca')}>
            <span className="sidebar-icon">{icon}</span>
            <span>{label}</span>
          </button>
          )
        })}

        <button
          className={`sidebar-item ${settingsOpen ? 'active' : ''}`}
          type="button"
          onClick={onToggleSettings}
        >
          <span className="sidebar-icon">⚙</span>
          <span>Configuración</span>
        </button>
      </nav>

      {settingsOpen && (
        <section className="appearance-panel" aria-label="Apariencia">
          <div className="appearance-heading">
            <div>
              <strong>Apariencia</strong>
              <small>Se guarda automáticamente</small>
            </div>
            <button type="button" onClick={onToggleSettings} aria-label="Cerrar">
              ×
            </button>
          </div>

          <div className="appearance-group">
            <span className="appearance-label">Tema</span>
            <div className="theme-options">
              {Object.keys(themeLabels).map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`theme-option ${theme === name ? 'selected' : ''}`}
                  onClick={() => onThemeChange(name)}
                >
                  <span className={`theme-preview ${name}`} aria-hidden="true" />
                  <span>{themeLabels[name]}</span>
                  <span className="theme-check">{theme === name ? '●' : '○'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="appearance-group">
            <div className="font-size-heading">
              <span className="appearance-label">Tamaño de texto</span>
              <strong>{Math.round(fontScale * 100)}%</strong>
            </div>
            <div className="font-size-controls">
              <button type="button" onClick={decreaseFont} aria-label="Achicar texto">A−</button>
              <button
                type="button"
                className="font-reset"
                onClick={() => onFontScaleChange(1.08)}
              >
                Restablecer
              </button>
              <button type="button" onClick={increaseFont} aria-label="Agrandar texto">A+</button>
            </div>
          </div>
        </section>
      )}

      <div className="sidebar-footer">
        <button className="profile-card" type="button">
          <span className="profile-avatar">FA</span>
          <span className="profile-copy">
            <strong>Fede Amurin</strong>
            <small>Administrador</small>
          </span>
          <span className="profile-menu">•••</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
