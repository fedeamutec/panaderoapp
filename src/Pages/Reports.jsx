import { useEffect, useMemo, useState } from 'react'

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
  if (!sales || !maximum) return 0
  return Math.max(1, Math.min(5, Math.ceil((sales / maximum) * 5)))
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

const ARGENTINA_PROVINCES = [
  ['Jujuy', 'M82 20 L120 18 L130 48 L112 70 L78 62 Z', 100, 44],
  ['Salta', 'M72 60 L112 70 L145 54 L176 68 L170 108 L122 120 L82 104 Z', 126, 88],
  ['Formosa', 'M176 68 L238 72 L256 96 L218 112 L170 108 Z', 215, 91],
  ['Chaco', 'M170 108 L218 112 L224 150 L176 158 L150 132 Z', 193, 133],
  ['Misiones', 'M258 104 L278 92 L288 124 L274 160 L258 150 Z', 273, 127],
  ['Corrientes', 'M224 150 L258 150 L274 160 L264 206 L230 214 L210 184 Z', 244, 181],
  ['Santiago del Estero', 'M122 120 L170 108 L176 158 L166 202 L120 194 L108 154 Z', 144, 158],
  ['Tucumán', 'M94 116 L122 120 L120 154 L94 150 Z', 107, 136],
  ['Catamarca', 'M64 106 L94 116 L94 150 L108 154 L100 196 L64 190 L50 148 Z', 79, 153],
  ['La Rioja', 'M64 190 L100 196 L108 228 L82 252 L54 230 Z', 81, 220],
  ['Córdoba', 'M108 194 L166 202 L174 250 L150 286 L106 270 L82 252 L108 228 Z', 132, 239],
  ['Santa Fe', 'M166 202 L210 184 L230 214 L216 274 L190 304 L174 250 Z', 199, 246],
  ['Entre Ríos', 'M216 274 L248 264 L262 300 L238 334 L190 304 Z', 230, 299],
  ['San Juan', 'M54 230 L82 252 L80 294 L48 310 L34 270 Z', 59, 270],
  ['Mendoza', 'M48 310 L80 294 L106 310 L102 376 L66 402 L38 362 Z', 72, 348],
  ['San Luis', 'M80 294 L106 270 L150 286 L148 334 L106 342 L106 310 Z', 117, 309],
  ['Buenos Aires', 'M148 334 L190 304 L238 334 L274 354 L258 406 L218 438 L168 424 L138 386 Z', 209, 374],
  ['La Pampa', 'M102 376 L138 386 L168 424 L154 462 L104 456 L66 402 Z', 119, 416],
  ['Neuquén', 'M66 402 L104 456 L94 494 L54 486 L38 442 Z', 71, 455],
  ['Río Negro', 'M94 494 L104 456 L154 462 L206 448 L226 488 L184 520 L126 526 Z', 158, 491],
  ['Chubut', 'M126 526 L184 520 L226 488 L236 548 L206 582 L136 584 Z', 183, 551],
  ['Santa Cruz', 'M136 584 L206 582 L226 618 L202 668 L150 676 L118 638 Z', 171, 628],
  ['Tierra del Fuego', 'M150 694 L204 686 L218 706 L188 724 L154 718 Z', 185, 706],
]

function ArgentinaSalesMap({ provinces, selectedProvince, onSelect }) {
  const byProvince = useMemo(
    () => new Map((provinces || []).map((province) => [provinceKey(province.name), province])),
    [provinces],
  )
  const maximum = Math.max(0, ...(provinces || []).map((province) => Number(province.sales || 0)))
  const caba = byProvince.get('CIUDAD AUTONOMA DE BUENOS AIRES')

  return (
    <div className="argentina-map-wrap">
      <svg className="argentina-map argentina-map-fixed" viewBox="0 0 320 745" role="img" aria-label="Mapa esquemático de ventas por provincia">
        {ARGENTINA_PROVINCES.map(([name, path, labelX, labelY]) => {
          const province = byProvince.get(provinceKey(name))
          const sales = Number(province?.sales || 0)
          const active = selectedProvince && provinceKey(selectedProvince) === provinceKey(name)
          return (
            <g key={name} className="argentina-province-group">
              <path
                d={path}
                className={`argentina-province level-${colorLevel(sales, maximum)} ${active ? 'selected' : ''}`}
                onClick={() => province && onSelect(province.name)}
              >
                <title>{`${name}: ${integer.format(sales)} ventas`}</title>
              </path>
              {sales > 0 && <text x={labelX} y={labelY} className="argentina-map-sales" textAnchor="middle">{integer.format(sales)}</text>}
            </g>
          )
        })}
        <circle
          className={`argentina-caba ${provinceKey(selectedProvince) === 'CIUDAD AUTONOMA DE BUENOS AIRES' ? 'selected' : ''}`}
          cx="244" cy="365" r="7"
          onClick={() => caba && onSelect(caba.name)}
        >
          <title>{`CABA: ${integer.format(Number(caba?.sales || 0))} ventas`}</title>
        </circle>
        {caba && <text x="257" y="369" className="argentina-map-caba-label">CABA · {integer.format(caba.sales || 0)}</text>}
      </svg>
      <div className="map-legend"><span>Menos ventas</span><div>{[1, 2, 3, 4, 5].map((level) => <i key={level} className={`level-${level}`}/>)}</div><span>Más ventas</span></div>
      <small className="map-note">Mapa esquemático · los valores se toman del mismo reporte y ranking de ventas.</small>
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
  const visibleRanking = (report?.provinces || []).filter((province) => province.name !== 'Sin provincia').slice(0, 10)

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
            <section className="report-section report-map-card">
              <header><div><span>Distribución</span><h2>Argentina</h2></div><small>Color más intenso = mayor cantidad de ventas</small></header>
              <ArgentinaSalesMap provinces={report.provinces} selectedProvince={selectedProvince} onSelect={setSelectedProvince} />
            </section>

            <section className="report-section report-ranking-card">
              <header><div><span>Ranking</span><h2>Provincias</h2></div><small>Top 10 por cantidad de ventas</small></header>
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

          <section className="report-section province-detail-card">
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
