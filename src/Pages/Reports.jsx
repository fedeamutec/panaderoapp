import { useMemo } from 'react'

const readJson = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '')
    return value ?? fallback
  } catch {
    return fallback
  }
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

function Metric({ label, value, note }) {
  return <article className="report-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>
}

function Reports() {
  const budgets = useMemo(() => readJson('panadero-generated-budgets', []), [])
  const salesTotal = Number(localStorage.getItem('panadero-total-sales') || 0)

  const budgetTotal = budgets.reduce((sum, budget) => {
    const items = Array.isArray(budget.items) ? budget.items : []
    return sum + items.reduce((subtotal, item) => subtotal + Number(item.subtotal || 0), 0)
  }, 0)

  const customerCount = new Set(budgets.map((budget) => budget.client?.taxId || budget.client?.commercialName).filter(Boolean)).size
  const itemCount = budgets.reduce((sum, budget) => sum + (Array.isArray(budget.items) ? budget.items.length : 0), 0)

  return (
    <main className="reports-page">
      <header className="reports-header">
        <div><span>Información consolidada</span><h1>Reportes</h1><p>Un único lugar para revisar Mercado Libre, presupuestos y la futura facturación general.</p></div>
      </header>

      <div className="reports-content">
        <section className="report-section report-section-ml">
          <header><div><span>Canal de venta</span><h2>Mercado Libre</h2></div><small>Datos conectados al módulo de ventas</small></header>
          <div className="report-grid">
            <Metric label="Ventas sincronizadas" value={salesTotal.toLocaleString('es-AR')} note="Total informado por Mercado Libre" />
            <Metric label="Facturación" value="Disponible" note="El detalle se incorporará desde las facturas emitidas" />
            <Metric label="Comisiones y neto" value="Próximamente" note="Resumen por período y producto" />
          </div>
        </section>

        <section className="report-section report-section-budget">
          <header><div><span>Gestión comercial</span><h2>Presupuestos</h2></div><small>Información guardada en este dispositivo</small></header>
          <div className="report-grid">
            <Metric label="Presupuestos generados" value={budgets.length.toLocaleString('es-AR')} />
            <Metric label="Total presupuestado" value={money.format(budgetTotal)} />
            <Metric label="Clientes presupuestados" value={customerCount.toLocaleString('es-AR')} />
            <Metric label="Renglones cotizados" value={itemCount.toLocaleString('es-AR')} />
          </div>
        </section>

        <section className="report-section report-section-general">
          <header><div><span>Próximo módulo</span><h2>Facturación general</h2></div><small>Compartirá clientes y lista de precios con Presupuestos</small></header>
          <div className="report-coming-soon">
            <strong>Preparado para la próxima etapa</strong>
            <p>Acá se acumularán las ventas y facturas realizadas fuera de Mercado Libre, vinculadas a los mismos clientes, productos y presupuestos.</p>
            <div><span>Presupuesto confirmado</span><b>→</b><span>Factura general</span><b>→</b><span>Reporte consolidado</span></div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default Reports
