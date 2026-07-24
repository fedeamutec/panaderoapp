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

export async function getStatus() {
  const store = await readStore()
  return {
    connected: Boolean(store.account && store.tokens?.accessToken),
    account: store.account,
    orderCount: store.orders?.length || 0,
  }
}

export async function syncOrders() {
  const store = await readStore()
  if (!store.account?.id) throw new Error('Mercado Libre no está conectado')
  const result = await apiFetch(`/orders/search?seller=${encodeURIComponent(store.account.id)}&sort=date_desc&limit=50`)
  const orders = (result.results || []).map(normalizeOrder)
  await updateStore((current) => ({ ...current, orders, lastSyncAt: new Date().toISOString() }))
  return { orders, total: result.paging?.total ?? orders.length }
}

export async function getOrders() {
  const store = await readStore()
  return { orders: store.orders || [], lastSyncAt: store.lastSyncAt || null }
}

export async function disconnect() {
  await updateStore((store) => ({ ...store, account: null, tokens: null, orders: [] }))
}
