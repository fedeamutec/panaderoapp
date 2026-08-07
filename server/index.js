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
