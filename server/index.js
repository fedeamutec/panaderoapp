import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import {
  createAuthorizationUrl,
  disconnect,
  exchangeAuthorizationCode,
  getOrderDetail,
  getOrders,
  getStatus,
  syncOrders,
  uploadFiscalDocument,
} from './mercadolibre.js'
import { generateCsr, getArcaStatus, readCsr, saveCertificate } from './arca/certificates.js'
import { testArcaConnection } from './arca/wsaa.js'
import {
  createSaleInvoice,
  createTestInvoice,
  getLastAuthorizedVoucher,
  getPointsOfSale,
  getReceiverVatConditions,
  getVoucherTypes,
} from './arca/wsfe.js'
import { ARCA_DATA_DIR, ARCA_POINT_OF_SALE } from './arca/config.js'
import { buildInvoicePdf } from './invoicePdf.js'
import { authenticate, clearSessionCookie, createSessionCookie, getSession, requireAuth } from './auth.js'
import { readBudgetsStore, updateBudgetsStore } from './budgetsStore.js'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const allowedOrigins = [...new Set([frontendUrl, 'https://panaderoapp.com', 'http://localhost:5173'])]

app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '1mb' }))

const saleInvoicesPath = path.join(ARCA_DATA_DIR, 'sale-invoices.json')

