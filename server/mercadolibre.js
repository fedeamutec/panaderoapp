import crypto from 'node:crypto'
import { readStore, updateStore } from './store.js'

const AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization'
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const API_URL = 'https://api.mercadolibre.com'

function config() {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  const redirectUri = process.env.ML_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri || clientSecret.includes('PEGAR_ACA')) {
    throw new Error('Falta completar ML_CLIENT_ID, ML_CLIENT_SECRET o ML_REDIRECT_URI en .env')
  }

  return { clientId, clientSecret, redirectUri }
}

async function requestToken(params) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      payload.message
      || payload.error_description
      || 'Mercado Libre rechazó el token'
    )
  }

  return payload
}

export async function createAuthorizationUrl() {
  const { clientId, redirectUri } = config()
  const state = crypto.randomBytes(24).toString('hex')
  const expiresAt = Date.now() + 10 * 60 * 1000

  await updateStore((store) => ({
    ...store,
    states: { ...store.states, [state]: expiresAt },
  }))

  const url = new URL(AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)

  return url.toString()
}

export async function exchangeAuthorizationCode(code, state) {
  const store = await readStore()
  const validUntil = store.states?.[state]

  if (!state || !validUntil || validUntil < Date.now()) {
    throw new Error('La autorización venció o no pertenece a Panadero')
  }

  const { clientId, clientSecret, redirectUri } = config()

  const token = await requestToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })

  const account = await apiFetch('/users/me', token.access_token)
  const connectedAt = new Date().toISOString()

  await updateStore((current) => {
    const states = { ...current.states }
    delete states[state]

    return {
      ...current,
      states,
      account: {
        id: String(account.id),
        nickname: account.nickname || account.first_name || `Usuario ${account.id}`,
        firstName: account.first_name || '',
        lastName: account.last_name || '',
        email: account.email || '',
        connectedAt,
      },
      tokens: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Number(token.expires_in || 21600) * 1000,
      },
    }
  })
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = config()

  const token = await requestToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  })

  await updateStore((store) => ({
    ...store,
    tokens: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || refreshToken,
      expiresAt: Date.now() + Number(token.expires_in || 21600) * 1000,
    },
  }))

  return token.access_token
}

async function getAccessToken() {
  const store = await readStore()

  if (!store.tokens?.accessToken) {
    throw new Error('Mercado Libre no está conectado')
  }

  if (store.tokens.expiresAt > Date.now() + 60_000) {
    return store.tokens.accessToken
  }

  if (!store.tokens.refreshToken) {
    throw new Error('El token venció y no hay refresh token')
  }

  return refreshAccessToken(store.tokens.refreshToken)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mercadoLibreError(payload, status) {
  const error = new Error(
    payload?.message
    || payload?.error
    || `Error de Mercado Libre (${status})`
  )
  error.status = status
  return error
}

async function apiFetch(pathname, suppliedToken, { retries = 3 } = {}) {
  const token = suppliedToken || await getAccessToken()

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${API_URL}${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    const payload = await response.json().catch(() => ({}))

    if (response.ok) return payload

    if (response.status === 429 && attempt < retries) {
      const retryAfterHeader = Number(response.headers.get('retry-after'))
      const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : Math.min(15_000, 1_500 * (2 ** attempt))
      await sleep(retryAfterMs)
      continue
    }

    throw mercadoLibreError(payload, response.status)
  }

  throw new Error('Mercado Libre no respondió después de varios intentos.')
}

function fiscalDocumentReference(order = {}) {
  return String(order.pack_id || order.id || '').trim()
}

async function readFiscalDocumentsForOrder(order, suppliedToken) {
  const packId = fiscalDocumentReference(order)
  const checkedAt = new Date().toISOString()

  if (!packId) {
    return {
      packId: null,
      invoiceAttached: false,
      invoiceDocuments: [],
      invoiceCheckedAt: checkedAt,
      invoiceCheckError: 'La venta no tiene order_id ni pack_id.',
    }
  }

  const token = suppliedToken || await getAccessToken()
  const endpoint = `/packs/${encodeURIComponent(packId)}/fiscal_documents`

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    const payload = await response.json().catch(() => ({}))

    if (response.status === 429) {
      throw mercadoLibreError(payload, 429)
    }

    // Mercado Libre responde 404 cuando el pack no tiene factura cargada.
    if (response.status === 404) {
      return {
        packId,
        invoiceAttached: false,
        invoiceDocuments: [],
        invoiceCheckedAt: checkedAt,
        invoiceCheckError: null,
      }
    }

    if (!response.ok) {
      return {
        packId,
        invoiceAttached: false,
        invoiceDocuments: [],
        invoiceCheckedAt: checkedAt,
        invoiceCheckError:
          payload.message
          || payload.error
          || `No se pudo consultar la factura (${response.status}).`,
      }
    }

    const documents = Array.isArray(payload.fiscal_documents)
      ? payload.fiscal_documents.map((document) => ({
          id: String(document.id || ''),
          date: document.date || null,
          fileType: document.file_type || null,
          filename: document.filename || null,
        }))
      : []

    return {
      packId: String(payload.pack_id || packId),
      invoiceAttached: documents.length > 0,
      invoiceDocuments: documents,
      invoiceCheckedAt: checkedAt,
      invoiceCheckError: null,
    }
  } catch (error) {
    if (error?.status === 429) throw error
    return {
      packId,
      invoiceAttached: false,
      invoiceDocuments: [],
      invoiceCheckedAt: checkedAt,
      invoiceCheckError: error.message,
    }
  }
}

