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

function textOrDash(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function formatDate(value) {
  if (!value) return 'Actualizada recientemente'
  return new Date(value).toLocaleString('es-AR')
}

function paymentLabel(payment) {
  const methods = {
    debit_card: 'Tarjeta de débito',
    credit_card: 'Tarjeta de crédito',
    account_money: 'Dinero en cuenta',
    bank_transfer: 'Transferencia bancaria',
    ticket: 'Efectivo',
  }

  return methods[payment?.paymentType] || payment?.paymentMethodId || 'Mercado Pago'
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
  const [orderDetail, setOrderDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

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
      setNotice('No se pudo conectar con Panadero API.')
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

  useEffect(() => {
    let cancelled = false

    async function loadOrderDetail() {
      if (!selectedSaleId || !account.connected) {
        setOrderDetail(null)
        setDetailError('')
        return
      }

      setDetailLoading(true)
      setDetailError('')

      try {
        const payload = await api(`/mercadolibre/order/${encodeURIComponent(selectedSaleId)}`)
        if (!cancelled) setOrderDetail(payload.detail || null)
      } catch (error) {
        if (!cancelled) {
          setOrderDetail(null)
          setDetailError(error.message)
        }
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }

    loadOrderDetail()
    return () => {
      cancelled = true
    }
  }, [account.connected, selectedSaleId])

  const visibleSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesFilter = activeFilter === 'all' || sale.status === activeFilter
      const normalizedQuery = query.trim().toLowerCase()
      const matchesQuery =
        !normalizedQuery ||
        String(sale.customer || '').toLowerCase().includes(normalizedQuery) ||
        String(sale.id || '').includes(normalizedQuery) ||
        String(sale.documentNumber || '').toLowerCase().includes(normalizedQuery)

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

  const financials = useMemo(() => {
    const detail = orderDetail
    if (!detail) return null

    const saleFees = (detail.items || []).reduce(
      (sum, item) => sum + Number(item.saleFee || 0),
      0,
    )
    const marketplaceFees = Number(detail.amounts?.marketplaceFees || 0) || saleFees
    const shippingCost = Number(detail.amounts?.shippingCost || 0)
    const taxes = Number(detail.amounts?.taxes || 0)
    const total = Number(detail.amounts?.total || selectedSale?.total || 0)
    const reportedNet = Number(detail.amounts?.netAmount || 0)
    const calculatedNet = total - marketplaceFees - shippingCost - taxes
    const netAmount =
      marketplaceFees > 0 && reportedNet >= total
        ? calculatedNet
        : reportedNet || calculatedNet

    return {
      total,
      marketplaceFees,
      shippingCost,
      taxes,
      netAmount,
      netIsEstimated: marketplaceFees > 0 && reportedNet >= total,
    }
  }, [orderDetail, selectedSale?.total])

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
      setOrderDetail(null)
      setNotice('Cuenta desconectada.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  const detailName = orderDetail?.buyer?.name || selectedSale?.customer
  const documentType = orderDetail?.buyer?.documentType || selectedSale?.documentType
  const documentNumber = orderDetail?.buyer?.documentNumber || selectedSale?.documentNumber
  const detailItems = orderDetail?.items?.length ? orderDetail.items : selectedSale?.items || []
  const address = orderDetail?.address
  const primaryPayment = orderDetail?.payments?.[0]

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
                  <h2>{detailName}</h2>
                </div>
                <button className="icon-button" type="button">•••</button>
              </div>

              <div className="detail-status-row">
                <span className={`status-badge ${selectedSale.status}`}>{selectedSale.statusLabel}</span>
                <small>{formatDate(orderDetail?.dateCreated || selectedSale.dateCreated)}</small>
              </div>

              {detailLoading && (
                <div className="detail-loading">
                  <span className="detail-spinner" />
                  Consultando datos completos en Mercado Libre…
                </div>
              )}

              {detailError && (
                <div className="detail-error">
                  No se pudo cargar el detalle completo: {detailError}
                </div>
              )}

              <div className="detail-block">
                <div className="section-label">Cliente y facturación</div>
                <div className="data-grid">
                  <div><small>Nombre real</small><strong>{textOrDash(detailName)}</strong></div>
                  <div><small>{textOrDash(documentType)}</small><strong>{textOrDash(documentNumber)}</strong></div>
                  <div><small>Teléfono</small><strong>{textOrDash(orderDetail?.buyer?.phone)}</strong></div>
                  <div><small>Condición IVA</small><strong>{documentType === 'CUIT' ? 'Responsable inscripto' : documentType === 'DNI' ? 'Consumidor final' : 'Pendiente de consultar'}</strong></div>
                  <div><small>Usuario ML</small><strong>{textOrDash(orderDetail?.buyer?.nickname)}</strong></div>
                  <div><small>Cuenta vendedora</small><strong>{account.nickname || 'CR Argentina'}</strong></div>
                </div>
              </div>

              <div className="detail-block">
                <div className="section-label">Entrega</div>
                <div className="address-card">
                  <strong>{textOrDash(address?.addressLine || [address?.streetName, address?.streetNumber].filter(Boolean).join(' '))}</strong>
                  <span>{[address?.city, address?.state].filter(Boolean).join(', ') || 'Localidad pendiente'}</span>
                  <span>{[address?.zipCode && `CP ${address.zipCode}`, address?.country].filter(Boolean).join(' · ')}</span>
                  {address?.comment && <small>Referencia: {address.comment}</small>}
                </div>
              </div>

              <div className="detail-block">
                <div className="section-label">Producto</div>
                {(detailItems.length ? detailItems : [{ title: 'Producto Mercado Libre', quantity: 1 }]).map((item, index) => (
                  <div className="product-line" key={`${item.id || 'item'}-${index}`}>
                    <div className="product-thumb">ML</div>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.quantity || 1} unidad{item.quantity === 1 ? '' : 'es'}</small>
                    </div>
                    <strong>{item.unitPrice ? formatCurrency(item.unitPrice * (item.quantity || 1)) : ''}</strong>
                  </div>
                ))}
              </div>

              <div className="detail-block">
                <div className="section-label">Dinero de la operación</div>
                <div className="money-breakdown">
                  <div><span>Total pagado</span><strong>{formatCurrency(financials?.total || selectedSale.total)}</strong></div>
                  <div><span>Comisión de Mercado Libre</span><strong className="money-negative">− {formatCurrency(financials?.marketplaceFees || 0)}</strong></div>
                  <div><span>Costo de envío a tu cargo</span><strong className="money-negative">− {formatCurrency(financials?.shippingCost || 0)}</strong></div>
                  <div><span>Impuestos informados</span><strong className="money-negative">− {formatCurrency(financials?.taxes || 0)}</strong></div>
                  <div className="money-net">
                    <span>{financials?.netIsEstimated ? 'Neto estimado' : 'Neto recibido'}</span>
                    <strong>{formatCurrency(financials?.netAmount || selectedSale.total)}</strong>
                  </div>
                </div>
                {financials?.netIsEstimated && (
                  <small className="financial-note">Estimado con la comisión informada en los productos de la venta.</small>
                )}
              </div>

              <div className="detail-block">
                <div className="section-label">Pago</div>
                <div className="data-grid">
                  <div><small>Medio</small><strong>{paymentLabel(primaryPayment)}</strong></div>
                  <div><small>Estado</small><strong>{textOrDash(primaryPayment?.status || orderDetail?.status)}</strong></div>
                  <div><small>Cuotas</small><strong>{primaryPayment?.installments || 1}</strong></div>
                  <div><small>ID de pago</small><strong>{textOrDash(primaryPayment?.id)}</strong></div>
                </div>
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