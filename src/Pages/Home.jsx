import { useCallback, useEffect, useMemo, useState } from 'react'
import Topbar from '../components/Topbar'
import SalesTable, { formatCurrency } from '../components/SalesTable'
import { sales as demoSales } from '../Data/Sales'

const API_BASE = 'https://api.panaderoapp.com/api'

const filters = [
  ['all', 'Todas'],
  ['ready', 'Pendientes'],
  ['invoiced', 'Facturadas'],
  ['review', 'Revisar'],
]

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo comunicar con Panadero API')
  return payload
}

function Home() {
  const [account, setAccount] = useState({ connected: false, nickname: '' })
  const [sales, setSales] = useState(demoSales)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [activeFilter, setActiveFilter] = useState(() =>
    localStorage.getItem('panadero-active-filter') || 'all',
  )
  const [selectedSaleId, setSelectedSaleId] = useState(() =>
    localStorage.getItem('panadero-selected-sale') || demoSales[0]?.id,
  )
  const [query, setQuery] = useState('')

  const loadConnection = useCallback(async () => {
    try {
      const status = await api('/mercadolibre/status')
      setAccount({
        connected: status.connected,
        nickname: status.account?.nickname || '',
        ...status.account,
      })

      if (status.connected) {
        const orderPayload = await api('/mercadolibre/orders')
        if (orderPayload.orders?.length) setSales(orderPayload.orders)
      }
    } catch {
      setNotice('El backend no está iniciado. Ejecutá npm run dev.')
    }
  }, [])

  useEffect(() => {
    loadConnection()
    const params = new URLSearchParams(window.location.search)
    if (params.get('ml') === 'connected') {
      setNotice('Mercado Libre se conectó correctamente.')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('ml') === 'error') {
      setNotice(params.get('message') || 'No se pudo conectar Mercado Libre.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [loadConnection])

  useEffect(() => {
    localStorage.setItem('panadero-active-filter', activeFilter)
  }, [activeFilter])

  useEffect(() => {
    if (selectedSaleId) localStorage.setItem('panadero-selected-sale', selectedSaleId)
  }, [selectedSaleId])

  const visibleSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesFilter = activeFilter === 'all' || sale.status === activeFilter
      const normalizedQuery = query.trim().toLowerCase()
      const matchesQuery =
        !normalizedQuery ||
        sale.customer.toLowerCase().includes(normalizedQuery) ||
        sale.id.includes(normalizedQuery) ||
        sale.documentNumber.toLowerCase().includes(normalizedQuery)

      return matchesFilter && matchesQuery
    })
  }, [activeFilter, query, sales])

  const selectedSale =
    sales.find((sale) => sale.id === selectedSaleId) || visibleSales[0]

  const summary = useMemo(
    () => ({
      all: sales.length,
      ready: sales.filter((sale) => sale.status === 'ready').length,
      invoiced: sales.filter((sale) => sale.status === 'invoiced').length,
      review: sales.filter((sale) => sale.status === 'review').length,
    }),
    [sales],
  )

  const handleConnect = async () => {
    setLoading(true)
    setNotice('')
    try {
      const { url } = await api('/mercadolibre/connect')
      window.location.assign(url)
    } catch (error) {
      setNotice(error.message)
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setLoading(true)
    setNotice('')
    try {
      const result = await api('/mercadolibre/sync', { method: 'POST' })
      setSales(result.orders || [])
      setSelectedSaleId(result.orders?.[0]?.id || '')
      setNotice(`Sincronización completa: ${result.orders?.length || 0} ventas cargadas.`)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('¿Desconectar la cuenta de Mercado Libre?')) return
    setLoading(true)
    try {
      await api('/mercadolibre/disconnect', { method: 'POST' })
      setAccount({ connected: false, nickname: '' })
      setSales(demoSales)
      setSelectedSaleId(demoSales[0]?.id)
      setNotice('Cuenta desconectada.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="workspace">
      <Topbar
        account={account}
        loading={loading}
        onSync={handleSync}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      {notice && (
        <button className="notice-bar" type="button" onClick={() => setNotice('')}>
          <span>{notice}</span><strong>×</strong>
        </button>
      )}

      <div className="column-layout">
        <section className="list-panel">
          <div className="panel-toolbar">
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar venta o cliente"
              />
              <kbd>⌘ K</kbd>
            </label>

            <button className="icon-button" type="button" aria-label="Filtrar">≡</button>
          </div>

          <div className="filter-tabs">
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={activeFilter === value ? 'active' : ''}
                onClick={() => setActiveFilter(value)}
              >
                <span>{label}</span>
                <small>{summary[value]}</small>
              </button>
            ))}
          </div>

          <div className="list-heading">
            <span>Operaciones recientes</span>
            <small>{visibleSales.length} resultados</small>
          </div>

          <SalesTable
            sales={visibleSales}
            selectedSaleId={selectedSale?.id}
            onSelectSale={setSelectedSaleId}
          />
        </section>

        <section className="detail-panel">
          {selectedSale ? (
            <>
              <div className="detail-header">
                <div>
                  <span className="detail-kicker">Venta #{selectedSale.id}</span>
                  <h2>{selectedSale.customer}</h2>
                </div>
                <button className="icon-button" type="button">•••</button>
              </div>

              <div className="detail-status-row">
                <span className={`status-badge ${selectedSale.status}`}>{selectedSale.statusLabel}</span>
                <small>{selectedSale.dateCreated ? new Date(selectedSale.dateCreated).toLocaleString('es-AR') : 'Actualizada hace 3 min'}</small>
              </div>

              <div className="detail-block">
                <div className="section-label">Cliente</div>
                <div className="data-grid">
                  <div><small>Nombre</small><strong>{selectedSale.customer}</strong></div>
                  <div><small>{selectedSale.documentType}</small><strong>{selectedSale.documentNumber}</strong></div>
                  <div><small>Condición IVA</small><strong>{selectedSale.documentType === 'CUIT' ? 'Responsable inscripto' : selectedSale.documentType === 'DNI' ? 'Consumidor final' : 'Pendiente de consultar'}</strong></div>
                  <div><small>Cuenta</small><strong>{account.nickname || 'CR Argentina'}</strong></div>
                </div>
              </div>

              <div className="detail-block">
                <div className="section-label">Resumen</div>
                {(selectedSale.items?.length ? selectedSale.items : [{ title: 'Producto Mercado Libre', quantity: 1 }]).map((item, index) => (
                  <div className="product-line" key={`${item.id || 'item'}-${index}`}>
                    <div className="product-thumb">ML</div>
                    <div><strong>{item.title}</strong><small>{item.quantity || 1} unidad{item.quantity === 1 ? '' : 'es'}</small></div>
                    <strong>{item.unitPrice ? formatCurrency(item.unitPrice * (item.quantity || 1)) : ''}</strong>
                  </div>
                ))}
                <div className="total-line"><span>Total de la operación</span><strong>{formatCurrency(selectedSale.total)}</strong></div>
              </div>

              <div className="detail-block activity-block">
                <div className="section-label">Actividad</div>
                <div className="activity-item"><span className="activity-dot" /><div><strong>Venta recibida</strong><small>Mercado Libre</small></div></div>
                <div className="activity-item muted"><span className="activity-dot" /><div><strong>Esperando facturación</strong><small>Panadero está listo para continuar</small></div></div>
              </div>

              <div className="detail-actions">
                <button className="ghost-button" type="button">Marcar para revisar</button>
                <button className="primary-button wide" type="button">
                  {selectedSale.status === 'invoiced' ? 'Ver factura' : selectedSale.status === 'review' ? 'Revisar datos' : 'Facturar venta'}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-detail">Seleccioná una venta para ver sus detalles.</div>
          )}
        </section>
      </div>
    </main>
  )
}

export default Home