function normalizeOrder(order, fiscalInfo = {}) {
  const buyerName = [
    order.buyer?.first_name,
    order.buyer?.last_name,
  ].filter(Boolean).join(' ')

  const customer =
    buyerName
    || order.buyer?.nickname
    || `Comprador ${order.buyer?.id || ''}`.trim()

  const paid = order.status === 'paid'
  const invoiced = Boolean(fiscalInfo.invoiceAttached)

  return {
    id: String(order.id),
    packId: fiscalInfo.packId || fiscalDocumentReference(order) || null,
    accountId: 'mercadolibre',
    customer,
    documentType: '',
    documentNumber: '',
    total: Number(order.total_amount || order.paid_amount || 0),

    // La factura informada por Mercado Libre tiene prioridad sobre el estado de pago.
    status: invoiced ? 'invoiced' : paid ? 'ready' : 'review',
    statusLabel: invoiced ? 'Facturada' : paid ? 'Lista para facturar' : 'Revisar',

    invoiceAttached: invoiced,
    invoiceSource: invoiced ? 'mercadolibre' : null,
    invoiceDocuments: fiscalInfo.invoiceDocuments || [],
    invoiceCheckedAt: fiscalInfo.invoiceCheckedAt || null,
    invoiceCheckError: fiscalInfo.invoiceCheckError || null,

    dateCreated: order.date_created || null,
    marketplaceStatus: order.status || '',
    items: (order.order_items || []).map((entry) => ({
      id: String(entry.item?.id || ''),
      title: entry.item?.title || 'Producto Mercado Libre',
      quantity: Number(entry.quantity || 1),
      unitPrice: Number(entry.unit_price || 0),
      variationId: entry.item?.variation_id || null,
    })),
  }
}

function sumPaymentFees(payments) {
  return payments.reduce((total, payment) => {
    const paymentFees = Array.isArray(payment.fee_details)
      ? payment.fee_details.reduce(
          (subtotal, fee) => subtotal + Number(fee.amount || 0),
          0
        )
      : 0

    return total + paymentFees
  }, 0)
}

