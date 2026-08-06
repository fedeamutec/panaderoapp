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

function Invoices({ onNavigateToSales }) {
  const [account, setAccount] = useState({ connected: false, nickname: '' })
  const [invoices, setInvoices] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

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
      id: String(invoice.orderId),
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
    })),
    [invoices],
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
        <button className="notice-bar" type="button" onClick={() => setNotice('')}>
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
                          href={`${API_BASE}/arca/sale-invoices/${encodeURIComponent(row.id)}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Ver PDF de ${row.number}`}
                        >
                          Ver
                        </a>
                        <a
                          className="registry-action-link primary"
                          href={`${API_BASE}/arca/sale-invoices/${encodeURIComponent(row.id)}/pdf?download=1`}
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
