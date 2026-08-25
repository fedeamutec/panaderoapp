import { useCallback, useEffect, useMemo, useState } from 'react'
import Topbar from '../components/Topbar'
import { formatCurrency } from '../components/SalesTable'
import { demoInvoices } from '../Data/Invoices'

const API_BASE = 'https://api.panaderoapp.com/api'

const typeFilters = [
  ['all', 'Todos'],
  ['A', 'Factura A'],
  ['B', 'Factura B'],
  ['C', 'Factura C'],
]

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, credentials: 'include' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo comunicar con Panadero API')
  return payload
}

function noticeTone(message) {
  const text = String(message || '').toLowerCase()
  if (/no se pudo|error|rechaz|fall|inválid|incorrect|vencid/.test(text)) return 'error'
  if (/seleccioná|agregá|ingresá|pendiente|revisar|todavía|falta|antes de/.test(text)) return 'warning'
  return 'success'
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function invoiceTypeKey(typeLabel) {
  const label = String(typeLabel || '').toUpperCase()
  if (label.includes(' A')) return 'A'
  if (label.includes(' B')) return 'B'
  if (label.includes(' C')) return 'C'
  return 'other'
}


function invoiceFiscalDate(invoice = {}) {
  const raw = String(invoice.voucher?.date || '').trim()
  if (/^\d{8}$/.test(raw)) {
    const year = raw.slice(0, 4)
    const month = raw.slice(4, 6)
    const day = raw.slice(6, 8)
    return { iso: `${year}-${month}-${day}`, monthKey: `${year}-${month}` }
  }

  const fallback = invoice.createdAt ? new Date(invoice.createdAt) : null
  if (!fallback || Number.isNaN(fallback.getTime())) return { iso: '', monthKey: '' }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(fallback)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    monthKey: `${parts.year}-${parts.month}`,
  }
}

function formatIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function excelCell(value, type = 'String', style = '') {
  const styleAttr = style ? ` ss:StyleID="${style}"` : ''
  const safeValue = type === 'Number' ? Number(value || 0) : xmlEscape(value)
  return `<Cell${styleAttr}><Data ss:Type="${type}">${safeValue}</Data></Cell>`
}

