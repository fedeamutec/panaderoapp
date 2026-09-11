import { useEffect, useMemo, useState } from 'react'
import argentinaSvgRaw from '../assets/argentina-provincias.svg?raw'

const API_BASE = 'https://api.panaderoapp.com/api'

const periods = [
  ['30d', '30 días'],
  ['90d', '3 meses'],
  ['180d', '6 meses'],
  ['365d', '1 año'],
  ['all', 'Histórico'],
]

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('es-AR')

async function api(path) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo comunicar con Panadero API')
  return payload
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

const provinceAliases = {
  'CIUDAD DE BUENOS AIRES': 'CIUDAD AUTONOMA DE BUENOS AIRES',
  'CAPITAL FEDERAL': 'CIUDAD AUTONOMA DE BUENOS AIRES',
  CABA: 'CIUDAD AUTONOMA DE BUENOS AIRES',
}

function provinceKey(value) {
  const normalized = normalizeText(value)
  return provinceAliases[normalized] || normalized
}

function colorLevel(sales, maximum) {
  const value = Number(sales || 0)
  const max = Number(maximum || 0)
  if (!value || !max) return 0
  const ratio = Math.log1p(value) / Math.log1p(max)
  return Math.max(1, Math.min(5, Math.ceil(ratio * 5)))
}

