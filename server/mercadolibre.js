import crypto from 'node:crypto'
import { readStore, updateStore } from './store.js'

const AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization'
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const API_URL = 'https://api.mercadolibre.com'
const INVOICE_CHECK_CONCURRENCY = 5

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

async function apiFetch(pathname, suppliedToken) {
  const token = suppliedToken || await getAccessToken()

  const response = await fetch(`${API_URL}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      payload.message
      || payload.error
      || `Error de Mercado Libre (${response.status})`
    )
  }

  return payload
}

function billingInfoAdditionalEntries(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([name, entry]) => ({
    name,
    type: name,
    value: entry,
  }))
}

function billingField(additionalInfo, names) {
  const normalizedNames = names.map((name) => String(name).toLowerCase())
  const entry = billingInfoAdditionalEntries(additionalInfo).find((item) => normalizedNames.includes(String(item?.type || item?.name || '').toLowerCase()))
  return entry?.value ?? entry?.description ?? entry?.nameValue ?? ''
}

export function normalizeBillingInfoResponse(payload = {}) {
  const billing = payload?.billing_info || payload || {}
  const additionalInfo = billing?.additional_info || payload?.additional_info || []
  const identification = billing?.identification || payload?.identification || {}
  const documentNumber = billing.doc_number
    || billing.document_number
    || identification.number
    || payload.doc_number
    || payload.document_number
    || billingField(additionalInfo, ['doc_number', 'document_number', 'identification_number', 'cuit', 'tax_id'])
  const documentType = billing.doc_type
    || billing.document_type
    || identification.type
    || payload.doc_type
    || payload.document_type
    || billingField(additionalInfo, ['doc_type', 'document_type', 'identification_type'])
  const legalName = billing.business_name
    || billing.businessName
    || billing.legal_name
    || billing.legalName
    || payload.business_name
    || payload.businessName
    || billingField(additionalInfo, ['business_name', 'businessname', 'legal_name', 'legalname', 'razon_social', 'razonsocial'])
  const taxpayerType = billing.taxpayer_type
    || billing.taxpayerType
    || billing.tax_condition
    || billing.taxCondition
    || payload.taxpayer_type
    || payload.taxpayerType
    || billingField(additionalInfo, ['taxpayer_type', 'taxpayertype', 'taxpayer_type_id', 'tax_condition', 'taxcondition', 'condicion_fiscal', 'condicionfiscal'])
  const taxpayerTypeId = typeof taxpayerType === 'object'
    ? Number(taxpayerType.id || taxpayerType.code || taxpayerType.value) || null
    : Number(taxpayerType || billing.taxpayer_type_id || billing.taxConditionId || billingField(additionalInfo, ['taxpayer_type_id', 'taxconditionid'])) || null
  const taxpayerDescription = typeof taxpayerType === 'object'
    ? taxpayerType.description || taxpayerType.name || taxpayerType.label || ''
    : String(taxpayerType || '').trim()
  const firstName = billing.first_name || billing.firstName || payload.first_name || ''
  const lastName = billing.last_name || billing.lastName || payload.last_name || ''
  const fullName = billing.name || [firstName, lastName].filter(Boolean).join(' ') || payload.name || ''

  return {
    raw: payload,
    billing,
    additionalInfo,
    legalName: String(legalName || '').trim(),
    fullName: String(fullName || '').trim(),
    documentType: String(documentType || '').trim(),
    documentNumber: String(documentNumber || '').replace(/\D/g, ''),
    taxpayerTypeId,
    taxpayerDescription,
  }
}

function sanitizedBillingStructure(payload = {}) {
  const billing = payload?.billing_info || payload || {}
  const additionalInfo = billing?.additional_info || payload?.additional_info || []
  return {
    topLevelKeys: Object.keys(payload || {}).slice(0, 30),
    billingInfoKeys: Object.keys(billing || {}).slice(0, 30),
    additionalInfoKeys: billingInfoAdditionalEntries(additionalInfo)
      .map((item) => String(item?.type || item?.name || '').trim())
      .filter(Boolean)
      .slice(0, 30),
  }
}

function sanitizedBillingFields(normalized) {
  return {
    hasBusinessName: Boolean(normalized.legalName),
    documentType: normalized.documentType || null,
    documentNumberSuffix: normalized.documentNumber ? normalized.documentNumber.slice(-4) : null,
    taxpayerTypeId: normalized.taxpayerTypeId,
    hasTaxpayerDescription: Boolean(normalized.taxpayerDescription),
    additionalInfoKeys: billingInfoAdditionalEntries(normalized.additionalInfo)
      .map((item) => String(item?.type || item?.name || '').trim())
      .filter(Boolean)
      .slice(0, 20),
  }
}

async function getBillingInfoForOrder(orderId, suppliedToken) {
  const token = suppliedToken || await getAccessToken()
  const endpoint = `/orders/${encodeURIComponent(String(orderId))}/billing_info`
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Version': '2',
    },
  })
  const payload = await response.json().catch(() => ({}))
  const normalized = normalizeBillingInfoResponse(payload)
  console.info('[mercadolibre] billing_info', {
    endpoint,
    status: response.status,
    ok: response.ok,
    fields: sanitizedBillingFields(normalized),
    structure: sanitizedBillingStructure(payload),
  })
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Mercado Libre billing_info respondió ${response.status}`)
    error.status = response.status
    throw error
  }
  return normalized
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
    return {
      packId,
      invoiceAttached: false,
      invoiceDocuments: [],
      invoiceCheckedAt: checkedAt,
      invoiceCheckError: error.message,
    }
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(values[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(
    Math.max(1, Number(concurrency) || 1),
    values.length || 1
  )

  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  )

  return results
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function additionalInfoValue(additionalInfo, names) {
  if (Array.isArray(additionalInfo)) {
    const match = additionalInfo.find((item) => names.includes(String(item?.type || item?.name || '').toLowerCase()))
    return match?.value || match?.description || ''
  }
  if (!additionalInfo || typeof additionalInfo !== 'object') return ''
  for (const name of names) {
    if (additionalInfo[name]) return additionalInfo[name]
  }
  return ''
}

export function selectFiscalLegalName({ billingInfo = {}, documentType = '' } = {}) {
  const billing = billingInfo?.billing_info || billingInfo
  const additionalInfo = billing?.additional_info || billingInfo?.additional_info
  const candidates = [
    billingInfo?.legalName,
    billing?.business_name,
    billing?.businessName,
    billing?.legal_name,
    billing?.legalName,
    additionalInfoValue(additionalInfo, ['business_name', 'businessname', 'legal_name', 'legalname', 'razon_social', 'razonsocial']),
  ].map((value) => String(value || '').trim()).filter(Boolean)

  if (String(documentType).toUpperCase().includes('CUIT')) return candidates[0] || ''
  return ''
}

export function fiscalDisplayData(buyer = {}) {
  const documentType = String(buyer.documentType || '').toUpperCase()
  const fiscalLegalName = String(buyer.fiscalLegalName || '').trim()
  if (documentType.includes('CUIT')) {
    if (!fiscalLegalName) throw new Error('Falta la razón social fiscal del CUIT.')
    return { label: 'Razón social', value: fiscalLegalName, displayName: fiscalLegalName }
  }
  const name = String(buyer.name || '').trim()
  return { label: 'Nombre', value: name, displayName: name }
}

function normalizeOrder(order, fiscalInfo = {}, billingInfo = {}) {
  const normalizedBilling = normalizeBillingInfoResponse(billingInfo)
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
    documentType: 'Sin datos',
    documentNumber: String(order.buyer?.id || 'Pendiente'),
    fiscalLegalName: normalizedBilling.legalName || null,
    billingName: normalizedBilling.fullName || null,
    fiscalDocumentType: normalizedBilling.documentType || null,
    fiscalDocumentNumber: normalizedBilling.documentNumber || null,
    taxCondition: normalizedBilling.taxpayerDescription || null,
    taxConditionId: normalizedBilling.taxpayerTypeId,
    billingInfoError: billingInfo?.error || null,
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
  const normalizedBilling = normalizeBillingInfoResponse(billingInfo || {})
  const payments = Array.isArray(order.payments) ? order.payments : []
  const receiverAddress =
    shipment?.receiver_address
    || order.shipping?.receiver_address
    || null

  const billingAddress =
    normalizedBilling.additionalInfo
    || null

  const buyerName = [
    normalizedBilling.billing?.name,
    normalizedBilling.billing?.legal_name,
    order.buyer?.first_name,
    order.buyer?.last_name,
  ].filter(Boolean).join(' ').trim()

  const documentType =
    normalizedBilling.documentType
    || 'Sin datos'

  const documentNumber =
    normalizedBilling.documentNumber || 'Sin datos'

  const taxCondition = normalizedBilling.taxpayerDescription
  const taxConditionId = normalizedBilling.taxpayerTypeId

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
      fiscalLegalName: normalizedBilling.legalName || selectFiscalLegalName({ billingInfo, documentType }),
      billingName: normalizedBilling.fullName || null,
      documentType,
      documentNumber: String(documentType.toUpperCase().includes('CUIT') ? onlyDigits(documentNumber) : documentNumber),
      taxCondition,
      taxConditionId,
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

export async function getFiscalDocuments(orderId) {
  if (!orderId) throw new Error('Falta el ID de la venta')

  const safeOrderId = encodeURIComponent(String(orderId))
  const token = await getAccessToken()
  const order = await apiFetch(`/orders/${safeOrderId}`, token)
  return readFiscalDocumentsForOrder(order)
}

export async function getOrderDetail(orderId) {
  if (!orderId) throw new Error('Falta el ID de la venta')

  const safeOrderId = encodeURIComponent(String(orderId))
  const token = await getAccessToken()
  const order = await apiFetch(`/orders/${safeOrderId}`, token)

  let shipment = null
  let billingInfo

  if (order.shipping?.id) {
    try {
      shipment = await apiFetch(`/shipments/${encodeURIComponent(String(order.shipping.id))}`, token)
    } catch {
      shipment = null
    }
  }

  let billingInfoError = null
  try {
    billingInfo = await getBillingInfoForOrder(orderId, token)
  } catch (error) {
    billingInfo = null
    billingInfoError = error.message
  }

  const fiscalInfo = await readFiscalDocumentsForOrder(order, token)

  return {
    detail: {
      ...buildOrderDetail(order, shipment, billingInfo, fiscalInfo),
      billingInfoError,
    },
    raw: {
      order,
      shipment,
      billingInfo,
      billingInfoError,
      fiscalInfo,
    },
  }
}


const REPORT_PAGE_SIZE = 50
const REPORT_MAX_ORDERS = 1000
const REPORT_SHIPMENT_CONCURRENCY = 8

const PROVINCE_ALIASES = {
  'BUENOS AIRES': 'Buenos Aires',
  'CIUDAD AUTONOMA DE BUENOS AIRES': 'Ciudad Autónoma de Buenos Aires',
  'CIUDAD DE BUENOS AIRES': 'Ciudad Autónoma de Buenos Aires',
  'CAPITAL FEDERAL': 'Ciudad Autónoma de Buenos Aires',
  CABA: 'Ciudad Autónoma de Buenos Aires',
  CATAMARCA: 'Catamarca',
  CHACO: 'Chaco',
  CHUBUT: 'Chubut',
  CORDOBA: 'Córdoba',
  CORRIENTES: 'Corrientes',
  'ENTRE RIOS': 'Entre Ríos',
  FORMOSA: 'Formosa',
  JUJUY: 'Jujuy',
  'LA PAMPA': 'La Pampa',
  'LA RIOJA': 'La Rioja',
  MENDOZA: 'Mendoza',
  MISIONES: 'Misiones',
  NEUQUEN: 'Neuquén',
  'RIO NEGRO': 'Río Negro',
  SALTA: 'Salta',
  'SAN JUAN': 'San Juan',
  'SAN LUIS': 'San Luis',
  'SANTA CRUZ': 'Santa Cruz',
  'SANTA FE': 'Santa Fe',
  'SANTIAGO DEL ESTERO': 'Santiago del Estero',
  'TIERRA DEL FUEGO': 'Tierra del Fuego',
  TUCUMAN: 'Tucumán',
}

function normalizeReportText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function normalizeProvince(value) {
  const normalized = normalizeReportText(value)
  if (!normalized) return 'Sin provincia'
  return PROVINCE_ALIASES[normalized] || String(value || '').trim()
}

function reportPeriodDates(period = '90d') {
  const daysByPeriod = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 }
  const days = daysByPeriod[period]
  if (!days) return { from: null, to: null }

  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - days)
  return { from: from.toISOString(), to: to.toISOString() }
}