async function readSaleInvoices() {
  try {
    const content = await fs.readFile(saleInvoicesPath, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function writeSaleInvoices(invoices) {
  await fs.mkdir(ARCA_DATA_DIR, { recursive: true })
  const temporaryPath = `${saleInvoicesPath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(invoices, null, 2), 'utf8')
  await fs.rename(temporaryPath, saleInvoicesPath)
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function documentIdentity(client = {}) {
  const digits = onlyDigits(client.cuit || client.documentNumber)
  if (digits.length === 11) return { documentType: 'CUIT', documentNumber: digits }
  if (digits.length >= 7 && digits.length <= 8) return { documentType: 'DNI', documentNumber: digits }
  return { documentType: '', documentNumber: digits }
}

function matchReceiverVatCondition(conditions = [], taxCondition = '', invoiceType = 'B') {
  const normalized = normalizeText(taxCondition)
  const className = String(invoiceType || 'B').toUpperCase()

  if (className === 'A') {
    if (!normalized.includes('RESPONSABLE') || !normalized.includes('INSCRIP')) {
      throw new Error('Factura A requiere un receptor Responsable Inscripto. Revisá la condición fiscal del cliente.')
    }
    return conditions.find((item) => normalizeText(item.description).includes('RESPONSABLE INSCRIP'))
  }

  if (normalized.includes('MONOTRIB')) {
    return conditions.find((item) => normalizeText(item.description).includes('MONOTRIB'))
  }
  if (normalized.includes('EXENT')) {
    return conditions.find((item) => normalizeText(item.description).includes('EXENT'))
  }
  if (normalized.includes('CONSUMIDOR') || normalized.includes('FINAL')) {
    return conditions.find((item) => normalizeText(item.description).includes('CONSUMIDOR FINAL'))
  }

  throw new Error('Para Factura B completá la condición fiscal del cliente (Consumidor final, Monotributo o Exento) antes de emitir.')
}

function commercialInvoiceItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    code: String(item.code || ''),
    title: String(item.name || item.title || 'Producto'),
    quantity: Math.max(1, Number(item.quantity) || 1),
    unitPrice: Number(item.discountedPrice ?? item.unitPrice ?? item.price ?? 0),
    subtotal: Number(item.subtotal || 0),
  }))
}

function commercialInvoiceTotal(items = []) {
  return Math.round(items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0) * 100) / 100
}

app.get('/api/exchange/bna', async (_req, res) => {
  try {
    const response = await fetch('https://www.bna.com.ar/Personas', {
      headers: { 'User-Agent': 'Panadero/1.0 (+https://panaderoapp.com)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`Banco Nación respondió ${response.status}`)
    const html = await response.text()
    const plain = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/\s+/g, ' ')

    const dollar = plain.match(/D[oó]lar\s+U\.S\.A\s+([\d.,]+)\s+([\d.,]+)/i)
    if (!dollar) throw new Error('No se encontró la cotización de dólar billete en BNA.')
    const parseBna = (value) => Number(String(value).replace(/\./g, '').replace(',', '.'))
    const date = plain.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+Compra\s+Venta/i)?.[1] || ''
    const time = plain.match(/Hora\s+Actualizaci[oó]n:\s*(\d{1,2}:\d{2})/i)?.[1] || ''

    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json({ ok: true, source: 'BNA', currency: 'USD', type: 'billete', buy: parseBna(dollar[1]), sell: parseBna(dollar[2]), date, time })
  } catch (error) {
    console.error('BNA exchange error:', error)
    res.status(502).json({ ok: false, error: error.message })
  }
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/auth/login', (req, res) => {
  try {
    const user = authenticate(req.body?.email, req.body?.password)
    if (!user) return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos.' })

    const session = createSessionCookie(user)
    res.setHeader('Set-Cookie', session.header)
    res.json({ ok: true, user, expiresAt: session.expiresAt })
  } catch (error) {
    console.error('Login configuration error:', error)
    res.status(503).json({ ok: false, error: error.message })
  }
})

app.get('/api/auth/session', (req, res) => {
  try {
    const session = getSession(req)
    if (!session) return res.status(401).json({ ok: false, authenticated: false })
    res.json({
      ok: true,
      authenticated: true,
      user: { email: session.email, name: session.name, role: session.role },
      expiresAt: session.expiresAt,
    })
  } catch (error) {
    res.status(503).json({ ok: false, authenticated: false, error: error.message })
  }
})

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie())
  res.json({ ok: true })
})

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/') || req.path === '/mercadolibre/callback') return next()
  return requireAuth(req, res, next)
})

app.get('/api/budgets/state', async (req, res) => {
  try {
    const state = await readBudgetsStore(req.user.email)
    const activeBrand = state.brands.find((brand) => brand.id === state.activeBrandId) || state.brands[0]
    res.json({
      ok: true,
      ...state,
      brand: activeBrand,
      nextNumber: activeBrand?.nextNumber || 1,
      account: req.user.email,
    })
  } catch (error) {
    console.error('Read budgets state error:', error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.put('/api/budgets/settings', async (req, res) => {
  try {
    const state = await updateBudgetsStore(req.user.email, (current) => {
      const incomingBrands = Array.isArray(req.body?.brands) ? req.body.brands : current.brands
      const requestedActive = String(req.body?.activeBrandId || current.activeBrandId || '')
      const activeBrandId = incomingBrands.some((brand) => brand.id === requestedActive)
        ? requestedActive
        : incomingBrands[0]?.id || ''

      return {
        ...current,
        brands: incomingBrands,
        activeBrandId,
        clients: Array.isArray(req.body?.clients) ? req.body.clients : current.clients,
        products: Array.isArray(req.body?.products) ? req.body.products : current.products,
        manualProducts: Array.isArray(req.body?.manualProducts) ? req.body.manualProducts : current.manualProducts,
        defaultProfit: Number.isFinite(Number(req.body?.defaultProfit)) ? Number(req.body.defaultProfit) : current.defaultProfit,
        catalogInitialized: current.catalogInitialized
          || Array.isArray(req.body?.clients)
          || Array.isArray(req.body?.products)
          || Array.isArray(req.body?.manualProducts),
      }
    })
    const activeBrand = state.brands.find((brand) => brand.id === state.activeBrandId) || state.brands[0]
    res.json({ ok: true, ...state, brand: activeBrand, nextNumber: activeBrand?.nextNumber || 1 })
  } catch (error) {
    console.error('Save budgets settings error:', error)
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.post('/api/budgets/confirm', async (req, res) => {
  try {
    const requestedNumber = Number(req.body?.number)
    const requestedBrandId = String(req.body?.brandId || req.body?.budget?.brand?.id || '')
    if (!Number.isInteger(requestedNumber) || requestedNumber <= 0) {
      throw new Error('El número de presupuesto debe ser un entero mayor a 0.')
    }

    const state = await updateBudgetsStore(req.user.email, (current) => {
      const activeBrand = current.brands.find((brand) => brand.id === requestedBrandId)
        || current.brands.find((brand) => brand.id === current.activeBrandId)
        || current.brands[0]
      if (!activeBrand) throw new Error('No hay una marca configurada para este presupuesto.')

      const duplicate = current.generatedBudgets.find((item) => {
        const itemBrandId = item?.brand?.id || item?.brandId || current.brands[0]?.id
        return itemBrandId === activeBrand.id && Number(item?.number) === requestedNumber
      })
      if (duplicate) {
        const error = new Error(`Ya existe el presupuesto N.º ${String(requestedNumber).padStart(6, '0')} para ${activeBrand.name || 'esta marca'}.`)
        error.code = 'DUPLICATE_BUDGET_NUMBER'
        throw error
      }

      const snapshot = {
        ...req.body?.budget,
        id: req.body?.budget?.id || `budget-${Date.now()}`,
        number: requestedNumber,
        brandId: activeBrand.id,
        brand: { ...activeBrand, ...(req.body?.budget?.brand || {}), id: activeBrand.id },
        createdAt: req.body?.budget?.createdAt || new Date().toISOString(),
        status: 'confirmed',
      }

      const brands = current.brands.map((brand) => brand.id === activeBrand.id
        ? { ...brand, ...snapshot.brand, nextNumber: Math.max(Number(brand.nextNumber || 1), requestedNumber + 1) }
        : brand)

      return {
        ...current,
        brands,
        activeBrandId: activeBrand.id,
        generatedBudgets: [snapshot, ...current.generatedBudgets],
      }
    })

    const activeBrand = state.brands.find((brand) => brand.id === state.activeBrandId) || state.brands[0]
    const budget = state.generatedBudgets.find((item) => item.id === req.body?.budget?.id)
      || state.generatedBudgets.find((item) => (item.brand?.id || item.brandId) === activeBrand?.id && Number(item.number) === requestedNumber)
    res.json({
      ok: true,
      budget,
      brands: state.brands,
      activeBrandId: state.activeBrandId,
      nextNumber: activeBrand?.nextNumber || requestedNumber + 1,
      generatedBudgets: state.generatedBudgets,
      brand: activeBrand,
    })
  } catch (error) {
    console.error('Confirm budget error:', error)
    res.status(error?.code === 'DUPLICATE_BUDGET_NUMBER' ? 409 : 400).json({ ok: false, error: error.message })
  }
})


app.post('/api/budgets/:budgetId/debit-note', async (req, res) => {
  try {
    const budgetId = String(req.params.budgetId || '').trim()
    if (!budgetId) throw new Error('Falta identificar el presupuesto.')

    const requestedAmount = Number(req.body?.amount)
    const reason = String(req.body?.reason || '').trim() || 'Ajuste comercial asociado al presupuesto.'

    const state = await updateBudgetsStore(req.user.email, (current) => {
      const budgetIndex = current.generatedBudgets.findIndex((item) => item.id === budgetId)
      if (budgetIndex === -1) throw new Error('No se encontró el presupuesto confirmado.')

      const budget = current.generatedBudgets[budgetIndex]
      if (budget.status !== 'confirmed') throw new Error('La nota de débito solo se puede generar sobre un presupuesto confirmado.')
      if (budget.debitNote) {
        const error = new Error('Este presupuesto ya tiene una nota de débito asociada.')
        error.code = 'DEBIT_NOTE_EXISTS'
        throw error
      }

      const amount = Number.isFinite(requestedAmount) && requestedAmount > 0
        ? requestedAmount
        : Number(budget.total || 0)

      const debitNote = {
        id: `debit-note-${Date.now()}`,
        createdAt: new Date().toISOString(),
        amount,
        reason,
        status: 'issued',
      }

      const updatedBudget = {
        ...budget,
        hasDebitNote: true,
        debitNote,
      }

      const generatedBudgets = [...current.generatedBudgets]
      generatedBudgets[budgetIndex] = updatedBudget

      return {
        ...current,
        generatedBudgets,
      }
    })

    const budget = state.generatedBudgets.find((item) => item.id === budgetId)
    res.json({
      ok: true,
      budget,
      generatedBudgets: state.generatedBudgets,
      debitNote: budget?.debitNote || null,
    })
  } catch (error) {
    console.error('Create budget debit note error:', error)
    res.status(error?.code === 'DEBIT_NOTE_EXISTS' ? 409 : 400).json({ ok: false, error: error.message })
  }
})

app.post('/api/budgets/:budgetId/cancel', async (req, res) => {
  try {
    const budgetId = String(req.params.budgetId || '').trim()
    const noteType = String(req.body?.noteType || '').trim().toLowerCase()
    const reason = String(req.body?.reason || '').trim() || 'Cancelación comercial'
    if (!budgetId) throw new Error('Falta identificar el presupuesto.')
    if (!['credit', 'debit'].includes(noteType)) throw new Error('Elegí Nota de crédito o Nota de débito.')
    const state = await updateBudgetsStore(req.user.email, (current) => {
      const index = current.generatedBudgets.findIndex((item) => item.id === budgetId)
      if (index === -1) throw new Error('No se encontró el presupuesto confirmado.')
      const budget = current.generatedBudgets[index]
      if (budget.status !== 'confirmed') throw new Error('Solo se puede cancelar un presupuesto confirmado.')
      if (budget.cancelledAt) throw new Error('Este presupuesto ya está cancelado.')
      const cancelledAt = new Date().toISOString()
      const updated = { ...budget, cancelledAt, status: 'cancelled', cancellation: { id: `cancellation-${Date.now()}`, createdAt: cancelledAt, noteType, reason, amount: Number(budget.total || 0), status: 'registered' } }
      const generatedBudgets = [...current.generatedBudgets]
      generatedBudgets[index] = updated
      return { ...current, generatedBudgets }
    })
    res.json({ ok: true, budget: state.generatedBudgets.find((item) => item.id === budgetId), generatedBudgets: state.generatedBudgets })
  } catch (error) {
    console.error('Cancel budget error:', error)
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.get('/api/arca/status', async (_req, res) => {
  try {
    res.json(await getArcaStatus())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/arca/csr', async (_req, res) => {
  try {
    res.json({ csr: await readCsr(), ...(await getArcaStatus()) })
  } catch (error) {
    res.status(404).json({ error: error.message })
  }
})

app.post('/api/arca/csr', async (_req, res) => {
  try {
    res.json(await generateCsr())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/arca/certificate', async (req, res) => {
  try {
    res.json(await saveCertificate(req.body?.certificate))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/arca/test-connection', async (_req, res) => {
  try {
    res.json(await testArcaConnection())
  } catch (error) {
    console.error('ARCA test connection error:', error)
    res.status(502).json({
      ok: false,
      connected: false,
      error: error.message,
    })
  }
})

app.get('/api/arca/points-of-sale', async (_req, res) => {
  try {
    res.json(await getPointsOfSale())
  } catch (error) {
    console.error('ARCA points of sale error:', error)
    res.status(502).json({ ok: false, error: error.message })
  }
})

app.get('/api/arca/voucher-types', async (_req, res) => {
  try {
    res.json(await getVoucherTypes())
  } catch (error) {
    console.error('ARCA voucher types error:', error)
    res.status(502).json({ ok: false, error: error.message })
  }
})


app.get('/api/arca/receiver-vat-conditions', async (req, res) => {
  try {
    res.json(await getReceiverVatConditions({
      voucherClass: req.query.voucherClass || 'C',
    }))
  } catch (error) {
    console.error('ARCA receiver VAT conditions error:', error)
    res.status(502).json({ ok: false, error: error.message })
  }
})

app.post('/api/arca/test-invoice', async (req, res) => {
  try {
    res.json(await createTestInvoice({
      pointOfSale: req.body?.pointOfSale,
      amount: req.body?.amount,
      documentType: req.body?.documentType,
      documentNumber: req.body?.documentNumber,
      recipientVatConditionId: req.body?.recipientVatConditionId,
      confirmation: req.body?.confirmation,
    }))
  } catch (error) {
    console.error('ARCA test invoice error:', error)
    res.status(400).json({ ok: false, error: error.message })
  }
})


app.get('/api/arca/commercial-sequence', async (req, res) => {
  try {
    const invoiceType = String(req.query.invoiceType || '').toUpperCase()
    const voucherType = invoiceType === 'A' ? 1 : invoiceType === 'B' ? 6 : 0
    if (!voucherType) throw new Error('Elegí Factura A o Factura B.')
    const sequence = await getLastAuthorizedVoucher({
      pointOfSale: ARCA_POINT_OF_SALE,
      voucherType,
    })
    res.json({
      ok: true,
      invoiceType,
      pointOfSale: ARCA_POINT_OF_SALE,
      voucherType,
      lastVoucherNumber: sequence.lastVoucherNumber,
      nextVoucherNumber: sequence.nextVoucherNumber,
      formattedNextNumber: `${String(ARCA_POINT_OF_SALE).padStart(4, '0')}-${String(sequence.nextVoucherNumber).padStart(8, '0')}`,
      environment: sequence.environment,
    })
  } catch (error) {
    console.error('ARCA commercial sequence error:', error)
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.get('/api/arca/commercial-invoices', async (_req, res) => {
  try {
    const invoices = await readSaleInvoices()
    res.json({
      ok: true,
      invoices: invoices.filter((item) => item.source === 'commercial'),
    })
  } catch (error) {
    console.error('Read commercial invoices error:', error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.post('/api/arca/commercial-invoice', async (req, res) => {
  try {
    const invoiceType = String(req.body?.invoiceType || '').toUpperCase()
    if (!['A', 'B'].includes(invoiceType)) throw new Error('Elegí Factura A o Factura B.')

    const requestId = String(req.body?.requestId || '').trim()
    if (!requestId) throw new Error('Falta el identificador de seguridad de la emisión.')

    const confirmation = String(req.body?.confirmation || '')
    if (confirmation !== `EMITIR_FACTURA_${invoiceType}_${requestId}`) {
      throw new Error('La confirmación de seguridad no coincide con la factura.')
    }

    const client = req.body?.client || {}
    const identity = documentIdentity(client)
    if (!identity.documentType || !identity.documentNumber) {
      throw new Error('El cliente necesita CUIT o DNI válido antes de emitir.')
    }
    if (invoiceType === 'A' && identity.documentType !== 'CUIT') {
      throw new Error('Factura A requiere un CUIT válido de 11 dígitos.')
    }

    const items = commercialInvoiceItems(req.body?.items)
    if (!items.length) throw new Error('Agregá al menos un producto antes de emitir.')
    const amount = commercialInvoiceTotal(items)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('El total de la factura no es válido.')

    const invoices = await readSaleInvoices()
    const duplicate = invoices.find((item) => item.source === 'commercial' && item.commercialRequestId === requestId)
    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: `Esta operación ya fue emitida como ${duplicate.voucher?.formattedNumber || 'comprobante autorizado'}.`,
        invoice: duplicate,
      })
    }

    const vatConditionsResponse = await getReceiverVatConditions({ voucherClass: invoiceType })
    const vatCondition = matchReceiverVatCondition(
      vatConditionsResponse.conditions || [],
      client.taxCondition,
      invoiceType,
    )
    if (!vatCondition?.id) {
      throw new Error('ARCA no devolvió una condición IVA compatible para este cliente y tipo de factura.')
    }

    const result = await createSaleInvoice({
      pointOfSale: ARCA_POINT_OF_SALE,
      amount,
      requestedType: invoiceType,
      vatRate: req.body?.vatRate,
      documentType: identity.documentType,
      documentNumber: identity.documentNumber,
      recipientVatConditionId: vatCondition.id,
      confirmation: `EMITIR_VENTA_${requestId}`,
    })

    const addressLine = [
      client.address,
      client.locality,
      client.postalCode ? `CP ${client.postalCode}` : '',
    ].filter(Boolean).join(', ')

    const invoice = {
      id: `commercial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'commercial',
      commercialRequestId: requestId,
      accountEmail: req.user.email,
      brand: req.body?.brand || null,
      buyer: {
        name: client.legalName || client.name || 'Cliente',
        documentType: identity.documentType,
        documentNumber: identity.documentNumber,
        taxCondition: client.taxCondition || '',
      },
      saleSnapshot: {
        items,
        address: {
          addressLine,
          city: client.locality || '',
          state: '',
          zipCode: client.postalCode || '',
        },
        amounts: { total: amount },
        accountNickname: req.body?.brand?.name || process.env.ML_ACCOUNT_NAME || 'Panadero',
      },
      createdAt: new Date().toISOString(),
      environment: result.environment,
      voucher: result.voucher,
      cae: result.cae,
      caeExpirationDate: result.caeExpirationDate,
      result: result.result,
      observations: result.observations || [],
      receiverVatCondition: vatCondition,
    }

    invoices.push(invoice)
    await writeSaleInvoices(invoices)

    res.json({ ok: true, invoice })
  } catch (error) {
    console.error('ARCA commercial invoice error:', error)
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.get('/api/arca/commercial-invoices/:invoiceId/pdf', async (req, res) => {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim()
    const invoices = await readSaleInvoices()
    const invoice = invoices.find((item) => item.source === 'commercial' && item.id === invoiceId)
    if (!invoice) return res.status(404).json({ ok: false, error: 'No se encontró la factura.' })
    if (invoice.accountEmail && invoice.accountEmail !== req.user.email) {
      return res.status(403).json({ ok: false, error: 'La factura pertenece a otra cuenta.' })
    }

    const pdf = buildInvoicePdf(invoice)
    const filename = `${invoice.voucher?.voucherTypeDescription || 'Factura'}-${invoice.voucher?.formattedNumber || invoiceId}.pdf`
      .replace(/[^a-zA-Z0-9._-]+/g, '-')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.send(pdf)
  } catch (error) {
    console.error('Commercial invoice PDF error:', error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/arca/sale-invoices', async (_req, res) => {
  try {
    res.json({ ok: true, invoices: await readSaleInvoices() })
  } catch (error) {
    console.error('Read sale invoices error:', error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.post('/api/arca/sale-invoice', async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim()
    if (!orderId) throw new Error('Falta el ID de la venta de Mercado Libre.')

    const confirmation = String(req.body?.confirmation || '')
    if (confirmation !== `EMITIR_VENTA_${orderId}`) {
      throw new Error('La confirmación de seguridad no coincide con la venta.')
    }

    const invoices = await readSaleInvoices()
    const existingInvoice = invoices.find((item) => String(item.orderId) === orderId)
    if (existingInvoice) {
      return res.status(409).json({
        ok: false,
        error: `Esta venta ya fue facturada como ${existingInvoice.voucher?.formattedNumber || 'comprobante autorizado'}.`,
        invoice: existingInvoice,
      })
    }

    const orderPayload = await getOrderDetail(orderId)
    const detail = orderPayload?.detail || orderPayload
    if (!detail) throw new Error('No se pudo obtener el detalle de la venta.')

    const amount = Number(detail.amounts?.total || detail.total || 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('La venta no tiene un importe válido para facturar.')
    }

    const buyer = detail.buyer || {}
    const result = await createSaleInvoice({
      pointOfSale: ARCA_POINT_OF_SALE,
      amount,
      requestedType: req.body?.invoiceType || 'automatic',
      vatRate: req.body?.vatRate,
      documentType: buyer.documentType,
      documentNumber: buyer.documentNumber,
      confirmation,
    })

    const invoice = {
      orderId,
      buyer: {
        name: buyer.name || null,
        documentType: buyer.documentType || null,
        documentNumber: buyer.documentNumber || null,
      },
      saleSnapshot: {
        items: Array.isArray(detail.items) ? detail.items : [],
        address: detail.address || null,
        amounts: detail.amounts || { total: amount },
        accountNickname: detail.accountNickname || null,
      },
      createdAt: new Date().toISOString(),
      environment: result.environment,
      voucher: result.voucher,
      cae: result.cae,
      caeExpirationDate: result.caeExpirationDate,
      result: result.result,
      observations: result.observations || [],
    }

    invoices.push(invoice)
    await writeSaleInvoices(invoices)

    try {
      const pdf = buildInvoicePdf(invoice)
      const filename = `${invoice.voucher?.voucherTypeDescription || 'Factura'}-${invoice.voucher?.formattedNumber || orderId}.pdf`
        .replace(/[^a-zA-Z0-9._-]+/g, '-')

      const delivery = await uploadFiscalDocument(orderId, pdf, filename)
      invoice.mercadoLibreDelivery = {
        status: delivery.alreadyAttached ? 'already_attached' : 'sent',
        sentAt: new Date().toISOString(),
        packId: delivery.packId || null,
        documentIds: delivery.ids || [],
        error: null,
      }
    } catch (uploadError) {
      console.error('Mercado Libre invoice upload error:', uploadError)
      invoice.mercadoLibreDelivery = {
        status: 'pending',
        sentAt: null,
        packId: detail.packId || null,
        documentIds: [],
        error: uploadError.message,
      }
    }

    await writeSaleInvoices(invoices)

    res.json({
      ok: true,
      invoice,
      mercadoLibreDelivery: invoice.mercadoLibreDelivery,
    })
  } catch (error) {
    console.error('ARCA sale invoice error:', error)
    res.status(400).json({ ok: false, error: error.message })
  }
})


app.post('/api/arca/sale-invoices/:orderId/send-to-mercadolibre', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim()
    if (!orderId) throw new Error('Falta el ID de la venta.')

    const invoices = await readSaleInvoices()
    const invoice = invoices.find((item) => String(item.orderId) === orderId)
    if (!invoice) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró la factura solicitada.',
      })
    }

    const pdf = buildInvoicePdf(invoice)
    const filename = `${invoice.voucher?.voucherTypeDescription || 'Factura'}-${invoice.voucher?.formattedNumber || orderId}.pdf`
      .replace(/[^a-zA-Z0-9._-]+/g, '-')

    const delivery = await uploadFiscalDocument(orderId, pdf, filename)
    invoice.mercadoLibreDelivery = {
      status: delivery.alreadyAttached ? 'already_attached' : 'sent',
      sentAt: new Date().toISOString(),
      packId: delivery.packId || null,
      documentIds: delivery.ids || [],
      error: null,
    }

    await writeSaleInvoices(invoices)

    res.json({
      ok: true,
      invoice,
      mercadoLibreDelivery: invoice.mercadoLibreDelivery,
    })
  } catch (error) {
    console.error('Retry Mercado Libre invoice upload error:', error)
    res.status(502).json({ ok: false, error: error.message })
  }
})

app.get('/api/arca/sale-invoices/:orderId/pdf', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim()
    const invoices = await readSaleInvoices()
    const invoice = invoices.find((item) => String(item.orderId) === orderId)
    if (!invoice) return res.status(404).json({ ok: false, error: 'No se encontró la factura solicitada.' })

    const pdf = buildInvoicePdf(invoice)
    const filename = `${invoice.voucher?.voucherTypeDescription || 'Factura'}-${invoice.voucher?.formattedNumber || orderId}.pdf`
      .replace(/[^a-zA-Z0-9._-]+/g, '-')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(pdf)
  } catch (error) {
    console.error('Invoice PDF error:', error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/arca/last-voucher', async (req, res) => {
  try {
    res.json(await getLastAuthorizedVoucher({
      pointOfSale: req.query.pointOfSale,
      voucherType: req.query.voucherType,
    }))
  } catch (error) {
    console.error('ARCA last voucher error:', error)
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.get('/api/mercadolibre/status', async (_req, res) => {
  try { res.json(await getStatus()) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/mercadolibre/connect', async (_req, res) => {
  try { res.json({ url: await createAuthorizationUrl() }) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/mercadolibre/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  if (error) return res.redirect(`${frontendUrl}/?ml=error&message=${encodeURIComponent(errorDescription || error)}`)
  try {
    if (!code) throw new Error('Mercado Libre no devolvió el código de autorización')
    await exchangeAuthorizationCode(String(code), String(state || ''))
    return res.redirect(`${frontendUrl}/?ml=connected`)
  } catch (exchangeError) {
    return res.redirect(`${frontendUrl}/?ml=error&message=${encodeURIComponent(exchangeError.message)}`)
  }
})

app.post('/api/mercadolibre/sync', async (req, res) => {
  try {
    const page = Number(req.query.page || req.body?.page || 1)
    const pageSize = Number(req.query.pageSize || req.body?.pageSize || 50)
    res.json(await syncOrders({ page, pageSize }))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/mercadolibre/orders', async (_req, res) => {
  try { res.json(await getOrders()) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/mercadolibre/order/:id', async (req, res) => {
  try { res.json(await getOrderDetail(req.params.id)) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/api/mercadolibre/disconnect', async (_req, res) => {
  try { await disconnect(); res.json({ ok: true }) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.listen(port, () => {
  console.log(`Panadero API: http://localhost:${port}`)
})
