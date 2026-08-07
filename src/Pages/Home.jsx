import { useCallback, useEffect, useMemo, useState } from 'react'
import Topbar from '../components/Topbar'
import SalesTable, { formatCurrency } from '../components/SalesTable'
import { sales as demoSales } from '../Data/Sales'

const API_BASE = 'https://api.panaderoapp.com/api'
const ARCA_POINT_OF_SALE = 3

const filters = [
  ['all', 'Todas'],
  ['ready', 'Pendientes'],
  ['invoiced', 'Facturadas'],
  ['review', 'Revisar'],
]

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, credentials: 'include' })
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

function automaticInvoiceType(documentType, documentNumber) {
  const digits = String(documentNumber || '').replace(/\D/g, '')
  return String(documentType || '').toUpperCase() === 'CUIT' && digits.length === 11
    ? 'A'
    : 'B'
}

function invoiceTypeLabel(value) {
  if (value === 'A') return 'Factura A'
  if (value === 'B') return 'Factura B · Consumidor final'
  return 'Automático'
}

function normalizeSaleStatus(sale, invoiceMap = {}) {
  const orderId = String(sale?.id || '')
  const hasPanaderoInvoice = Boolean(invoiceMap[orderId])
  const hasMercadoLibreInvoice = Boolean(
    sale?.invoiceAttached
    || sale?.invoiceDocuments?.length
    || sale?.invoiceSource === 'mercadolibre',
  )

  if (hasPanaderoInvoice || hasMercadoLibreInvoice) {
    return {
      ...sale,
      status: 'invoiced',
      statusLabel: 'Facturada',
      invoiceAttached: hasMercadoLibreInvoice || Boolean(sale?.invoiceAttached),
      invoiceSource: hasPanaderoInvoice ? 'panadero' : sale?.invoiceSource || 'mercadolibre',
    }
  }

  return sale
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
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [totalSales, setTotalSales] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [invoiceTypes, setInvoiceTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('panadero-invoice-types') || '{}') } catch { return {} }
  })
  const [invoiceVatRates, setInvoiceVatRates] = useState(() => {
    try { return JSON.parse(localStorage.getItem('panadero-invoice-vat-rates') || '{}') } catch { return {} }
  })
  const [saleInvoices, setSaleInvoices] = useState({})
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoicePreparing, setInvoicePreparing] = useState(false)
  const [invoiceError, setInvoiceError] = useState('')
  const [invoiceModal, setInvoiceModal] = useState(null)

  const loadConnection = useCallback(async () => {
    try {
      const status = await api('/mercadolibre/status')
      setAccount({
        connected: status.connected,
        nickname: status.account?.nickname || '',
        ...status.account,
      })

      if (status.connected) {
        const [orderPayload, invoicePayload] = await Promise.all([
          api('/mercadolibre/orders'),
          api('/arca/sale-invoices').catch(() => ({ invoices: [] })),
        ])

        const invoiceMap = Object.fromEntries(
          (invoicePayload.invoices || []).map((invoice) => [String(invoice.orderId), invoice]),
        )
        setSaleInvoices(invoiceMap)
        if (orderPayload.orders?.length) {
          setSales(
            orderPayload.orders.map((sale) => normalizeSaleStatus(sale, invoiceMap)),
          )
          setSelectedSaleId(orderPayload.orders[0]?.id || '')
        }
        setPage(Number(orderPayload.page || 1))
        setTotalSales(Number(orderPayload.total || orderPayload.orders?.length || 0))
        setTotalPages(Number(orderPayload.totalPages || 1))
        localStorage.setItem('panadero-total-sales', String(orderPayload.total || orderPayload.orders?.length || 0))
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
    localStorage.setItem('panadero-invoice-types', JSON.stringify(invoiceTypes))
  }, [invoiceTypes])

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
    sales.find((sale) => String(sale.id) === String(selectedSaleId)) || visibleSales[0]

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

    const totalDeductions = marketplaceFees + shippingCost + taxes
    const commissionPercent = total > 0 ? (marketplaceFees / total) * 100 : 0
    const netPercent = total > 0 ? Math.max(0, Math.min(100, (netAmount / total) * 100)) : 0

    return {
      total,
      marketplaceFees,
      shippingCost,
      taxes,
      totalDeductions,
      commissionPercent,
      netPercent,
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

  const loadPage = async (targetPage, showNotice = false) => {
    setLoading(true)
    setNotice('')
    try {
      const result = await api(`/mercadolibre/sync?page=${targetPage}&pageSize=${pageSize}`, { method: 'POST' })
      setSales(
        (result.orders || []).map((sale) => normalizeSaleStatus(sale, saleInvoices)),
      )
      setPage(Number(result.page || targetPage))
      setTotalSales(Number(result.total || 0))
      setTotalPages(Number(result.totalPages || 1))
      setSelectedSaleId(result.orders?.[0]?.id || '')
      localStorage.setItem('panadero-total-sales', String(result.total || 0))
      if (showNotice) setNotice(`Página ${result.page || targetPage} actualizada: ${result.orders?.length || 0} ventas.`)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = () => loadPage(page, true)
  const handlePageChange = (targetPage) => {
    if (targetPage < 1 || targetPage > totalPages || targetPage === page || loading) return
    loadPage(targetPage)
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
      setPage(1)
      setTotalSales(0)
      setTotalPages(1)
      localStorage.setItem('panadero-total-sales', '0')
      setNotice('Cuenta desconectada.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleInvoiceSale = async () => {
    if (!selectedSale || !orderDetail || invoiceLoading || invoicePreparing) return

    const orderId = String(selectedSale.id)
    const existingInvoice = saleInvoices[orderId]

    if (existingInvoice) {
      setNotice(
        `Esta venta ya fue facturada como ${existingInvoice.voucher?.formattedNumber || 'comprobante autorizado'}.`,
      )
      return
    }

    const amount = financials?.total || selectedSale.total
    const selectedType = invoiceTypes[selectedSale.id] || 'automatic'
    const resolvedType =
      selectedType === 'automatic'
        ? automaticInvoiceType(
            orderDetail?.buyer?.documentType,
            orderDetail?.buyer?.documentNumber,
          )
        : selectedType

    const documentLabel = [
      orderDetail?.buyer?.documentType,
      orderDetail?.buyer?.documentNumber,
    ].filter(Boolean).join(' ') || 'Consumidor final'

    setInvoicePreparing(true)
    setInvoiceError('')
    try {
      const voucherType = resolvedType === 'A' ? 1 : 6
      const sequence = await api(
        `/arca/last-voucher?pointOfSale=${ARCA_POINT_OF_SALE}&voucherType=${voucherType}`,
      )

      setInvoiceModal({
        orderId,
        amount,
        selectedType,
        resolvedType,
        documentLabel,
        customer:
          orderDetail?.buyer?.name ||
          selectedSale.customer ||
          'Cliente de Mercado Libre',
        vatRate: selectedVatRate,
        pointOfSale: ARCA_POINT_OF_SALE,
        nextVoucherNumber: sequence.nextVoucherNumber,
        nextFormattedNumber: `${String(ARCA_POINT_OF_SALE).padStart(4, '0')}-${String(sequence.nextVoucherNumber).padStart(8, '0')}`,
      })
    } catch (error) {
      setInvoiceError(`No se pudo consultar la próxima numeración: ${error.message}`)
    } finally {
      setInvoicePreparing(false)
    }
  }

  const closeInvoiceModal = () => {
    if (!invoiceLoading) setInvoiceModal(null)
  }

  const confirmInvoiceSale = async () => {
    if (!invoiceModal || invoiceLoading) return

    const { orderId, selectedType, vatRate } = invoiceModal

    setInvoiceLoading(true)
    setInvoiceError('')
    setNotice('')

    try {
      const payload = await api('/arca/sale-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          invoiceType: selectedType,
          vatRate,
          confirmation: `EMITIR_VENTA_${orderId}`,
        }),
      })

      const invoice = payload.invoice
      setSaleInvoices((current) => ({ ...current, [orderId]: invoice }))
      setSales((current) =>
        current.map((sale) =>
          String(sale.id) === orderId
            ? { ...sale, status: 'invoiced', statusLabel: 'Facturada' }
            : sale,
        ),
      )
      setInvoiceModal(null)
      setNotice(
        `Venta facturada correctamente: ${invoice?.voucher?.formattedNumber || 'comprobante autorizado'}.`,
      )
    } catch (error) {
      setInvoiceError(error.message)
    } finally {
      setInvoiceLoading(false)
    }
  }

  const marketplaceBuyer = orderDetail?.buyer || {}
  const fiscalBuyer = orderDetail?.fiscalBuyer || null
  const detailName = fiscalBuyer?.name || marketplaceBuyer?.name || selectedSale?.customer
  const documentType = marketplaceBuyer?.documentType || selectedSale?.documentType
  const documentNumber = marketplaceBuyer?.documentNumber || selectedSale?.documentNumber
  const fiscalAddress = fiscalBuyer?.address || null
  const detailItems = orderDetail?.items?.length ? orderDetail.items : selectedSale?.items || []
  const address = orderDetail?.address
  const primaryPayment = orderDetail?.payments?.[0]
  const selectedInvoice = selectedSale ? saleInvoices[String(selectedSale.id)] : null
  const selectedSaleAlreadyInvoiced = Boolean(
    selectedSale?.status === 'invoiced'
    || selectedSale?.invoiceAttached
    || selectedSale?.invoiceDocuments?.length
    || selectedInvoice,
  )
  const selectedInvoiceType = selectedSale
    ? invoiceTypes[selectedSale.id] || 'automatic'
    : 'automatic'
  const recommendedInvoiceType = automaticInvoiceType(documentType, documentNumber)
  const selectedVatRate = selectedSale
    ? Number(invoiceVatRates[selectedSale.id] || 21)
    : 21
  const selectedInvoicePdfUrl = selectedInvoice
    ? `${API_BASE}/arca/sale-invoices/${encodeURIComponent(String(selectedSale.id))}/pdf`
    : ''

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
            <small>{totalSales || visibleSales.length} ventas · página {page} de {totalPages}</small>
          </div>

          <SalesTable
            sales={visibleSales}
            selectedSaleId={selectedSale?.id}
            onSelectSale={setSelectedSaleId}
          />

          <div className="pagination-bar">
            <div className="pagination-left">
              <button
                type="button"
                className="ghost-button"
                onClick={() => handlePageChange(1)}
                disabled={page <= 1 || loading}
              >
                ⇤ Primera
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1 || loading}
              >
                ← Anterior
              </button>
            </div>
            <span>Página <strong>{page}</strong> de <strong>{totalPages}</strong></span>
            <button type="button" className="ghost-button" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages || loading}>Siguiente →</button>
          </div>
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
                  <div><small>Razón social / Nombre fiscal</small><strong>{textOrDash(detailName)}</strong></div>
                  <div><small>{textOrDash(documentType)}</small><strong>{textOrDash(documentNumber)}</strong></div>
                  <div><small>Condición IVA</small><strong>{textOrDash(fiscalBuyer?.vatCondition || (documentType === 'DNI' ? 'Consumidor final' : 'Pendiente de consultar'))}</strong></div>
                  <div><small>Domicilio fiscal ARCA</small><strong>{textOrDash(fiscalAddress?.addressLine)}</strong></div>
                  <div><small>Localidad fiscal</small><strong>{textOrDash([fiscalAddress?.city, fiscalAddress?.state].filter(Boolean).join(', '))}</strong></div>
                  <div><small>Cuenta vendedora</small><strong>{account.nickname || 'CR Argentina'}</strong></div>
                </div>
              </div>

              <div className="detail-block product-detail-block">
                <div className="section-label">Producto</div>
                {(detailItems.length ? detailItems : [{ title: 'Producto Mercado Libre', quantity: 1 }]).map((item, index) => (
                  <div className="product-line" key={`${item.id || 'item'}-${index}`}>
                    <div className="product-thumb">ML</div>
                    <div className="product-copy">
                      <strong>{item.title}</strong>
                      <small>{item.quantity || 1} unidad{item.quantity === 1 ? '' : 'es'}</small>
                    </div>
                    <strong className="product-price">{item.unitPrice ? formatCurrency(item.unitPrice * (item.quantity || 1)) : ''}</strong>
                  </div>
                ))}
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
                <div className="section-label">Dinero de la operación</div>
                <div className="financial-card">
                  <div className="financial-hero">
                    <div>
                      <span>Total pagado por el comprador</span>
                      <strong>{formatCurrency(financials?.total || selectedSale.total)}</strong>
                    </div>
                    <span className="financial-currency">ARS</span>
                  </div>

                  <div className="financial-progress" aria-label="Distribución del dinero">
                    <span style={{ width: `${financials?.netPercent || 100}%` }} />
                  </div>

                  <div className="financial-caption">
                    <span>{(financials?.netPercent || 100).toFixed(1)}% queda en la cuenta</span>
                    <span>{(100 - (financials?.netPercent || 100)).toFixed(1)}% descuentos</span>
                  </div>

                  <div className="financial-rows">
                    <div>
                      <span>Comisión de Mercado Libre <small>{financials?.commissionPercent ? `${financials.commissionPercent.toFixed(1)}%` : ''}</small></span>
                      <strong className="money-negative">− {formatCurrency(financials?.marketplaceFees || 0)}</strong>
                    </div>
                    <div>
                      <span>Costo de envío a tu cargo</span>
                      <strong className="money-negative">− {formatCurrency(financials?.shippingCost || 0)}</strong>
                    </div>
                    <div>
                      <span>Impuestos informados</span>
                      <strong className="money-negative">− {formatCurrency(financials?.taxes || 0)}</strong>
                    </div>
                    <div className="financial-deductions">
                      <span>Descuentos totales</span>
                      <strong>− {formatCurrency(financials?.totalDeductions || 0)}</strong>
                    </div>
                  </div>

                  <div className="financial-net">
                    <div>
                      <span>{financials?.netIsEstimated ? 'Neto estimado' : 'Neto recibido'}</span>
                      <small>Después de comisión, envío e impuestos</small>
                    </div>
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


              <div className="detail-block invoice-type-block">
                <div className="section-label">Tipo de comprobante</div>

                <div className="invoice-control-row">
                  <div className="invoice-control-group">
                    <span className="invoice-control-label">Comprobante</span>
                    <div className="invoice-type-segmented compact" role="group" aria-label="Tipo de comprobante">
                      {[
                        ['automatic', 'Automático'],
                        ['A', 'Factura A'],
                        ['B', 'Factura B'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={selectedInvoiceType === value ? 'active' : ''}
                          onClick={() =>
                            setInvoiceTypes((current) => ({
                              ...current,
                              [selectedSale.id]: value,
                            }))
                          }
                          disabled={selectedSaleAlreadyInvoiced}
                        >
                          <span>{label}</span>
                          {value === 'automatic' && (
                            <small>Recomienda {recommendedInvoiceType}</small>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="invoice-control-group vat-control-group">
                    <span className="invoice-control-label">IVA</span>
                    <div className="vat-rate-segmented" role="group" aria-label="Alícuota de IVA">
                      {[21, 10.5].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          className={selectedVatRate === rate ? 'active' : ''}
                          onClick={() =>
                            setInvoiceVatRates((current) => ({
                              ...current,
                              [selectedSale.id]: rate,
                            }))
                          }
                          disabled={selectedSaleAlreadyInvoiced}
                        >
                          IVA {String(rate).replace('.', ',')}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="invoice-recommendation compact">
                  <span>Recomendación de Panadero</span>
                  <strong>{invoiceTypeLabel(recommendedInvoiceType)}</strong>
                  <small>
                    {recommendedInvoiceType === 'A'
                      ? 'CUIT válido detectado.'
                      : 'Consumidor final.'}
                    {' · '}IVA {String(selectedVatRate).replace('.', ',')}%
                  </small>
                </div>

                <small className="issuer-note">
                  Emisor Responsable Inscripto. Automático elige A con CUIT válido y B en los demás casos.
                </small>
              </div>

              <div className="detail-block activity-block">
                <div className="section-label">Actividad</div>
                <div className="activity-item"><span className="activity-dot" /><div><strong>Venta recibida</strong><small>Mercado Libre</small></div></div>
                {selectedInvoice ? (
                  <>
                    <div className="activity-item invoiced-activity"><span className="activity-dot" /><div><strong>Factura autorizada</strong><small>{selectedInvoice.voucher?.formattedNumber} · CAE {selectedInvoice.cae}</small></div></div>
                    <div className="invoice-issued-actions">
                      <a className="ghost-button" href={selectedInvoicePdfUrl} target="_blank" rel="noreferrer">Vista previa</a>
                      <a className="ghost-button" href={`${selectedInvoicePdfUrl}?download=1`}>Descargar PDF</a>
                    </div>
                  </>
                ) : selectedSale?.invoiceAttached ? (
                  <div className="activity-item invoiced-activity">
                    <span className="activity-dot" />
                    <div>
                      <strong>Factura adjunta en Mercado Libre</strong>
                      <small>
                        {selectedSale.invoiceDocuments?.[0]?.filename
                          || 'Comprobante detectado durante la sincronización'}
                      </small>
                    </div>
                  </div>
                ) : (
                  <div className="activity-item muted"><span className="activity-dot" /><div><strong>Esperando facturación</strong><small>Panadero está listo para continuar</small></div></div>
                )}
              </div>

              {invoiceError && <div className="invoice-action-error">{invoiceError}</div>}

              <div className="detail-actions">
                <button className="ghost-button" type="button">Marcar para revisar</button>
                <button
                  className="primary-button wide"
                  type="button"
                  onClick={handleInvoiceSale}
                  disabled={invoiceLoading || invoicePreparing || detailLoading || !orderDetail || selectedSaleAlreadyInvoiced}
                >
                  {selectedInvoice
                    ? `Facturada · ${selectedInvoice.voucher?.formattedNumber || ''}`
                    : selectedSale?.invoiceAttached
                      ? 'Facturada en Mercado Libre'
                    : invoicePreparing
                      ? 'Consultando numeración…'
                      : invoiceLoading
                        ? 'Solicitando CAE…'
                      : selectedSale.status === 'review'
                        ? 'Revisar datos'
                        : 'Facturar venta'}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-detail">Seleccioná una venta para ver sus detalles.</div>
          )}
        </section>
      </div>

      {invoiceModal && (
        <div
          className="invoice-modal-backdrop"
          role="presentation"
          onMouseDown={closeInvoiceModal}
        >
          <section
            className="invoice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="invoice-modal-header">
              <div>
                <span>Confirmación fiscal</span>
                <h3 id="invoice-modal-title">Emitir {invoiceTypeLabel(invoiceModal.resolvedType)}</h3>
              </div>
              <button
                type="button"
                className="invoice-modal-close"
                onClick={closeInvoiceModal}
                disabled={invoiceLoading}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="invoice-modal-summary">
              <div>
                <small>Cliente</small>
                <strong>{invoiceModal.customer}</strong>
              </div>
              <div>
                <small>Documento</small>
                <strong>{invoiceModal.documentLabel}</strong>
              </div>
              <div>
                <small>Venta Mercado Libre</small>
                <strong>#{invoiceModal.orderId}</strong>
              </div>
              <div>
                <small>Alícuota de IVA</small>
                <strong>IVA {String(invoiceModal.vatRate).replace('.', ',')}%</strong>
              </div>
            </div>

            <div className="invoice-sequence">
              <div>
                <small>Punto de venta</small>
                <strong>{String(invoiceModal.pointOfSale).padStart(4, '0')} · PANADERO</strong>
              </div>
              <div>
                <small>Próximo comprobante</small>
                <strong>{invoiceModal.nextFormattedNumber}</strong>
              </div>
            </div>

            <div className="invoice-modal-total">
              <span>Importe total</span>
              <strong>{formatCurrency(invoiceModal.amount)}</strong>
            </div>

            <div className="invoice-modal-warning production">
              <strong>ARCA Producción</strong>
              <span>
                Al confirmar, Panadero solicitará el CAE y emitirá un comprobante fiscal real.
                Una factura autorizada no puede eliminarse; una corrección requiere el comprobante correspondiente.
              </span>
            </div>

            {invoiceError && (
              <div className="invoice-modal-error">{invoiceError}</div>
            )}

            <div className="invoice-modal-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={closeInvoiceModal}
                disabled={invoiceLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button invoice-modal-confirm"
                onClick={confirmInvoiceSale}
                disabled={invoiceLoading}
              >
                {invoiceLoading ? 'Solicitando CAE…' : 'Emitir factura'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default Home