function receiverAddressFrom(order, shipment) {
  return shipment?.receiver_address || order?.shipping?.receiver_address || null
}

function reportBuyerName(order = {}) {
  return [order.buyer?.first_name, order.buyer?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
    || order.buyer?.nickname
    || `Comprador ${order.buyer?.id || ''}`.trim()
    || 'Cliente Mercado Libre'
}

function latestDate(left, right) {
  if (!left) return right || null
  if (!right) return left
  return new Date(right).getTime() > new Date(left).getTime() ? right : left
}

export async function getMercadoLibreCustomerReport({ period = '90d', forceRefresh = false } = {}) {
  const store = await readStore()
  if (!store.account?.id) throw new Error('Mercado Libre no está conectado')

  const cachedReport = store.reportCache?.customerMap?.[period]
  if (!forceRefresh && cachedReport?.payload) {
    return {
      ...cachedReport.payload,
      cached: true,
      cachedAt: cachedReport.savedAt || cachedReport.payload.generatedAt || null,
    }
  }

  const token = await getAccessToken()
  const { from, to } = reportPeriodDates(period)
  const rawOrders = []
  let totalAvailable = 0
  let offset = 0

  while (rawOrders.length < REPORT_MAX_ORDERS) {
    const limit = Math.min(REPORT_PAGE_SIZE, REPORT_MAX_ORDERS - rawOrders.length)
    const query = new URLSearchParams({
      seller: String(store.account.id),
      sort: 'date_desc',
      limit: String(limit),
      offset: String(offset),
    })

    if (from) query.set('order.date_created.from', from)
    if (to) query.set('order.date_created.to', to)

    const result = await apiFetch(`/orders/search?${query.toString()}`, token)
    const pageOrders = Array.isArray(result.results) ? result.results : []
    totalAvailable = Number(result.paging?.total ?? pageOrders.length)
    rawOrders.push(...pageOrders)

    if (!pageOrders.length || rawOrders.length >= totalAvailable) break
    offset += pageOrders.length
  }

  const paidOrders = rawOrders.filter((order) => String(order.status || '').toLowerCase() === 'paid')

  const enrichedOrders = await mapWithConcurrency(
    paidOrders,
    REPORT_SHIPMENT_CONCURRENCY,
    async (order) => {
      let shipment = null
      if (order.shipping?.id) {
        try {
          shipment = await apiFetch(`/shipments/${encodeURIComponent(String(order.shipping.id))}`, token)
        } catch {
          shipment = null
        }
      }
      return { order, shipment }
    },
  )

  const provinces = new Map()
  const globalCustomers = new Set()
  let amountTotal = 0

  for (const { order, shipment } of enrichedOrders) {
    const address = receiverAddressFrom(order, shipment)
    const provinceName = normalizeProvince(address?.state?.name || address?.state_name)
    const locality = String(address?.city?.name || address?.city_name || '').trim()
    const amount = Number(order.total_amount || order.paid_amount || 0)
    const buyerId = String(order.buyer?.id || '').trim()
    const customerKey = buyerId || normalizeReportText(reportBuyerName(order))
    const customerName = reportBuyerName(order)
    const dateCreated = order.date_created || null
    const products = (order.order_items || [])
      .map((entry) => String(entry.item?.title || '').trim())
      .filter(Boolean)

    amountTotal += amount
    globalCustomers.add(customerKey)

    if (!provinces.has(provinceName)) {
      provinces.set(provinceName, {
        name: provinceName,
        sales: 0,
        amount: 0,
        customers: new Map(),
      })
    }

    const province = provinces.get(provinceName)
    province.sales += 1
    province.amount += amount

    if (!province.customers.has(customerKey)) {
      province.customers.set(customerKey, {
        id: buyerId || customerKey,
        name: customerName,
        nickname: order.buyer?.nickname || '',
        sales: 0,
        amount: 0,
        lastPurchase: null,
        localities: new Set(),
        products: new Set(),
      })
    }

    const customer = province.customers.get(customerKey)
    customer.sales += 1
    customer.amount += amount
    customer.lastPurchase = latestDate(customer.lastPurchase, dateCreated)
    if (locality) customer.localities.add(locality)
    products.forEach((product) => customer.products.add(product))
  }

  const provinceRows = [...provinces.values()]
    .map((province) => {
      const customers = [...province.customers.values()]
        .map((customer) => ({
          ...customer,
          localities: [...customer.localities].sort((a, b) => a.localeCompare(b, 'es')),
          products: [...customer.products],
        }))
        .sort((a, b) => b.sales - a.sales || b.amount - a.amount)

      return {
        name: province.name,
        sales: province.sales,
        customersCount: customers.length,
        amount: Math.round(province.amount * 100) / 100,
        averageTicket: province.sales ? Math.round((province.amount / province.sales) * 100) / 100 : 0,
        customers,
      }
    })
    .sort((a, b) => b.sales - a.sales || b.amount - a.amount)

  const reportPayload = {
    ok: true,
    period,
    generatedAt: new Date().toISOString(),
    source: 'mercadolibre',
    cached: false,
    summary: {
      sales: paidOrders.length,
      customers: globalCustomers.size,
      amount: Math.round(amountTotal * 100) / 100,
      averageTicket: paidOrders.length ? Math.round((amountTotal / paidOrders.length) * 100) / 100 : 0,
      provinces: provinceRows.filter((province) => province.name !== 'Sin provincia').length,
    },
    provinces: provinceRows,
    scannedOrders: rawOrders.length,
    totalAvailable,
    truncated: rawOrders.length < totalAvailable,
  }

  await updateStore((current) => ({
    ...current,
    reportCache: {
      ...(current.reportCache || {}),
      customerMap: {
        ...(current.reportCache?.customerMap || {}),
        [period]: { savedAt: new Date().toISOString(), payload: reportPayload },
      },
    },
  }))

  return reportPayload
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

  if (!store.account?.id) {
    throw new Error('Mercado Libre no está conectado')
  }

  const safePage = Math.max(
    1,
    Number.parseInt(page, 10) || 1
  )

  const safePageSize = Math.min(
    50,
    Math.max(1, Number.parseInt(pageSize, 10) || 50)
  )

  const offset = (safePage - 1) * safePageSize

  const query = new URLSearchParams({
    seller: String(store.account.id),
    sort: 'date_desc',
    limit: String(safePageSize),
    offset: String(offset),
  })

  const result = await apiFetch(`/orders/search?${query.toString()}`)
  const rawOrders = Array.isArray(result.results) ? result.results : []
  const token = await getAccessToken()

  // Consulta facturación y documentos en grupos de 5 para evitar sobrecargar la API.
  const fiscalInformation = await mapWithConcurrency(
    rawOrders,
    INVOICE_CHECK_CONCURRENCY,
    async (order) => {
      const [fiscalInfo, billingResult] = await Promise.all([
        readFiscalDocumentsForOrder(order, token),
        getBillingInfoForOrder(order.id, token).catch((error) => ({ error: error.message })),
      ])
      return { fiscalInfo, billingInfo: billingResult }
    },
  )

  const orders = rawOrders.map(
    (order, index) => normalizeOrder(
      order,
      fiscalInformation[index]?.fiscalInfo,
      fiscalInformation[index]?.billingInfo,
    )
  )

  const total = Number(result.paging?.total ?? orders.length)
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const lastSyncAt = new Date().toISOString()

  const pagination = {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    offset,
  }

  await updateStore((current) => ({
    ...current,
    orders,
    pagination,
    lastSyncAt,
  }))

  const invoiceSummary = orders.reduce(
    (summary, order) => {
      if (order.invoiceAttached) summary.invoiced += 1
      if (order.invoiceCheckError) summary.errors += 1
      return summary
    },
    { invoiced: 0, errors: 0 }
  )

  return {
    orders,
    ...pagination,
    lastSyncAt,
    invoiceSummary,
  }
}

export async function getOrders() {
  const store = await readStore()
  const orders = store.orders || []

  const pagination = store.pagination || {
    page: 1,
    pageSize: 50,
    total: orders.length,
    totalPages: Math.max(1, Math.ceil(orders.length / 50)),
    offset: 0,
  }

  return {
    orders,
    ...pagination,
    lastSyncAt: store.lastSyncAt || null,
  }
}

export async function disconnect() {
  await updateStore((store) => ({
    ...store,
    account: null,
    tokens: null,
    orders: [],
  }))
}