function buildOrderDetail(order, shipment, billingInfo, fiscalInfo = {}) {
  const payments = Array.isArray(order.payments) ? order.payments : []
  const receiverAddress =
    shipment?.receiver_address
    || order.shipping?.receiver_address
    || null

  const billingAddress =
    billingInfo?.billing_info?.additional_info
    || billingInfo?.additional_info
    || null

  const buyerName = [
    billingInfo?.billing_info?.name,
    billingInfo?.name,
    order.buyer?.first_name,
    order.buyer?.last_name,
  ].filter(Boolean).join(' ').trim()

  const documentType =
    billingInfo?.billing_info?.doc_type
    || billingInfo?.doc_type
    || 'Sin datos'

  const documentNumber =
    billingInfo?.billing_info?.doc_number
    || billingInfo?.doc_number
    || 'Sin datos'

  const phone =
    receiverAddress?.receiver_phone
    || receiverAddress?.phone
    || order.buyer?.phone?.number
    || null

  const marketplaceFees = sumPaymentFees(payments)

  const shippingCost = Number(
    shipment?.shipping_option?.cost
      ?? shipment?.base_cost
      ?? order.shipping?.cost
      ?? 0
  )

  const taxes = Number(order.taxes?.amount || 0)
  const total = Number(order.total_amount || order.paid_amount || 0)

  const netAmount = payments.reduce((sum, payment) => {
    if (payment.transaction_amount_refunded) {
      return (
        sum
        + Number(payment.transaction_amount || 0)
        - Number(payment.transaction_amount_refunded || 0)
      )
    }

    return sum + Number(
      payment.net_received_amount
      ?? payment.transaction_amount
      ?? 0
    )
  }, 0)

  return {
    id: String(order.id),
    packId: fiscalInfo.packId || fiscalDocumentReference(order) || null,
    status: order.status || '',
    dateCreated: order.date_created || null,

    invoiceAttached: Boolean(fiscalInfo.invoiceAttached),
    invoiceSource: fiscalInfo.invoiceAttached ? 'mercadolibre' : null,
    invoiceDocuments: fiscalInfo.invoiceDocuments || [],
    invoiceCheckedAt: fiscalInfo.invoiceCheckedAt || null,
    invoiceCheckError: fiscalInfo.invoiceCheckError || null,

    buyer: {
      id: order.buyer?.id ? String(order.buyer.id) : null,
      nickname: order.buyer?.nickname || null,
      name: buyerName || order.buyer?.nickname || 'Sin datos',
      documentType,
      documentNumber: String(documentNumber),
      phone,
      email: order.buyer?.email || null,
    },

    address: receiverAddress
      ? {
          addressLine: receiverAddress.address_line || null,
          streetName: receiverAddress.street_name || null,
          streetNumber: receiverAddress.street_number || null,
          comment: receiverAddress.comment || null,
          zipCode: receiverAddress.zip_code || null,
          city: receiverAddress.city?.name || null,
          state: receiverAddress.state?.name || null,
          country: receiverAddress.country?.name || null,
          latitude: receiverAddress.latitude ?? null,
          longitude: receiverAddress.longitude ?? null,
        }
      : null,

    billingAddress,

    items: (order.order_items || []).map((entry) => ({
      id: String(entry.item?.id || ''),
      title: entry.item?.title || 'Producto Mercado Libre',
      quantity: Number(entry.quantity || 1),
      unitPrice: Number(entry.unit_price || 0),
      fullUnitPrice: Number(
        entry.full_unit_price
        || entry.unit_price
        || 0
      ),
      saleFee: Number(entry.sale_fee || 0),
      variationId: entry.item?.variation_id || null,
    })),

    amounts: {
      total,
      paid: Number(order.paid_amount || 0),
      shippingCost,
      marketplaceFees,
      taxes,
      netAmount,
    },

    payments: payments.map((payment) => ({
      id: payment.id ? String(payment.id) : null,
      status: payment.status || null,
      paymentType: payment.payment_type || null,
      paymentMethodId: payment.payment_method_id || null,
      installments: Number(payment.installments || 0),
      transactionAmount: Number(payment.transaction_amount || 0),
      totalPaidAmount: Number(payment.total_paid_amount || 0),
      netReceivedAmount: Number(payment.net_received_amount || 0),
      fees: Array.isArray(payment.fee_details)
        ? payment.fee_details
        : [],
    })),
  }
}