function buildMonthlyExcelXml(invoices, monthKey) {
  const totals = invoices.reduce((acc, invoice) => {
    const amount = Number(invoice.voucher?.amount || 0)
    const vat = Number(invoice.voucher?.vatAmount || 0)
    const net = Number(invoice.voucher?.netAmount ?? (amount - vat))
    acc.total += amount
    acc.vat += vat
    acc.net += net
    return acc
  }, { total: 0, vat: 0, net: 0 })

  const headers = [
    'Fecha',
    'Tipo',
    'Punto de venta',
    'N.º factura',
    'Cliente',
    'Tipo doc.',
    'CUIT / DNI',
    'Jurisdicción',
    'Detalle / productos',
    'Neto gravado',
    'IVA %',
    'Importe IVA',
    'Total',
    'CAE',
    'Vto. CAE',
    'Origen',
    'Venta / ID',
  ]

  const detailRows = invoices
    .slice()
    .sort((a, b) => {
      const dateA = invoiceFiscalDate(a).iso
      const dateB = invoiceFiscalDate(b).iso
      return dateA.localeCompare(dateB) || Number(a.voucher?.voucherNumber || 0) - Number(b.voucher?.voucherNumber || 0)
    })
    .map((invoice) => {
      const fiscalDate = invoiceFiscalDate(invoice)
      const amount = Number(invoice.voucher?.amount || 0)
      const vat = Number(invoice.voucher?.vatAmount || 0)
      const net = Number(invoice.voucher?.netAmount ?? (amount - vat))
      const source = invoice.source === 'commercial' ? 'Facturación General' : 'Mercado Libre'
      const identifier = invoice.source === 'commercial' ? (invoice.id || '') : (invoice.orderId || '')
      const products = Array.isArray(invoice.saleSnapshot?.items)
        ? invoice.saleSnapshot.items
            .map((item) => {
              const quantity = Number(item.quantity || 1)
              const title = item.title || item.name || item.description || 'Producto'
              return `${quantity} x ${title}`
            })
            .join(' | ')
        : ''

      return [
        excelCell(formatIsoDate(fiscalDate.iso)),
        excelCell(invoice.voucher?.voucherTypeDescription || 'Factura'),
        excelCell(invoice.voucher?.pointOfSale || 3, 'Number', 'Integer'),
        excelCell(invoice.voucher?.formattedNumber || ''),
        excelCell(invoice.buyer?.name || 'Consumidor final'),
        excelCell(invoice.buyer?.documentType || ''),
        excelCell(invoice.buyer?.documentNumber || invoice.voucher?.documentNumber || ''),
        excelCell(invoice.saleSnapshot?.address?.state || 'Argentina'),
        excelCell(products),
        excelCell(net, 'Number', 'Currency'),
        excelCell(invoice.voucher?.vatRate || 0, 'Number', 'PercentNumber'),
        excelCell(vat, 'Number', 'Currency'),
        excelCell(amount, 'Number', 'Currency'),
        excelCell(invoice.cae || ''),
        excelCell(invoice.caeExpirationDate || ''),
        excelCell(source),
        excelCell(identifier),
      ]
    })

  const totalsRow = [
    excelCell('TOTAL DEL MES', 'String', 'TotalLabel'),
    ...Array.from({ length: 8 }, () => excelCell('')),
    excelCell(totals.net, 'Number', 'TotalCurrency'),
    excelCell(''),
    excelCell(totals.vat, 'Number', 'TotalCurrency'),
    excelCell(totals.total, 'Number', 'TotalCurrency'),
    ...Array.from({ length: 4 }, () => excelCell('')),
  ]

  const rowXml = (cells) => `<Row>${cells.join('')}</Row>`
  const detailHeader = rowXml(headers.map((header) => excelCell(header, 'String', 'Header')))

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>Panadero</Author>
  <Title>Listado mensual de facturas ${xmlEscape(monthKey)}</Title>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Font ss:FontName="Arial" ss:Size="10"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#E7E6E6" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
  </Style>
  <Style ss:ID="Currency"><NumberFormat ss:Format="$#,##0.00"/></Style>
  <Style ss:ID="Integer"><NumberFormat ss:Format="0"/></Style>
  <Style ss:ID="PercentNumber"><NumberFormat ss:Format="0.00"/></Style>
  <Style ss:ID="TotalLabel">
   <Font ss:Bold="1"/>
   <Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders>
  </Style>
  <Style ss:ID="TotalCurrency">
   <Font ss:Bold="1"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="Facturas">
  <Table>
   <Column ss:Width="75"/>
   <Column ss:Width="90"/>
   <Column ss:Width="75"/>
   <Column ss:Width="105"/>
   <Column ss:Width="190"/>
   <Column ss:Width="70"/>
   <Column ss:Width="100"/>
   <Column ss:Width="115"/>
   <Column ss:Width="280"/>
   <Column ss:Width="95"/>
   <Column ss:Width="55"/>
   <Column ss:Width="95"/>
   <Column ss:Width="95"/>
   <Column ss:Width="120"/>
   <Column ss:Width="85"/>
   <Column ss:Width="115"/>
   <Column ss:Width="130"/>
   ${detailHeader}
   ${detailRows.map(rowXml).join('\n   ')}
   ${rowXml(totalsRow)}
  </Table>
  <AutoFilter x:Range="R1C1:R${detailRows.length + 1}C17" xmlns="urn:schemas-microsoft-com:office:excel"/>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>1</SplitHorizontal>
   <TopRowBottomPane>1</TopRowBottomPane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`
}

function Invoices({ onNavigateToSales }) {
  const [account, setAccount] = useState({ connected: false, nickname: '' })
  const [invoices, setInvoices] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [reportMonth, setReportMonth] = useState('')

  const loadInvoices = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true)
    else setInitialLoading(true)

    try {
      const [status, invoicePayload] = await Promise.all([
        api('/mercadolibre/status'),
        api('/arca/sale-invoices'),
      ])

      setAccount({
        connected: status.connected,
        nickname: status.account?.nickname || '',
        ...status.account,
      })
      const fetched = invoicePayload.invoices || []
      setInvoices(fetched.length ? fetched : (import.meta.env.DEV ? demoInvoices : []))
    } catch (error) {
      if (import.meta.env.DEV) setInvoices(demoInvoices)
      setNotice(error.message || 'No se pudo conectar con Panadero API.')
    } finally {
      setInitialLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

  const rows = useMemo(
    () => [...invoices].reverse().map((invoice) => ({
      id: String(invoice.orderId || invoice.id || ''),
      date: invoice.createdAt,
      dateLabel: formatDate(invoice.createdAt),
      customer: invoice.buyer?.name || 'Consumidor final',
      state: invoice.saleSnapshot?.address?.state || 'Argentina',
      type: invoice.voucher?.voucherTypeDescription || 'Factura',
      typeKey: invoiceTypeKey(invoice.voucher?.voucherTypeDescription),
      number: invoice.voucher?.formattedNumber || '—',
      vatRate: Number(invoice.voucher?.vatRate || 0),
      vatAmount: Number(invoice.voucher?.vatAmount || 0),
      total: Number(invoice.voucher?.amount || 0),
      cae: invoice.cae || '',
      pdfPath: invoice.source === 'commercial'
        ? `/arca/commercial-invoices/${encodeURIComponent(invoice.id || '')}/pdf`
        : `/arca/sale-invoices/${encodeURIComponent(invoice.orderId || '')}/pdf`,
    })),
    [invoices],
  )

  const reportMonths = useMemo(() => {
    const months = [...new Set(invoices.map((invoice) => invoiceFiscalDate(invoice).monthKey).filter(Boolean))]
    return months.sort((a, b) => b.localeCompare(a))
  }, [invoices])

  const effectiveReportMonth = reportMonth && reportMonths.includes(reportMonth)
    ? reportMonth
    : (reportMonths[0] || '')

  const monthlyInvoices = useMemo(
    () => invoices.filter((invoice) => invoiceFiscalDate(invoice).monthKey === effectiveReportMonth),
    [effectiveReportMonth, invoices],
  )

  const summary = useMemo(() => {
    const totals = rows.reduce(
      (acc, row) => ({
        count: acc.count + 1,
        amount: acc.amount + row.total,
        vat: acc.vat + row.vatAmount,
      }),
      { count: 0, amount: 0, vat: 0 },
    )

    const byType = rows.reduce((acc, row) => {
      acc[row.typeKey] = (acc[row.typeKey] || 0) + 1
      return acc
    }, {})

    return { ...totals, byType }
  }, [rows])

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return rows.filter((row) => {
      const matchesType = typeFilter === 'all' || row.typeKey === typeFilter
      const matchesQuery =
        !normalizedQuery ||
        row.customer.toLowerCase().includes(normalizedQuery) ||
        row.number.toLowerCase().includes(normalizedQuery) ||
        row.id.includes(normalizedQuery) ||
        row.state.toLowerCase().includes(normalizedQuery)

      return matchesType && matchesQuery
    })
  }, [query, rows, typeFilter])

  const handleMonthlyExcel = () => {
    if (!effectiveReportMonth || !monthlyInvoices.length) {
      setNotice('No hay facturas emitidas para el mes seleccionado.')
      return
    }

    try {
      const xml = buildMonthlyExcelXml(monthlyInvoices, effectiveReportMonth)
      const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Panadero-Facturacion-${effectiveReportMonth}.xls`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setNotice(`Reporte mensual ${effectiveReportMonth} descargado correctamente.`)
    } catch (error) {
      console.error('Monthly invoice export error:', error)
      setNotice('No se pudo generar el Excel mensual.')
    }
  }

  const handleConnect = async () => {
    setRefreshing(true)
    setNotice('')
    try {
      const { url } = await api('/mercadolibre/connect')
      window.location.assign(url)
    } catch (error) {
      setNotice(error.message)
      setRefreshing(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('¿Desconectar la cuenta de Mercado Libre?')) return
    setRefreshing(true)
    try {
      await api('/mercadolibre/disconnect', { method: 'POST' })
      setAccount({ connected: false, nickname: '' })
      setNotice('Cuenta desconectada.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleRefresh = () => {
    setNotice('')
    loadInvoices({ refresh: true })
  }

  const isLoading = initialLoading
  const isBusy = refreshing

  return (
    <main className="workspace">
      <Topbar
        section="facturas"
        account={account}
        loading={isBusy}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      {notice && (
        <button className={`notice-bar ${noticeTone(notice)}`} type="button" onClick={() => setNotice('')}>
          <span>{notice}</span>
          <strong aria-hidden="true">×</strong>
        </button>
      )}

      <section className="invoice-registry" aria-labelledby="registry-title">
        <div className="registry-header">
          <div>
            <span className="detail-kicker">ARCA Producción</span>
            <h2 id="registry-title">Comprobantes emitidos</h2>
            <p>Facturas autorizadas con CAE desde el punto de venta 0003.</p>
          </div>
          <div className="registry-header-actions">
            <label className="registry-month-picker">
              <span>Reporte mensual</span>
              <input
                type="month"
                value={effectiveReportMonth}
                onChange={(event) => setReportMonth(event.target.value)}
                min={reportMonths.at(-1) || undefined}
                max={reportMonths[0] || undefined}
                disabled={isLoading || !reportMonths.length}
              />
            </label>
            <button
              type="button"
              className="ghost-button registry-export"
              onClick={handleMonthlyExcel}
              disabled={isLoading || isBusy || !monthlyInvoices.length}
              title={monthlyInvoices.length ? `${monthlyInvoices.length} comprobantes en el mes` : 'Sin comprobantes para este mes'}
            >
              ↓ Excel mensual
            </button>
            <button
              type="button"
              className="ghost-button registry-refresh"
              onClick={handleRefresh}
              disabled={isLoading || isBusy}
              aria-busy={isBusy}
            >
              {isBusy ? 'Actualizando…' : '↻ Actualizar'}
            </button>
          </div>
        </div>

        {!isLoading && rows.length > 0 && (
          <div className="registry-stats" aria-label="Resumen de facturación">
            <article className="registry-stat-card">
              <span>Comprobantes</span>
              <strong>{summary.count}</strong>
              <small>Autorizados con CAE</small>
            </article>
            <article className="registry-stat-card">
              <span>Importe total</span>
              <strong>{formatCurrency(summary.amount)}</strong>
              <small>Acumulado en el registro</small>
            </article>
            <article className="registry-stat-card">
              <span>IVA informado</span>
              <strong>{formatCurrency(summary.vat)}</strong>
              <small>Suma de alícuotas</small>
            </article>
            <article className="registry-stat-card accent">
              <span>Tipos emitidos</span>
              <strong>
                {['A', 'B', 'C']
                  .filter((key) => summary.byType[key])
                  .map((key) => `${key} · ${summary.byType[key]}`)
                  .join('  ') || '—'}
              </strong>
              <small>Distribución por comprobante</small>
            </article>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <>
            <div className="registry-toolbar">
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por cliente, número o venta"
                  aria-label="Buscar comprobantes"
                />
              </label>
            </div>

            <div className="registry-filter-tabs" role="tablist" aria-label="Filtrar por tipo de comprobante">
              {typeFilters.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={typeFilter === value}
                  className={typeFilter === value ? 'active' : ''}
                  onClick={() => setTypeFilter(value)}
                >
                  <span>{label}</span>
                  <small>{value === 'all' ? rows.length : summary.byType[value] || 0}</small>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="registry-table-wrap" aria-busy={isLoading || isBusy}>
          {isLoading ? (
            <div className="registry-loading" role="status">
              <span className="detail-spinner" aria-hidden="true" />
              Cargando comprobantes emitidos…
            </div>
          ) : visibleRows.length ? (
            <table className="registry-table">
              <caption className="sr-only">
                Registro de {visibleRows.length} comprobantes fiscales emitidos por Panadero
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Jurisdicción</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">N.º factura</th>
                  <th scope="col">IVA %</th>
                  <th scope="col">Importe IVA</th>
                  <th scope="col">Total</th>
                  <th scope="col">Documento</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.dateLabel}</td>
                    <td>
                      <span className="registry-customer">{row.customer}</span>
                      <small className="registry-order-id">Venta #{row.id}</small>
                    </td>
                    <td>{row.state}</td>
                    <td>
                      <span className={`registry-type-badge ${row.typeKey.toLowerCase()}`}>
                        {row.typeKey !== 'other' ? `Factura ${row.typeKey}` : row.type}
                      </span>
                    </td>
                    <td>
                      <span className="registry-invoice-number">{row.number}</span>
                    </td>
                    <td>{row.vatRate ? `${row.vatRate}%` : '—'}</td>
                    <td>{formatCurrency(row.vatAmount)}</td>
                    <td>
                      <strong className="registry-total">{formatCurrency(row.total)}</strong>
                    </td>
                    <td>
                      <div className="registry-actions">
                        <a
                          className="registry-action-link"
                          href={`${API_BASE}${row.pdfPath}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Ver PDF de ${row.number}`}
                        >
                          Ver
                        </a>
                        <a
                          className="registry-action-link primary"
                          href={`${API_BASE}${row.pdfPath}?download=1`}
                          aria-label={`Descargar PDF de ${row.number}`}
                        >
                          PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : rows.length ? (
            <div className="registry-no-results" role="status">
              <strong>Sin resultados</strong>
              <p>No encontramos comprobantes que coincidan con tu búsqueda o filtro.</p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setQuery('')
                  setTypeFilter('all')
                }}
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="registry-empty-state">
              <div className="registry-empty-icon" aria-hidden="true">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 3h9l3 3v15H6z" />
                  <path d="M14 3v4h4M9 12h6M9 16h4" />
                </svg>
              </div>
              <strong>Todavía no hay facturas emitidas</strong>
              <p>
                Cuando factures una venta desde Panadero, el comprobante autorizado con CAE
                aparecerá acá con acceso directo al PDF.
              </p>
              {onNavigateToSales && (
                <button type="button" className="primary-button" onClick={onNavigateToSales}>
                  Ir a ventas
                </button>
              )}
            </div>
          )}
        </div>

        {!isLoading && visibleRows.length > 0 && (
          <footer className="registry-footer">
            <span>
              Mostrando <strong>{visibleRows.length}</strong> de <strong>{rows.length}</strong> comprobantes
            </span>
          </footer>
        )}
      </section>
    </main>
  )
}

export default Invoices
