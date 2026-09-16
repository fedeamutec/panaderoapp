const modules = [
  {
    section: 'ventas',
    tone: 'mercadolibre',
    eyebrow: 'Ventas conectadas',
    title: 'Mercado Libre',
    description: 'Sincroniza tus operaciones, consulta comprador, facturación, productos, entrega y dinero recibido desde un único lugar.',
    steps: ['Conectá tu cuenta vendedora.', 'Sincronizá las ventas.', 'Revisá los datos fiscales antes de facturar.'],
  },
  {
    section: 'presupuestos',
    tone: 'presupuesto',
    eyebrow: 'Gestión comercial',
    title: 'Presupuesto',
    description: 'Armá propuestas profesionales con clientes, productos, cantidades, precios y transporte; guardalas para consultarlas o imprimirlas.',
    steps: ['Elegí o cargá un cliente.', 'Agregá productos e importes.', 'Confirmá, descargá o imprimí.'],
  },
  {
    section: 'facturas',
    tone: 'facturas',
    eyebrow: 'Comprobantes emitidos',
    title: 'Facturas',
    description: 'Consultá el historial de comprobantes autorizados, sus números, importes y documentos PDF sin perder el vínculo con la venta original.',
    steps: ['Filtrá el período.', 'Abrí el comprobante.', 'Descargá o imprimí el PDF.'],
  },
  {
    section: 'arca',
    tone: 'arca',
    eyebrow: 'Conexión fiscal',
    title: 'ARCA',
    description: 'Centraliza la configuración fiscal y la emisión electrónica mediante CAE, usando los datos de facturación verificados antes de confirmar.',
    steps: ['Configurá credenciales y punto de venta.', 'Verificá el estado de conexión.', 'Emití únicamente desde la confirmación fiscal.'],
  },
  {
    section: 'reportes',
    tone: 'reportes',
    eyebrow: 'Lectura del negocio',
    title: 'Reportes / Mapa',
    description: 'Reuní indicadores de ventas, facturación y presupuestos, con una base preparada para visualizar la distribución geográfica de tu operación.',
    steps: ['Elegí el área a analizar.', 'Compará métricas clave.', 'Usá el mapa para detectar zonas y oportunidades.'],
  },
]

function Dashboard({ onNavigate }) {
  return (
    <main className="dashboard-page">
      <section className="dashboard-hero">
        <div>
          <span className="dashboard-kicker">Centro de operaciones</span>
          <h1>Panadero conecta cada parte de tu negocio</h1>
          <p>
            Una plataforma de conectividad comercial y fiscal que une Mercado Libre, la gestión de presupuestos y la facturación electrónica con ARCA. Los datos viajan entre módulos para reducir carga manual, evitar errores y mantener trazabilidad desde la venta hasta el comprobante.
          </p>
        </div>
        <div className="technology-card">
          <span>TECNOLOGÍA PANADERO</span>
          <strong>Una operación, un flujo conectado</strong>
          <p>Sincronización de ventas, lectura fiscal del comprador, validación previa, emisión con CAE y registro documental.</p>
          <div><b>Mercado Libre</b><i>→</i><b>Panadero</b><i>→</i><b>ARCA</b></div>
        </div>
      </section>

      <section className="dashboard-manual">
        <header>
          <span>Manual rápido</span>
          <h2>Qué hace cada módulo</h2>
        </header>
        <div className="dashboard-module-grid">
          {modules.map((module) => (
            <article className={`dashboard-module-card ${module.tone}`} key={module.section}>
              <span>{module.eyebrow}</span>
              <h3>{module.title}</h3>
              <p>{module.description}</p>
              <ol>{module.steps.map((step) => <li key={step}>{step}</li>)}</ol>
              <button type="button" onClick={() => onNavigate(module.section)}>Abrir {module.title} →</button>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export default Dashboard