export async function uploadFiscalDocument(orderId, pdfBuffer, filename = 'factura.pdf') {
  const normalizedOrderId = String(orderId || '').trim()
  if (!normalizedOrderId) throw new Error('Falta el ID de la venta')
  if (!pdfBuffer) throw new Error('Falta el PDF de la factura')

  const bytes = Buffer.isBuffer(pdfBuffer)
    ? pdfBuffer
    : Buffer.from(pdfBuffer)

  if (!bytes.length) throw new Error('El PDF de la factura está vacío')
  if (bytes.length > 1024 * 1024) {
    throw new Error('Mercado Libre admite facturas PDF de hasta 1 MB')
  }

  const safeOrderId = encodeURIComponent(normalizedOrderId)
  const order = await apiFetch(`/orders/${safeOrderId}`)
  const packId = fiscalDocumentReference(order)

  if (!packId) {
    throw new Error('La venta no tiene order_id ni pack_id para adjuntar la factura')
  }

  const currentFiscalInfo = await readFiscalDocumentsForOrder(order)
  if (currentFiscalInfo.invoiceAttached) {
    return {
      ok: true,
      uploaded: false,
      alreadyAttached: true,
      packId,
      ids: currentFiscalInfo.invoiceDocuments.map((document) => document.id),
      documents: currentFiscalInfo.invoiceDocuments,
    }
  }

  const token = await getAccessToken()
  const form = new FormData()
  const safeFilename = String(filename || 'factura.pdf')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')

  form.append(
    'fiscal_document',
    new Blob([bytes], { type: 'application/pdf' }),
    safeFilename,
  )

  const response = await fetch(
    `${API_URL}/packs/${encodeURIComponent(packId)}/fiscal_documents`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    },
  )

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      payload.message
      || payload.error
      || `Mercado Libre rechazó la factura (${response.status})`
    )
  }

  const ids = Array.isArray(payload.ids)
    ? payload.ids.map((id) => String(id))
    : []

  return {
    ok: true,
    uploaded: true,
    alreadyAttached: false,
    packId,
    ids,
  }
}

const SYNC_PAGE_SIZE = 50
const RECENT_DETAIL_COUNT = 50
const RECENT_DETAIL_CONCURRENCY = 2
const RECENT_DETAIL_DELAY_MS = 350

function detailFromStoredOrder(order = {}) {
  return {
    id: String(order.id || ''),
    packId: order.packId || null,
    status: order.marketplaceStatus || '',
    dateCreated: order.dateCreated || null,
    invoiceAttached: Boolean(order.invoiceAttached),
    invoiceSource: order.invoiceSource || null,
    invoiceDocuments: order.invoiceDocuments || [],
    invoiceCheckedAt: order.invoiceCheckedAt || null,
    invoiceCheckError: order.invoiceCheckError || null,
    buyer: {
      id: null,
      nickname: null,
      name: order.customer || 'Sin datos',
      documentType: order.documentType || '',
      documentNumber: String(order.documentNumber || ''),
      phone: null,
      email: null,
    },
    address: null,
    billingAddress: null,
    items: order.items || [],
    amounts: {
      total: Number(order.total || 0),
      paid: Number(order.total || 0),
      shippingCost: 0,
      marketplaceFees: 0,
      taxes: 0,
      netAmount: Number(order.total || 0),
    },
    payments: [],
    syncedAt: null,
    partial: true,
  }
}

async function fetchOrderDetailFromMercadoLibre(order, token) {
  const safeOrderId = encodeURIComponent(String(order.id))
  let shipment = null
  let billingInfo = null

  if (order.shipping?.id) {
    try {
      shipment = await apiFetch(
        `/shipments/${encodeURIComponent(String(order.shipping.id))}`,
        token,
        { retries: 1 },
      )
    } catch (error) {
      if (error?.status === 429) throw error
      shipment = null
    }
  }

  try {
    billingInfo = await apiFetch(`/orders/${safeOrderId}/billing_info`, token, { retries: 1 })
  } catch (error) {
    if (error?.status === 429) throw error
    billingInfo = null
  }

  let fiscalInfo = {}
  try {
    fiscalInfo = await readFiscalDocumentsForOrder(order, token)
  } catch (error) {
    if (error?.status === 429) throw error
    fiscalInfo = {}
  }

  const detail = buildOrderDetail(order, shipment, billingInfo, fiscalInfo)
  detail.syncedAt = new Date().toISOString()
  detail.partial = false
  return { detail, fiscalInfo }
}

async function mapRecentWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length)
  let cursor = 0
  let stoppedByRateLimit = false

  async function worker() {
    while (cursor < values.length && !stoppedByRateLimit) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await mapper(values[index], index)
      } catch (error) {
        if (error?.status === 429) {
          stoppedByRateLimit = true
          results[index] = { rateLimited: true, error }
          return
        }
        results[index] = { error }
      }
      await sleep(RECENT_DETAIL_DELAY_MS)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length || 1) }, () => worker()))
  return { results, rateLimited: stoppedByRateLimit }
}

