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
  if (!response.ok) throw new Error(payload.message || payload.error_description || 'Mercado Libre rechazó el token')
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
  if (!state || !validUntil || validUntil < Date.now()) throw new Error('La autorización venció o no pertenece a Panadero')

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
  if (!store.tokens?.accessToken) throw new Error('Mercado Libre no está conectado')
  if (store.tokens.expiresAt > Date.now() + 60_000) return store.tokens.accessToken
  if (!store.tokens.refreshToken) throw new Error('El token venció y no hay refresh token')
  return refreshAccessToken(store.tokens.refreshToken)
}

async function apiFetch(pathname, suppliedToken) {
  const token = suppliedToken || await getAccessToken()
  const response = await fetch(`${API_URL}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || `Error de Mercado Libre (${response.status})`)
  return payload
}

function normalizeOrder(order) {
  const buyerName = [order.buyer?.first_name, order.buyer?.last_name].filter(Boolean).join(' ')
  const customer = buyerName || order.buyer?.nickname || `Comprador ${order.buyer?.id || ''}`.trim()
  const paid = order.status === 'paid'

  return {
    id: String(order.id),
    accountId: 'mercadolibre',
    customer,
    documentType: 'Sin datos',
    documentNumber: String(order.buyer?.id || 'Pendiente'),
    total: Number(order.total_amount || order.paid_amount || 0),
    status: paid ? 'ready' : 'review',
    statusLabel: paid ? 'Lista para facturar' : 'Revisar',
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
      ? payment.fee_details.reduce((subtotal, fee) => subtotal + Number(fee.amount || 0), 0)
      : 0
    return total + paymentFees
  }, 0)
}

function buildOrderDetail(order, shipment, billingInfo) {
  const payments = Array.isArray(order.payments) ? order.payments : []
  const receiverAddress = shipment?.receiver_address || order.shipping?.receiver_address || null
  const billingAddress = billingInfo?.billing_info?.additional_info || billingInfo?.additional_info || null
  const buyerName = [
    billingInfo?.billing_info?.name,
    billingInfo?.name,
    order.buyer?.first_name,
    order.buyer?.last_name,
  ].filter(Boolean).join(' ').trim()

  const documentType = billingInfo?.billing_info?.doc_type || billingInfo?.doc_type || 'Sin datos'
  const documentNumber = billingInfo?.billing_info?.doc_number || billingInfo?.doc_number || 'Sin datos'
  const phone = receiverAddress?.receiver_phone || receiverAddress?.phone || order.buyer?.phone?.number || null
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
      return sum + Number(payment.transaction_amount || 0) - Number(payment.transaction_amount_refunded || 0)
    }
    return sum + Number(payment.net_received_amount ?? payment.transaction_amount ?? 0)
  }, 0)

  return {
    id: String(order.id),
    status: order.status || '',
    dateCreated: order.date_created || null,
    buyer: {
      id: order.buyer?.id ? String(order.buyer.id) : null,
      nickname: order.buyer?.nickname || null,
      name: buyerName || order.buyer?.nickname || 'Sin datos',
      documentType,
      documentNumber: String(documentNumber),
      phone,
      email: order.buyer?.email || null,
    },
    address: receiverAddress ? {
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
    } : null,
    billingAddress,
    items: (order.order_items || []).map((entry) => ({
      id: String(entry.item?.id || ''),
      title: entry.item?.title || 'Producto Mercado Libre',
      quantity: Number(entry.quantity || 1),
      unitPrice: Number(entry.unit_price || 0),
      fullUnitPrice: Number(entry.full_unit_price || entry.unit_price || 0),
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
      fees: Array.isArray(payment.fee_details) ? payment.fee_details : [],
    })),
  }
}

export async function getOrderDetail(orderId) {
  if (!orderId) throw new Error('Falta el ID de la venta')

  const safeOrderId = encodeURIComponent(String(orderId))
  const order = await apiFetch(`/orders/${safeOrderId}`)

  let shipment = null
  let billingInfo = null

  if (order.shipping?.id) {
    try {
      shipment = await apiFetch(`/shipments/${encodeURIComponent(String(order.shipping.id))}`)
    } catch {
      shipment = null
    }
  }

  try {
    billingInfo = await apiFetch(`/orders/${safeOrderId}/billing_info`)
  } catch {
    billingInfo = null
  }

  return {
    detail: buildOrderDetail(order, shipment, billingInfo),
    raw: {
      order,
      shipment,
      billingInfo,
    },
  }
}

export async function getStatus() {
  const store = await readStore()
  return {
    connected: Boolean(store.account && store.tokens?.accessToken),
    account: store.account,
    orderCount: store.orders?.length || 0,
  }
}

export async function syncOrders({ page = 1, pageSize = 50 } = {}) {
  const store = await readStore()
  if (!store.account?.id) throw new Error('Mercado Libre no está conectado')

  const safePageSize = Math.min(50, Math.max(10, Number(pageSize) || 50))
  const safePage = Math.max(1, Number(page) || 1)
  const offset = (safePage - 1) * safePageSize

  const result = await apiFetch(
    `/orders/search?seller=${encodeURIComponent(store.account.id)}&sort=date_desc&limit=${safePageSize}&offset=${offset}`,
  )
  const orders = (result.results || []).map(normalizeOrder)
  const total = Number(result.paging?.total ?? orders.length)
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const lastSyncAt = new Date().toISOString()

  await updateStore((current) => ({
    ...current,
    orders,
    paging: { page: safePage, pageSize: safePageSize, total, totalPages },
    lastSyncAt,
  }))

  return { orders, page: safePage, pageSize: safePageSize, total, totalPages, lastSyncAt }
}

export async function getOrders() {
  const store = await readStore()
  const paging = store.paging || {
    page: 1,
    pageSize: 50,
    total: store.orders?.length || 0,
    totalPages: 1,
  }
  return { orders: store.orders || [], ...paging, lastSyncAt: store.lastSyncAt || null }
}

export async function disconnect() {
  await updateStore((store) => ({ ...store, account: null, tokens: null, orders: [] }))
}