function Metric({ label, value, note }) {
  return <article className="report-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function exportExcel(report, selectedProvince) {
  if (!report?.provinces?.length) return

  const provinces = selectedProvince
    ? report.provinces.filter((province) => province.name === selectedProvince)
    : report.provinces

  const rows = provinces.flatMap((province) => province.customers.map((customer) => ({
    province: province.name,
    customer: customer.name,
    nickname: customer.nickname,
    localities: customer.localities?.join(', ') || '',
    sales: customer.sales,
    amount: customer.amount,
    lastPurchase: customer.lastPurchase ? new Date(customer.lastPurchase).toLocaleDateString('es-AR') : '',
    products: customer.products?.join(' | ') || '',
  })))

  const body = rows.map((row) => `
    <tr>
      <td>${escapeXml(row.province)}</td>
      <td>${escapeXml(row.customer)}</td>
      <td>${escapeXml(row.nickname)}</td>
      <td>${escapeXml(row.localities)}</td>
      <td>${row.sales}</td>
      <td>${Number(row.amount || 0).toFixed(2)}</td>
      <td>${escapeXml(row.lastPurchase)}</td>
      <td>${escapeXml(row.products)}</td>
    </tr>`).join('')

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1">
    <tr><th>Provincia</th><th>Cliente</th><th>Usuario ML</th><th>Localidad</th><th>Compras</th><th>Total comprado</th><th>Última compra</th><th>Productos</th></tr>
    ${body}
  </table></body></html>`

  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `panadero-clientes-${selectedProvince ? normalizeText(selectedProvince).toLowerCase().replace(/\s+/g, '-') : report.period}.xls`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function ArgentinaSalesMap({ svgText, provinces, selectedProvince, onSelect }) {
  const processedSvg = useMemo(() => {
    if (!svgText || typeof DOMParser === 'undefined') return ''

    const byProvince = new Map((provinces || []).map((province) => [provinceKey(province.name), province]))
    const maximum = Math.max(0, ...(provinces || []).map((province) => Number(province.sales || 0)))
    const regionNames = {
      ARA: 'Salta', ARB: 'Buenos Aires', ARC: 'Ciudad Autónoma de Buenos Aires', ARD: 'San Luis',
      ARE: 'Entre Ríos', ARF: 'La Rioja', ARG: 'Santiago del Estero', ARH: 'Chaco',
      ARJ: 'San Juan', ARK: 'Catamarca', ARL: 'La Pampa', ARM: 'Mendoza', ARN: 'Misiones',
      ARP: 'Formosa', ARQ: 'Neuquén', ARR: 'Río Negro', ARS: 'Santa Fe', ART: 'Tucumán',
      ARU: 'Chubut', ARV: 'Tierra del Fuego', ARW: 'Corrientes', ARX: 'Córdoba',
      ARY: 'Jujuy', ARZ: 'Santa Cruz',
    }

    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return ''
    const svg = doc.documentElement
    doc.querySelectorAll('style').forEach((style) => style.remove())
    doc.querySelector('#points')?.remove()
    doc.querySelector('#label_points')?.remove()
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.setAttribute('viewBox', '280 30 440 920')
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.setAttribute('class', 'argentina-map argentina-map-real')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', 'Mapa real de ventas por provincia de Argentina')

    Object.entries(regionNames).forEach(([id, name]) => {
      const region = doc.getElementById(id)
      if (!region) return
      const province = byProvince.get(provinceKey(name))
      const sales = Number(province?.sales || 0)
      const active = selectedProvince && provinceKey(selectedProvince) === provinceKey(name)
      const targets = region.matches('path, polygon, polyline')
        ? [region]
        : Array.from(region.querySelectorAll('path, polygon, polyline'))
      const decorated = targets.length ? targets : [region]

      decorated.forEach((element) => {
        element.removeAttribute('style')
        element.removeAttribute('fill')
        element.removeAttribute('stroke')
        element.setAttribute('class', `argentina-province level-${colorLevel(sales, maximum)}${active ? ' selected' : ''}`)
        element.setAttribute('data-province', province?.name || name)
      })

      region.setAttribute('data-province', province?.name || name)
      let title = region.querySelector(':scope > title')
      if (!title) {
        title = doc.createElementNS('http://www.w3.org/2000/svg', 'title')
        region.prepend(title)
      }
      title.textContent = `${name}: ${integer.format(sales)} ventas`
    })

    return svg.outerHTML
  }, [svgText, provinces, selectedProvince])

  return (
    <div className="argentina-map-wrap">
      <div
        className="argentina-map-svg-host"
        onClick={(event) => {
          const target = event.target.closest?.('[data-province]')
          const name = target?.getAttribute('data-province')
          const province = (provinces || []).find((item) => provinceKey(item.name) === provinceKey(name))
          if (province) onSelect(province.name)
        }}
        dangerouslySetInnerHTML={{ __html: processedSvg }}
      />
      <div className="map-legend"><span>Menos ventas</span><div>{[1, 2, 3, 4, 5].map((level) => <i key={level} className={`level-${level}`}/>)}</div><span>Más ventas</span></div>
      <small className="map-note">Mapa provincial · amarillo más intenso = más ventas. La provincia seleccionada se destaca.</small>
    </div>
  )
}

function Reports() {
  const [period, setPeriod] = useState('90d')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedProvince, setSelectedProvince] = useState('')

  const loadReport = async (refresh = false) => {
    setLoading(true)
    setError('')
    try {
      const payload = await api(`/reports/mercadolibre-customers?period=${encodeURIComponent(period)}${refresh ? '&refresh=1' : ''}`)
      setReport(payload)
      const firstProvince = payload.provinces?.find((province) => province.name !== 'Sin provincia')
      setSelectedProvince((current) => {
        if (payload.provinces?.some((province) => province.name === current)) return current
        return firstProvince?.name || ''
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport(false)
    // El reporte queda cacheado en el servidor. Solo se consulta Mercado Libre
    // cuando no hay cache para ese período o al tocar "Actualizar datos".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])



  const selected = report?.provinces?.find((province) => province.name === selectedProvince) || null
  const visibleRanking = (report?.provinces || []).filter((province) => province.name !== 'Sin provincia')

  return (
    <main className="reports-page">
      <header className="reports-header report-map-header">
        <div><span>Mercado Libre · distribución geográfica</span><h1>Mapa de clientes</h1><p>Vista de ventas y clientes por provincia para planificar acciones comerciales locales.</p></div>
        <div className="report-header-actions">
          <select value={period} onChange={(event) => { setLoading(true); setError(''); setPeriod(event.target.value) }} disabled={loading}>
            {periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="ghost-button" type="button" disabled={loading} onClick={() => loadReport(true)}>Actualizar datos</button>
          <button className="primary-button" type="button" disabled={!report?.provinces?.length} onClick={() => exportExcel(report, '')}>Exportar Excel</button>
        </div>
      </header>

      <div className="reports-content report-map-content">
        {loading && <section className="report-state"><span className="detail-spinner"/>Cargando mapa y reporte de clientes…</section>}
        {error && <section className="report-state error"><strong>No se pudo generar el reporte.</strong><span>{error}</span></section>}

        {!loading && !error && report && <>
          {report.truncated && <section className="report-warning">Se analizaron {integer.format(report.scannedOrders)} de {integer.format(report.totalAvailable)} operaciones disponibles. Para períodos con más de 1.000 operaciones conviene dividir el análisis por fechas.</section>}

          <div className="report-cache-note">Datos del reporte: {report.cached ? 'guardados en Panadero' : 'actualizados desde Mercado Libre'} · {report.generatedAt ? new Date(report.generatedAt).toLocaleString('es-AR') : '—'}</div>

          <section className="report-section report-section-ml">
            <div className="report-grid report-summary-grid">
              <Metric label="Ventas" value={integer.format(report.summary?.sales || 0)} note="Operaciones pagadas" />
              <Metric label="Clientes únicos" value={integer.format(report.summary?.customers || 0)} />
              <Metric label="Monto vendido" value={money.format(report.summary?.amount || 0)} />
              <Metric label="Ticket promedio" value={money.format(report.summary?.averageTicket || 0)} />
            </div>
          </section>

          <div className="report-map-layout">
            <section className="report-section report-map-card report-flat-section">
              <header><div><span>Distribución</span><h2>Argentina</h2></div><small>Color más intenso = mayor cantidad de ventas</small></header>
              <ArgentinaSalesMap svgText={argentinaSvgRaw} provinces={report.provinces} selectedProvince={selectedProvince} onSelect={setSelectedProvince} />
            </section>

            <section className="report-section report-ranking-card report-flat-section">
              <header><div><span>Ranking</span><h2>Provincias</h2></div><small>Todas · ordenadas por cantidad de ventas</small></header>
              <div className="province-ranking">
                {visibleRanking.map((province, index) => (
                  <button key={province.name} type="button" className={selectedProvince === province.name ? 'active' : ''} onClick={() => setSelectedProvince(province.name)}>
                    <b>{String(index + 1).padStart(2, '0')}</b>
                    <span><strong>{province.name}</strong><small>{integer.format(province.customersCount)} clientes · {money.format(province.amount)}</small></span>
                    <em>{integer.format(province.sales)}</em>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="report-section province-detail-card report-flat-section">
            <header>
              <div><span>Provincia seleccionada</span><h2>{selected?.name || 'Seleccioná una provincia'}</h2></div>
              {selected && <button className="ghost-button" type="button" onClick={() => exportExcel(report, selected.name)}>Exportar esta provincia</button>}
            </header>

            {selected ? <>
              <div className="province-kpis">
                <Metric label="Ventas" value={integer.format(selected.sales)} />
                <Metric label="Clientes únicos" value={integer.format(selected.customersCount)} />
                <Metric label="Monto vendido" value={money.format(selected.amount)} />
                <Metric label="Ticket promedio" value={money.format(selected.averageTicket)} />
              </div>

              <div className="customer-table-wrap">
                <table className="customer-table">
                  <thead><tr><th>Cliente</th><th>Localidad</th><th>Compras</th><th>Total comprado</th><th>Última compra</th></tr></thead>
                  <tbody>
                    {selected.customers.map((customer) => (
                      <tr key={customer.id}>
                        <td><strong>{customer.name}</strong>{customer.nickname && <small>{customer.nickname}</small>}</td>
                        <td>{customer.localities?.join(', ') || '—'}</td>
                        <td>{integer.format(customer.sales)}</td>
                        <td>{money.format(customer.amount)}</td>
                        <td>{customer.lastPurchase ? new Date(customer.lastPurchase).toLocaleDateString('es-AR') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </> : <div className="report-empty">No hay ventas con provincia identificada en este período.</div>}
          </section>
        </>}
      </div>
    </main>
  )
}

export default Reports