export async function getFiscalDocuments(orderId) {
  if (!orderId) throw new Error('Falta el ID de la venta')
  const store = await readStore()
  const id = String(orderId)
  const detail = store.details?.[id]
  const order = (store.orders || []).find((item) => String(item.id) === id)

  if (!detail && !order) throw new Error('La venta todavía no fue sincronizada.')

  return {
    packId: detail?.packId || order?.packId || null,
    invoiceAttached: Boolean(detail?.invoiceAttached || order?.invoiceAttached),
    invoiceDocuments: detail?.invoiceDocuments || order?.invoiceDocuments || [],
    invoiceCheckedAt: detail?.invoiceCheckedAt || order?.invoiceCheckedAt || null,
    invoiceCheckError: detail?.invoiceCheckError || order?.invoiceCheckError || null,
  }
}

export async function getOrderDetail(orderId) {
  if (!orderId) throw new Error('Falta el ID de la venta')

  const store = await readStore()
  const id = String(orderId)
  const detail = store.details?.[id]
  if (detail) return { detail, cached: true }

  const order = (store.orders || []).find((item) => String(item.id) === id)
  if (!order) throw new Error('La venta todavía no fue sincronizada.')

  return {
    detail: detailFromStoredOrder(order),
    cached: true,
    partial: true,
  }
}

export async function getStatus() {
  const store = await readStore()

  return {
    connected: Boolean(store.account && store.tokens?.accessToken),
    account: store.account,
    orderCount: store.orders?.length || 0,
    lastSyncAt: store.lastSyncAt || null,
  }
}

// Sincronización diaria: descarga el índice COMPLETO de ventas con pocas llamadas
// (50 por página) y solo completa datos fiscales/entrega para las 50 más recientes.
// Navegar o abrir ventas después de esto NO vuelve a llamar a Mercado Libre.
export async function syncOrders() {
  const initialStore = await readStore()
  if (!initialStore.account?.id) throw new Error('Mercado Libre no está conectado')

  const token = await getAccessToken()
  const sellerId = String(initialStore.account.id)
  const previousOrders = new Map((initialStore.orders || []).map((order) => [String(order.id), order]))
  const previousDetails = { ...(initialStore.details || {}) }
  const rawOrders = []

  let offset = 0
  let expectedTotal = null

  // Esta fase requiere ~28 requests para 1.378 ventas, no miles.
  while (expectedTotal === null || offset < expectedTotal) {
    const query = new URLSearchParams({
      seller: sellerId,
      sort: 'date_desc',
      limit: String(SYNC_PAGE_SIZE),
      offset: String(offset),
    })

    const result = await apiFetch(`/orders/search?${query.toString()}`, token, { retries: 2 })
    const batch = Array.isArray(result.results) ? result.results : []
    expectedTotal = Number(result.paging?.total ?? batch.length)
    rawOrders.push(...batch)
    if (!batch.length) break
    offset += batch.length
    await sleep(120)
  }

  const rawById = new Map(rawOrders.map((order) => [String(order.id), order]))
  const normalizedOrders = rawOrders.map((raw) => {
    const id = String(raw.id)
    const previous = previousOrders.get(id) || {}
    const previousDetail = previousDetails[id]
    const priorFiscal = {
      packId: previousDetail?.packId || previous.packId || null,
      invoiceAttached: Boolean(previousDetail?.invoiceAttached || previous.invoiceAttached),
      invoiceDocuments: previousDetail?.invoiceDocuments || previous.invoiceDocuments || [],
      invoiceCheckedAt: previousDetail?.invoiceCheckedAt || previous.invoiceCheckedAt || null,
      invoiceCheckError: previousDetail?.invoiceCheckError || previous.invoiceCheckError || null,
    }
    const normalized = normalizeOrder(raw, priorFiscal)

    // Conservamos CUIT/DNI y nombre real ya conocidos en sincronizaciones anteriores.
    normalized.customer = previousDetail?.buyer?.name || previous.customer || normalized.customer
    normalized.documentType = previousDetail?.buyer?.documentType || previous.documentType || ''
    normalized.documentNumber = previousDetail?.buyer?.documentNumber || previous.documentNumber || ''
    return normalized
  })

  const ordersById = new Map(normalizedOrders.map((order) => [String(order.id), order]))
  const recentRaw = rawOrders.slice(0, RECENT_DETAIL_COUNT)

  // Solo las operaciones del día / más recientes se enriquecen con CUIT-DNI,
  // entrega y factura adjunta. Esto reproduce el volumen estable de 50 operaciones.
  const enrichment = await mapRecentWithConcurrency(
    recentRaw,
    RECENT_DETAIL_CONCURRENCY,
    async (raw) => {
      const id = String(raw.id)
      const enriched = await fetchOrderDetailFromMercadoLibre(raw, token)
      previousDetails[id] = enriched.detail

      const normalized = normalizeOrder(raw, enriched.fiscalInfo)
      normalized.customer = enriched.detail.buyer?.name || normalized.customer
      normalized.documentType = enriched.detail.buyer?.documentType || ''
      normalized.documentNumber = enriched.detail.buyer?.documentNumber || ''
      ordersById.set(id, normalized)
      return id
    },
  )

  const lastSyncAt = new Date().toISOString()
  const finalOrders = Array.from(ordersById.values())

  await updateStore((store) => ({
    ...store,
    orders: finalOrders,
    details: previousDetails,
    lastSyncAt,
    pagination: {
      page: 1,
      pageSize: 50,
      total: finalOrders.length,
      totalPages: Math.max(1, Math.ceil(finalOrders.length / 50)),
      offset: 0,
    },
  }))

  const invoiceSummary = finalOrders.reduce((summary, order) => {
    if (order.invoiceAttached) summary.invoiced += 1
    if (order.invoiceCheckError) summary.errors += 1
    return summary
  }, { invoiced: 0, errors: 0 })

  return {
    ok: true,
    orders: finalOrders.slice(0, SYNC_PAGE_SIZE),
    page: 1,
    pageSize: SYNC_PAGE_SIZE,
    total: finalOrders.length,
    totalPages: Math.max(1, Math.ceil(finalOrders.length / SYNC_PAGE_SIZE)),
    lastSyncAt,
    invoiceSummary,
    recentDetailsUpdated: RECENT_DETAIL_COUNT,
    rateLimited: enrichment.rateLimited,
    message: enrichment.rateLimited
      ? 'Ventas sincronizadas. Mercado Libre limitó parte del detalle reciente; Panadero conservó los datos ya guardados.'
      : `Sincronización completa: ${finalOrders.length} ventas. Se actualizaron los datos de las 50 más recientes.`,
  }
}

export async function getOrders({ page = 1, pageSize = 50, query = '', status = 'all' } = {}) {
  const store = await readStore()
  const allOrders = Array.isArray(store.orders) ? store.orders : []
  const normalizedQuery = String(query || '').trim().toLowerCase()
  const normalizedStatus = String(status || 'all')

  const filtered = allOrders.filter((order) => {
    const matchesStatus = normalizedStatus === 'all' || order.status === normalizedStatus
    if (!matchesStatus) return false
    if (!normalizedQuery) return true

    return [
      order.customer,
      order.id,
      order.documentType,
      order.documentNumber,
      ...(order.items || []).map((item) => item.title),
    ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery))
  })

  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 50))
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(totalPages, Math.max(1, Number.parseInt(page, 10) || 1))
  const offset = (safePage - 1) * safePageSize
  const orders = filtered.slice(offset, offset + safePageSize)

  const summary = allOrders.reduce((acc, order) => {
    acc.all += 1
    if (order.status === 'ready') acc.ready += 1
    if (order.status === 'invoiced') acc.invoiced += 1
    if (order.status === 'review') acc.review += 1
    return acc
  }, { all: 0, ready: 0, invoiced: 0, review: 0 })

  return {
    orders,
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    offset,
    summary,
    allTotal: allOrders.length,
    lastSyncAt: store.lastSyncAt || null,
  }
}

export async function disconnect() {
  await updateStore((store) => ({
    ...store,
    account: null,
    tokens: null,
    orders: [],
    details: {},
    syncStatus: null,
  }))
}

